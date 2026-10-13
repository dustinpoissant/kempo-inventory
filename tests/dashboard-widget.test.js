import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { fileURLToPath, pathToFileURL } from 'url';

/*
  This extension adds widgets to the kempo admin dashboard through `widgets` in kempo-config.json. Core
  refuses a definition it could not render (and the extension would fail to install), and a module path
  that points at nothing only shows up as a broken tile, so both are checked here.

  The rules are checked inline so this works against any installed kempo, including one released before
  the dashboard existed. When the installed kempo does have the dashboard, its own validation also runs.
*/

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(root, 'kempo-config.json'), 'utf8'));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const core = await import(pathToFileURL(path.join(root, 'node_modules', 'kempo', 'server', 'utils', 'dashboard', 'helpers.js')).href).catch(() => null);

const scope = `/${pkg.kempo?.['public-scope'] || config['public-scope']}/`;
const permissions = new Set((config.permissions || []).map(p => p.name));

const ELEMENT = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const LOCAL_PATH = /^\/(?![/\\])[^\\\s\u0000-\u001f\u007f]*$/;
const blocks = (value, max) => Number.isInteger(value) && value >= 1 && value <= max;

const problems = widget => {
  const { key, title, element, module, defaultWidth = 2, defaultHeight = 1, minWidth = 1, maxWidth = 4, minHeight = 1, maxHeight = 3, actions = [] } = widget;
  const found = [];
  if(typeof key !== 'string' || !KEY.test(key)) found.push('key must be letters, numbers, ".", "_" or "-"');
  if(typeof title !== 'string' || !title.trim() || title.length > 100) found.push('title is required, at most 100 characters');
  if(typeof element !== 'string' || !ELEMENT.test(element)) found.push('element must be a custom element name such as "my-ext-widget"');
  if(typeof module !== 'string' || !LOCAL_PATH.test(module)) found.push('module must be a path on this site beginning with a single "/"');
  if(!blocks(minWidth, 4) || !blocks(maxWidth, 4) || minWidth > maxWidth) found.push('minWidth and maxWidth must be 1 to 4, min no greater than max');
  if(!blocks(minHeight, 3) || !blocks(maxHeight, 3) || minHeight > maxHeight) found.push('minHeight and maxHeight must be 1 to 3, min no greater than max');
  if(!Number.isInteger(defaultWidth) || defaultWidth < minWidth || defaultWidth > maxWidth) found.push('defaultWidth must be within the width bounds');
  if(!Number.isInteger(defaultHeight) || defaultHeight < minHeight || defaultHeight > maxHeight) found.push('defaultHeight must be within the height bounds');
  if(!Array.isArray(actions) || actions.length > 3 || actions.some(action => !action?.label || !LOCAL_PATH.test(action?.href))) found.push('actions must be at most 3 { label, href } with a site path');
  return found;
};

test('kempo-config.json declares at least one widget', () => {
  assert.ok(Array.isArray(config.widgets) && config.widgets.length > 0);
});

test('every declared widget is a definition the dashboard can render', () => {
  for(const widget of config.widgets){
    assert.deepEqual(problems(widget), [], `${widget.key}`);
    if(core){
      const [error] = core.normalizeWidget({ ...widget, owner: pkg.name });
      assert.equal(error, null, `${widget.key}: kempo core refuses it: ${error?.msg}`);
    }
  }
});

test('every widget module is served from the public scope and exists', () => {
  for(const { key, module } of config.widgets){
    assert.ok(module.startsWith(scope), `${key}: ${module} is outside ${scope}`);
    assert.ok(existsSync(path.join(root, 'public', module.slice(scope.length))), `${key}: ${module} does not exist under public/`);
  }
});

test('a widget permission is one the extension declares, or from core or a dependency when it declares none', () => {
  for(const { key, permission } of config.widgets){
    if(permission && permissions.size && !permission.startsWith('system:')){
      assert.ok(permissions.has(permission), `${key}: permission "${permission}" is not declared by this extension`);
    }
  }
});

test('every widget module defines the element it is registered with', async () => {
  for(const { key, module, element } of config.widgets){
    const source = await readFile(path.join(root, 'public', module.slice(scope.length)), 'utf8');
    assert.ok(source.includes(`customElements.define('${element}'`), `${key}: ${module} never defines <${element}>`);
  }
});
