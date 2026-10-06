import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankSuggestions } from '../server/utils/rank.js';
import { normalizeFieldDefinition } from '../server/utils/fieldTypes.js';

const rows = (...entries) => entries.map(([value, uses]) => ({ value, uses }));

test('values starting with what was typed come before ones that merely contain it', () => {
  const found = rankSuggestions(rows(['Army Painter Val', 9], ['Vallejo', 2], ['Valspar', 1]), 'val');
  assert.deepEqual(found.map(f => f.value), ['Vallejo', 'Valspar', 'Army Painter Val']);
});

test('within a group the most used comes first, then alphabetical', () => {
  assert.deepEqual(rankSuggestions(rows(['Citadel', 3], ['Vallejo', 8], ['AK', 3]), '').map(f => f.value), ['Vallejo', 'AK', 'Citadel']);
});

test('spellings that differ only in case are one suggestion, in the most common spelling', () => {
  const found = rankSuggestions(rows(['vallejo', 2], ['Vallejo', 5], ['VALLEJO', 1]), 'val');
  assert.deepEqual(found, [{ value: 'Vallejo', uses: 8 }]);
});

test('the limit is respected and kept within bounds', () => {
  const many = rows(...Array.from({ length: 30 }, (_, i) => [`Brand ${String(i).padStart(2, '0')}`, 1]));
  assert.equal(rankSuggestions(many, '', 5).length, 5);
  assert.equal(rankSuggestions(many, '', 999).length, 20, 'never more than 20');
  assert.equal(rankSuggestions(many, '', 0).length, 1, 'at least one');
});

test('nothing in, nothing out', () => {
  assert.deepEqual(rankSuggestions([], 'x'), []);
});

test('only text fields can suggest values', () => {
  assert.equal(normalizeFieldDefinition({ label: 'Brand', type: 'text', suggest: true })[1].suggest, true);
  assert.equal(normalizeFieldDefinition({ label: 'Brand', type: 'text' })[1].suggest, false, 'off unless asked for');
  assert.equal(normalizeFieldDefinition({ label: 'Cost', type: 'number', suggest: true })[1].suggest, false, 'ignored on other types');
  assert.equal(normalizeFieldDefinition({ label: 'Notes', type: 'longtext', suggest: true })[1].suggest, false);
});

import { categoryKey, groupCategories } from '../server/utils/categoryLogic.js';

test('category keys ignore case and spacing', () => {
  assert.equal(categoryKey('  Spray   Paint '), 'spray paint');
  assert.equal(categoryKey('PAINT'), categoryKey('paint'));
  assert.equal(categoryKey(''), '');
  assert.equal(categoryKey(null), '');
});

test('categories merge spellings, count together, and sort by name', () => {
  const found = groupCategories([{ value: 'paint', uses: 2 }, { value: 'Paint', uses: 5 }, { value: 'Tool', uses: 1 }, { value: 'airbrush', uses: 3 }, { value: '  ', uses: 9 }]);
  assert.deepEqual(found.map(c => [c.name, c.count]), [['airbrush', 3], ['Paint', 7], ['Tool', 1]]);
});

test('a stored record supplies the name and image', () => {
  const found = groupCategories([{ value: 'paint', uses: 4 }, { value: 'Brush', uses: 1 }], [{ key: 'paint', name: 'Paints', image: 'abc' }]);
  assert.deepEqual(found.find(c => c.key === 'paint'), { key: 'paint', name: 'Paints', count: 4, image: 'abc', description: '', tags: [], owner: '' });
  assert.equal(found.find(c => c.key === 'brush').image, null, 'no record, no image');
});

test('a record for a category no item has is not listed', () => {
  assert.deepEqual(groupCategories([], [{ key: 'ghost', name: 'Ghost', image: 'x' }]), []);
});

import { tidyCategory, MAX_CATEGORY } from '../server/utils/categoryLogic.js';

test('categories are stored tidy: trimmed, with spacing collapsed, case kept', () => {
  assert.equal(tidyCategory('  Spray    Paint '), 'Spray Paint');
  assert.equal(tidyCategory('PAINT'), 'PAINT');
  assert.equal(tidyCategory(null), '');
  assert.equal(tidyCategory('   '), '');
  assert.equal(MAX_CATEGORY, 100);
});

test('"category" is built in, so no custom field can take the name', () => {
  assert.equal(normalizeFieldDefinition({ label: 'Category', key: 'category', type: 'text' })[0].code, 400);
  assert.equal(normalizeFieldDefinition({ label: 'Category', type: 'text' })[0].code, 400, 'even when the key is derived from the label');
  assert.match(normalizeFieldDefinition({ label: 'Category', type: 'text' })[0].msg, /reserved/);
});

test('when two spellings are used equally, the capitalised one is shown', () => {
  const found = groupCategories([{ value: 'spray paint', uses: 1 }, { value: 'Spray Paint', uses: 1 }]);
  assert.equal(found[0].name, 'Spray Paint');
  assert.equal(groupCategories([{ value: 'tool', uses: 3 }, { value: 'Tool', uses: 1 }])[0].name, 'tool', 'but the most used spelling still wins');
});

test('a record can carry a description', () => {
  const found = groupCategories([{ value: 'Paint', uses: 1 }], [{ key: 'paint', name: 'Paint', image: null, description: 'Hobby paints' }]);
  assert.equal(found[0].description, 'Hobby paints');
});

test('categories that only exist as a record are listed only when asked for', () => {
  const records = [{ key: 'resin', name: 'Resin', image: 'x', description: 'Printer resin' }, { key: 'paint', name: 'Paint' }];
  assert.deepEqual(groupCategories([{ value: 'Paint', uses: 2 }], records).map(c => c.name), ['Paint']);
  const all = groupCategories([{ value: 'Paint', uses: 2 }], records, { includeEmpty: true });
  assert.deepEqual(all.map(c => [c.name, c.count]), [['Paint', 2], ['Resin', 0]]);
  assert.equal(all[1].image, 'x');
  assert.equal(all[1].description, 'Printer resin');
});
