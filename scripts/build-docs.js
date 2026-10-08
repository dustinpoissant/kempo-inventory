#!/usr/bin/env node
import { readdir, readFile, writeFile, mkdir, copyFile, stat } from 'fs/promises';
import { join, extname, relative } from 'path';
import { pathToFileURL } from 'url';
import hljs from 'highlight.js';
import { renderDir } from 'kempo-server/templating';

/*
  Builds the documentation site (GitHub Pages serves docs/) from docs-src/:

    1. every *.page.html in docs-src is rendered into docs/ through the template and fragments
    2. code samples are highlighted: write <pre><code class="language-js"> with < and & escaped, and
       it becomes highlighted markup here, so the page needs no script to colour it
    3. docs-src/media is copied across

  Edit docs-src, never docs: the next build replaces it. `npm run docs:build` runs this; the tests
  call buildDocs into a temporary folder to check the committed docs/ is what the sources produce.
*/
const LANGUAGES = { html: 'xml', xml: 'xml', js: 'javascript', javascript: 'javascript', json: 'json', css: 'css', bash: 'bash', sh: 'bash', csv: 'plaintext', text: 'plaintext' };

const decode = text => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const highlight = html => html.replace(/<pre><code class="language-([a-z]+)">([\s\S]*?)<\/code><\/pre>/g, (match, name, code) => {
  const language = LANGUAGES[name];
  if(!language) throw new Error(`Unknown code language "${name}"`);
  const source = decode(code).replace(/^\n/, '').replace(/\s+$/, '');
  const result = language === 'plaintext' ? escape(source) : hljs.highlight(source, { language }).value;
  return `<pre><code class="hljs ${language}">${result}</code></pre>`;
});

const walk = async directory => {
  const files = [];
  for(const entry of await readdir(directory, { withFileTypes: true })){
    const path = join(directory, entry.name);
    if(entry.isDirectory()) files.push(...await walk(path)); else files.push(path);
  }
  return files;
};

export const buildDocs = async ({ source = './docs-src', output = './docs' } = {}) => {
  const pages = await renderDir(source, output);

  let highlighted = 0;
  for(const file of (await walk(output)).filter(path => extname(path) === '.html')){
    const before = await readFile(file, 'utf8');
    const after = highlight(before);
    if(after !== before){
      await writeFile(file, after, 'utf8');
      highlighted += 1;
    }
  }

  const media = join(source, 'media');
  const files = await stat(media).then(() => true).catch(() => false) ? await walk(media) : [];
  for(const file of files){
    const target = join(output, relative(source, file));
    await mkdir(join(target, '..'), { recursive: true });
    await copyFile(file, target);
  }

  /* Stops GitHub Pages running the site through Jekyll. */
  await writeFile(join(output, '.nojekyll'), '');
  return { pages, highlighted, media: files.length };
};

if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href){
  const { pages, highlighted, media } = await buildDocs();
  console.log(`Rendered ${pages} pages, highlighted code in ${highlighted}, copied ${media} media files`);
}
