import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { kempoInventoryItem, kempoInventoryMovement } from '../server/db/schema.js';
import { createItem, adjustStock, adjustStockMany, getItem, getMovements } from '../server/utils/items.js';

/*
  adjustStockMany against a real database. It skips itself when none is reachable, or when the
  database is not obviously a throwaway one (its name must end in _test): it empties the item
  tables first.

  Requires Postgres carrying kempo's schema and this extension's (`npx drizzle-kit push --force`)
  with DATABASE_URL set.
*/
const url = process.env.DATABASE_URL ?? '';
const reachable = /_test$/.test(url.split('?')[0]) && await db.execute(sql`select 1`).then(() => true).catch(() => false);

const ok = ([error, value]) => {
  assert.equal(error, null, error?.msg);
  return value;
};

after(() => db.$client.end());

describe('adjustStockMany', { skip: reachable ? false : 'no throwaway database (set DATABASE_URL to one ending in _test)' }, () => {
  let resin;
  let paint;
  let tpu;

  before(async () => {
    await db.delete(kempoInventoryMovement);
    await db.delete(kempoInventoryItem);
    resin = ok(await createItem({ sku: 'RESIN', name: 'Resin (g)', quantity: 1000 }));
    paint = ok(await createItem({ sku: 'PAINT', name: 'Paint (ml)', quantity: 50 }));
    tpu = ok(await createItem({ sku: 'TPU', name: 'TPU (g)', quantity: 5 }));
  });

  after(async () => {
    if(reachable){
      await db.delete(kempoInventoryMovement);
      await db.delete(kempoInventoryItem);
    }
  });

  test('applies every change together', async () => {
    const { items } = ok(await adjustStockMany([{ id: resin.id, delta: -175 }, { id: paint.id, delta: -20 }], { reason: 'sale', ref: 'order-1' }));
    assert.deepEqual(items.map(item => item.quantity).sort((a, b) => a - b), [30, 825]);
    assert.equal(ok(await getItem(resin.id)).quantity, 825);
    assert.equal(ok(await getItem(paint.id)).quantity, 30);
  });

  test('records a movement per item, tagged with the ref', async () => {
    const movements = ok(await getMovements({ itemId: resin.id }));
    const sale = movements.find(movement => movement.reason === 'sale');
    assert.equal(sale.delta, -175);
    assert.equal(sale.quantityAfter, 825);
    assert.match(sale.note, /\[order-1\]/);
  });

  test('one item short refuses the whole change and changes nothing', async () => {
    const result = await adjustStockMany([{ id: resin.id, delta: -100 }, { id: tpu.id, delta: -6 }, { id: paint.id, delta: -1 }], { reason: 'sale', ref: 'order-2' });
    assert.equal(result[0].code, 409);
    assert.match(result[0].msg, /TPU/);
    assert.equal(ok(await getItem(resin.id)).quantity, 825);
    assert.equal(ok(await getItem(tpu.id)).quantity, 5);
    assert.equal(ok(await getItem(paint.id)).quantity, 30);
    const movements = ok(await getMovements({ itemId: resin.id }));
    assert.equal(movements.filter(movement => /order-2/.test(movement.note)).length, 0);
  });

  test('changes to one item are added together, and one that nets to nothing is left out', async () => {
    const { items } = ok(await adjustStockMany([{ id: resin.id, delta: -10 }, { id: resin.id, delta: -15 }, { id: paint.id, delta: 5 }, { id: paint.id, delta: -5 }]));
    assert.equal(items.length, 1);
    assert.equal(items[0].quantity, 800);
    assert.equal(ok(await getItem(paint.id)).quantity, 30);
  });

  test('adding stock works the same way, so a change can be reversed', async () => {
    ok(await adjustStockMany([{ id: resin.id, delta: 175 }, { id: paint.id, delta: 20 }], { reason: 'return', ref: 'order-1' }));
    assert.equal(ok(await getItem(resin.id)).quantity, 975);
    assert.equal(ok(await getItem(paint.id)).quantity, 50);
  });

  test('an unknown item refuses everything', async () => {
    const result = await adjustStockMany([{ id: resin.id, delta: -1 }, { id: 'ffffffffffffffff', delta: -1 }]);
    assert.equal(result[0].code, 404);
    assert.equal(ok(await getItem(resin.id)).quantity, 975);
  });

  test('malformed input is refused', async () => {
    assert.equal((await adjustStockMany([]))[0].code, 400);
    assert.equal((await adjustStockMany('nope'))[0].code, 400);
    assert.equal((await adjustStockMany([{ delta: 1 }]))[0].code, 400);
    assert.equal((await adjustStockMany([{ id: resin.id, delta: 1.5 }]))[0].code, 400);
  });

  test('two overlapping changes never take the same stock twice', async () => {
    const item = ok(await createItem({ sku: 'SHARED', name: 'Shared', quantity: 10 }));
    const results = await Promise.all(Array.from({ length: 5 }, () => adjustStockMany([{ id: item.id, delta: -4 }, { id: paint.id, delta: -1 }])));
    const succeeded = results.filter(([error]) => !error).length;
    assert.equal(succeeded, 2);
    assert.equal(ok(await getItem(item.id)).quantity, 2);
  });

  test('still agrees with adjustStock about the history', async () => {
    const before = ok(await getItem(tpu.id)).quantity;
    ok(await adjustStock(tpu.id, { delta: -1 }));
    ok(await adjustStockMany([{ id: tpu.id, delta: -1 }]));
    assert.equal(ok(await getItem(tpu.id)).quantity, before - 2);
  });
});
