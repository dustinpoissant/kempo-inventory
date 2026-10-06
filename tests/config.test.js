import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { EVENTS } from '../server/utils/events.js';

const config = JSON.parse(readFileSync(new URL('../kempo-config.json', import.meta.url), 'utf8'));
const permissionNames = config.permissions.map(p => p.name);

test('every permission is prefixed with the extension name', () => {
  for(const name of permissionNames) assert.match(name, /^kempo-inventory:/);
});

test('groups only reference declared permissions (or panel access)', () => {
  for(const group of config.groups){
    for(const permission of group.permissions) assert.ok(permissionNames.includes(permission) || permission === 'system:admin:access', permission);
  }
});

test('groups form a ladder: viewer < manager < admin, and only admin sets up fields', () => {
  const group = name => new Set(config.groups.find(g => g.name === `kempo-inventory:${name}`).permissions);
  const [viewer, manager, admin] = ['viewer', 'manager', 'admin'].map(group);
  for(const permission of viewer) assert.ok(manager.has(permission), `manager lacks ${permission}`);
  for(const permission of manager) assert.ok(admin.has(permission), `admin lacks ${permission}`);
  assert.deepEqual(new Set([...permissionNames, 'system:admin:access']), admin, 'admin holds every permission plus panel access');
  for(const name of ['viewer', 'manager', 'admin']) assert.ok(group(name).has('system:admin:access'), `${name} needs panel access to reach its admin pages`);
  assert.ok(!manager.has('kempo-inventory:fields:manage'));
  assert.ok(!viewer.has('kempo-inventory:items:create'));
});

test('every permission checked by the API is declared', () => {
  const used = ['items:read', 'items:create', 'items:update', 'items:delete', 'stock:adjust', 'fields:manage'];
  for(const name of used) assert.ok(permissionNames.includes(`kempo-inventory:${name}`), name);
});

test('event names are unique and namespaced', () => {
  const names = Object.values(EVENTS);
  assert.equal(new Set(names).size, names.length);
  for(const name of names) assert.match(name, /^kempo-inventory:(item|stock|field|category):[a-z_]+$/);
});

test('the schema declares the same indexes install.js creates', () => {
  const schema = readFileSync(new URL('../server/db/schema.js', import.meta.url), 'utf8');
  const install = readFileSync(new URL('../install.js', import.meta.url), 'utf8');
  for(const [, name] of schema.matchAll(/(?:uniqueIndex|index)\('([^']+)'\)/g)){
    assert.ok(install.includes(`"${name}"`), `${name} is declared in the schema but not created by install.js`);
  }
  assert.ok(readdirSync(new URL('../server/utils/', import.meta.url)).includes('hooks.js'));
});
