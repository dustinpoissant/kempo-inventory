import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { fileURLToPath, pathToFileURL } from 'url';

/*
  This extension adds widgets to the kempo admin dashboard through `widgets` in kempo-config.json. Core
  refuses a definition it could not render (and the extension would fail to install), and a module path
  that points at nothing only shows up as a broken tile, so both are checked here with core's own
  validation.
*/

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(root, 'kempo-config.json'), 'utf8'));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const { normalizeWidget } = await import(pathToFileURL(path.join(root, 'node_modules', 'kempo', 'server', 'utils', 'dashboard', 'helpers.js')).href);

const scope = `/${config['public-scope'] || pkg.kempo?.['public-scope']}/`;
const permissions = new Set((config.permissions || []).map(p => p.name));

test('kempo-config.json declares at least one widget', () => {
  assert.ok(Array.isArray(config.widgets) && config.widgets.length > 0);
});

test('every declared widget passes the validation core applies', () => {
  for(const widget of config.widgets){
    const [error] = normalizeWidget({ ...widget, owner: pkg.name });
    assert.equal(error, null, `${widget.key}: ${error?.msg}`);
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
