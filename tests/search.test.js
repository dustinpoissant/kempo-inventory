import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { setSetting } from 'kempo/server/sdk.js';
import { kempoInventoryCategory, kempoInventoryField, kempoInventoryItem, kempoInventoryMovement } from '../server/db/schema.js';
import { saveCategory } from '../server/utils/categories.js';
import { createField } from '../server/utils/fields.js';
import { createItem } from '../server/utils/items.js';
import searchHook from '../hooks/search.js';

/*
  The search hook handler against a real database: words are matched one by one against an item, its category and its fields, and
  who may read is checked first. Runs in the unit tier (KEMPO_DB=pglite), or against a database whose name ends in _test, and
  empties the inventory tables first.
*/
const url = process.env.DATABASE_URL ?? '';
const unitTier = process.env.KEMPO_DB === 'pglite';
const reachable = (unitTier || /_test$/.test(url.split('?')[0])) && await db.execute(sql`select 1`).then(() => true).catch(() => false);

const ok = ([error, value]) => {
  assert.equal(error, null, error?.msg);
  return value;
};

after(() => unitTier ? db.$client.close() : db.$client.end());

const READER = ['kempo-inventory:items:read'];

/* Runs the handler as the search does, for a visitor, and returns what it added. */
const search = async (text, { types = ['inventory-item'], permissions = READER, isAdmin = false, window = 25 } = {}) => {
  const results = Object.fromEntries(types.map(type => [type, []]));
  const totals = {};
  await searchHook({ search: text, types, window, permissions, isAdmin, results, totals });
  return { results, totals };
};

const names = found => found.map(result => `${result.title}:${result.category}`);

describe('searching the inventory', { skip: reachable ? false : 'no throwaway database (set DATABASE_URL to one ending in _test)' }, () => {
  const clear = async () => {
    await db.delete(kempoInventoryMovement);
    await db.delete(kempoInventoryItem);
    await db.delete(kempoInventoryCategory);
    await db.delete(kempoInventoryField);
  };

  before(async () => {
    await clear();
    await setSetting('kempo-inventory', 'public_read', false, 'boolean');
    ok(await saveCategory('Filament', { description: '3D printer filament', tags: ['3d', 'printing'] }));
    ok(await saveCategory('Paint'));
    ok(await createField({ label: 'Brand', type: 'text', key: 'brand' }));
    for(const [sku, name, category, extra] of [
      ['FIL-BLUE-1', 'Blue', 'Filament', { fields: { brand: 'Prusa' } }],
      ['FIL-BLUE-2', 'Blueberry', 'Filament', { fields: { brand: 'Hatchbox' } }],
      ['FIL-RED-1', 'Red', 'Filament', { fields: { brand: 'Prusa' } }],
      ['PNT-BLUE-1', 'Blue', 'Paint', { fields: { brand: 'Vallejo' } }],
      ['PNT-GRN-1', 'Green', 'Paint', { description: 'A bright blue-green shade' }],
      ['TOOL-1', 'Brush', '', {}],
    ]) ok(await createItem({ sku, name, category, quantity: 7, ...extra }));
  });

  after(async () => {
    if(reachable){
      await clear();
      await setSetting('kempo-inventory', 'public_read', false, 'boolean');
    }
  });

  test('"blue filament" finds the blue filament and not the blue paint', async () => {
    const { results } = await search('blue filament');
    assert.deepEqual(names(results['inventory-item']), ['Blue:Filament', 'Blueberry:Filament']);
  });

  test('"blue" alone finds blue in every category, and "filament" alone finds every filament', async () => {
    assert.deepEqual(names((await search('blue')).results['inventory-item']).sort(), ['Blue:Filament', 'Blue:Paint', 'Blueberry:Filament', 'Green:Paint']);
    assert.deepEqual(names((await search('filament')).results['inventory-item']).sort(), ['Blue:Filament', 'Blueberry:Filament', 'Red:Filament']);
  });

  test('the order of the words does not matter', async () => {
    const forward = names((await search('blue filament')).results['inventory-item']);
    const backward = names((await search('filament blue')).results['inventory-item']);
    assert.deepEqual(forward, backward);
  });

  test('the word that is a whole word in the name ranks above one that only starts a word', async () => {
    const found = (await search('blue filament')).results['inventory-item'];
    assert.equal(found[0].title, 'Blue');
    assert.ok(found[0].score > found[1].score, `${found[0].score} should beat ${found[1].score}`);
  });

  test('the scores of the words are combined, so the name and the category both count', async () => {
    const [blue] = (await search('blue filament')).results['inventory-item'];
    const [onlyBlue] = (await search('blue')).results['inventory-item'];
    assert.ok(blue.score < onlyBlue.score, 'a word matching only the (less important) category lowers the mean');
    assert.ok(blue.score > 0.8 && blue.score < 1);
  });

  test('a word can match a text field, the SKU, or the description', async () => {
    assert.deepEqual(names((await search('prusa red')).results['inventory-item']), ['Red:Filament']);
    assert.deepEqual(names((await search('pnt-grn-1')).results['inventory-item']), ['Green:Paint']);
    assert.deepEqual(names((await search('bright green')).results['inventory-item']), ['Green:Paint']);
  });

  test('a word can match the category\'s own tags or description, which the items do not hold', async () => {
    const found = names((await search('3d blue')).results['inventory-item']);
    assert.deepEqual(found, ['Blue:Filament', 'Blueberry:Filament']);
    assert.deepEqual(names((await search('printer red')).results['inventory-item']), ['Red:Filament']);
  });

  test('every word must match: a word nothing has finds nothing', async () => {
    assert.deepEqual((await search('blue zzzzz')).results['inventory-item'], []);
  });

  test('a result is a link to the item and never carries the quantity', async () => {
    const [first] = (await search('red')).results['inventory-item'];
    assert.match(first.url, /^\/items\/[0-9a-f]+$/);
    assert.equal(first.description, 'Filament · FIL-RED-1');
    assert.ok(!('quantity' in first), 'the stock count is not sent');
  });

  test('categories are found by name, tags and description, with how many items they hold', async () => {
    const { results, totals } = await search('printer 3d', { types: ['inventory-category'] });
    assert.deepEqual(results['inventory-category'].map(c => [c.title, c.count]), [['Filament', 3]]);
    assert.equal(totals['inventory-category'], 1);
    assert.equal(results['inventory-category'][0].url, undefined, 'no admin to send a reader to');
  });

  test('a category links to the admin for someone who has one', async () => {
    const { results } = await search('filament', { types: ['inventory-category'], permissions: [...READER, 'system:admin:access'] });
    assert.equal(results['inventory-category'][0].url, '/admin/extension/kempo-inventory/');
  });

  test('both types can be searched together, each answered in its own list', async () => {
    const { results, totals } = await search('filament', { types: ['inventory-item', 'inventory-category'] });
    assert.equal(results['inventory-item'].length, 3);
    assert.equal(results['inventory-category'].length, 1);
    assert.deepEqual([totals['inventory-item'], totals['inventory-category']], [3, 1]);
  });

  test('a type that was not asked for is not filled', async () => {
    const { results } = await search('filament', { types: ['inventory-category'] });
    assert.deepEqual(Object.keys(results), ['inventory-category']);
  });

  test('other types in the request are left to other extensions', async () => {
    const { results } = await search('filament', { types: ['page', 'post'] });
    assert.deepEqual(results, { page: [], post: [] });
  });

  test('nobody who may not read finds anything, and the database is not asked', async () => {
    let reads = 0;
    const original = db.select;
    db.select = (...args) => {
      reads++;
      return original.apply(db, args);
    };
    try {
      const { results } = await search('filament', { types: ['inventory-item', 'inventory-category'], permissions: [] });
      assert.deepEqual(results, { 'inventory-item': [], 'inventory-category': [] });
    } finally {
      delete db.select;
    }
    assert.ok(reads <= 1, `${reads} reads`);
  });

  test('an administrator may read, and the items:read permission is enough', async () => {
    assert.equal((await search('red', { permissions: [], isAdmin: true })).results['inventory-item'].length, 1);
    assert.equal((await search('red', { permissions: READER })).results['inventory-item'].length, 1);
  });

  test('with public_read on, anyone may read, and still no quantity is sent', async () => {
    await setSetting('kempo-inventory', 'public_read', true, 'boolean');
    try {
      const { results } = await search('red', { permissions: [] });
      assert.equal(results['inventory-item'].length, 1);
      assert.ok(!('quantity' in results['inventory-item'][0]));
    } finally {
      await setSetting('kempo-inventory', 'public_read', false, 'boolean');
    }
  });

  test('% and _ in a search are ordinary characters', async () => {
    assert.deepEqual((await search('%')).results['inventory-item'], []);
    assert.deepEqual((await search('fil_blue')).results['inventory-item'], []);
  });

  test('the window limits what is returned, and the total counts every match', async () => {
    const { results, totals } = await search('filament', { window: 2 });
    assert.equal(results['inventory-item'].length, 2);
    assert.equal(totals['inventory-item'], 3);
  });
});
