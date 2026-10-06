import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lockedItemChanges, mayManage, blockingOwner, ownerLabel, notYours } from '../server/utils/ownership.js';
import { groupCategories } from '../server/utils/categoryLogic.js';

const owned = { sku: 'CAR-1', name: 'Model car', category: 'Finished goods', owner: 'kempo-products' };

test('the owner may change anything about its item', () => {
  assert.deepEqual(lockedItemChanges(owned, { sku: 'X', name: 'Y', category: 'Z' }, 'kempo-products'), []);
});

test('anyone else is refused sku, name and category changes', () => {
  assert.deepEqual(lockedItemChanges(owned, { sku: 'X', name: 'Y', category: 'Z' }, ''), ['sku', 'name', 'category']);
  assert.deepEqual(lockedItemChanges(owned, { name: 'Y' }, 'another-extension'), ['name']);
});

test('sending the current value back is not a change (the admin form always sends all three)', () => {
  assert.deepEqual(lockedItemChanges(owned, { sku: ' CAR-1 ', name: 'Model car', category: ' Finished   goods' }, ''), []);
});

test('description, tags and field values are never locked', () => {
  assert.deepEqual(lockedItemChanges(owned, { description: 'x', tags: ['a'], fields: { price: 1 } }, ''), []);
});

test('items people manage are unlocked for people, and locked against extensions', () => {
  const mine = { sku: 'A', name: 'B', category: '', owner: '' };
  assert.deepEqual(lockedItemChanges(mine, { name: 'C' }, ''), []);
  assert.deepEqual(lockedItemChanges(mine, { name: 'C' }, 'kempo-products'), ['name']);
});

test('mayManage allows records that do not exist yet and ones the actor owns', () => {
  assert.equal(mayManage(undefined, ''), true);
  assert.equal(mayManage({ owner: 'a' }, 'a'), true);
  assert.equal(mayManage({ owner: 'a' }, ''), false);
  assert.equal(mayManage({ owner: '' }, 'a'), false);
});

test('a rename is blocked only by someone else\'s owned items or fields', () => {
  assert.equal(blockingOwner(['', 'a'], 'a'), null);
  assert.equal(blockingOwner([''], 'a'), null);
  assert.equal(blockingOwner(['', 'b'], 'a'), 'b');
  assert.equal(blockingOwner(['b'], ''), 'b');
});

test('messages name the owner', () => {
  assert.match(ownerLabel('kempo-products'), /kempo-products/);
  assert.equal(notYours('category', { owner: 'kempo-products' }, '').code, 403);
});

test('grouped categories carry their owner, empty ones included', () => {
  const grouped = groupCategories(
    [{ value: 'Finished goods', uses: 2 }],
    [{ key: 'finished goods', name: 'Finished goods', owner: 'kempo-products' }, { key: 'paint', name: 'Paint' }],
    { includeEmpty: true },
  );
  assert.deepEqual(grouped.map(c => [c.name, c.owner]), [['Finished goods', 'kempo-products'], ['Paint', '']]);
});
