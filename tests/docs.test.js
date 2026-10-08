import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDocs } from '../scripts/build-docs.js';

/*
  The documentation site (docs/, built from docs-src/ by `npm run docs:build`) must hold together:
  every page links only to pages and sections that exist, every image exists and says what it shows,
  every code sample was highlighted, and the committed docs are exactly what docs-src builds.
*/
const path = url => new URL(url, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const docs = path('../docs/');
const source = path('../docs-src/');

const sources = readdirSync(source).filter(name => name.endsWith('.page.html')).map(name => name.replace('.page.html', '.html'));
const pages = readdirSync(docs).filter(name => name.endsWith('.html'));
const read = name => readFileSync(join(docs, name), 'utf8');
const ids = html => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]));

test('every source page was built, and the site has an index', () => {
  assert.ok(sources.includes('index.html'));
  assert.deepEqual(pages.slice().sort(), sources.slice().sort());
});

test('every internal link points at a page and a section that exist', () => {
  const problems = [];
  for(const name of pages){
    const html = read(name);
    for(const [, href] of html.matchAll(/<a[^>]*\shref="([^"]+)"/g)){
      if(/^(https?:|mailto:)/.test(href)) continue;
      const [target, hash] = href.split('#');
      const file = target === '' ? name : target.replace(/^\.\//, '') || 'index.html';
      if(!pages.includes(file)){
        problems.push(`${name}: ${href} (no such page)`);
        continue;
      }
      if(hash && !ids(read(file)).has(hash)) problems.push(`${name}: ${href} (no such section)`);
    }
  }
  assert.deepEqual(problems, []);
});

test('every page has a title, a description and its heading', () => {
  for(const name of pages){
    const html = read(name);
    assert.match(html, /<title>[^<]+<\/title>/, name);
    assert.match(html, /<meta name="description"/, name);
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 2, `${name}: the page heading plus the menu's brand`);
  }
});

test('every image exists, and every picture of the admin says what it shows', () => {
  const problems = [];
  for(const name of pages){
    for(const [, tag] of read(name).matchAll(/<img\s([^>]*)>/g)){
      const src = /src="([^"]+)"/.exec(tag)?.[1] ?? '';
      const alt = /alt="([^"]*)"/.exec(tag)?.[1];
      if(!existsSync(join(docs, src))) problems.push(`${name}: ${src} is missing`);
      if(alt === undefined) problems.push(`${name}: ${src} has no alt attribute`);
      if(src.endsWith('.png') && !alt) problems.push(`${name}: ${src} needs a description`);
    }
  }
  assert.deepEqual(problems, []);
});

test('every code sample was highlighted, and no template tag was left behind', () => {
  for(const name of pages){
    const html = read(name);
    assert.ok(!/<code class="language-/.test(html), `${name} has an unhighlighted sample`);
    assert.ok(!/\{\{|<fragment|<location/.test(html), `${name} has a stray template tag`);
  }
});

test('the committed docs are exactly what docs-src builds (run `npm run docs:build` if not)', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'kempo-docs-'));
  try {
    await buildDocs({ source, output: temporary });
    const built = readdirSync(temporary).filter(name => name.endsWith('.html')).sort();
    assert.deepEqual(pages.slice().sort(), built, 'the same pages');
    const lines = text => text.replace(/\r\n/g, '\n');
    for(const name of built) assert.equal(lines(read(name)), lines(readFileSync(join(temporary, name), 'utf8')), `${name} is out of date`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('the site is served as plain files, not run through Jekyll', () => {
  assert.ok(existsSync(join(docs, '.nojekyll')));
});
