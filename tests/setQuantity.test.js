import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { kempoInventoryItem, kempoInventoryMovement } from '../server/db/schema.js';
import { createItem, adjustQuantity, getItem, getMovements } from '../server/utils/items.js';

/*
  Setting a count and adjustments without a reason, against a real database. Runs in the unit tier
  (KEMPO_DB=pglite), or against a database whose name ends in _test, and empties the item tables first.
*/
const url = process.env.DATABASE_URL ?? '';
const unitTier = process.env.KEMPO_DB === 'pglite';
const reachable = (unitTier || /_test$/.test(url.split('?')[0])) && await db.execute(sql`select 1`).then(() => true).catch(() => false);

const ok = ([error, value]) => {
  assert.equal(error, null, error?.msg);
  return value;
};

after(() => unitTier ? db.$client.close() : db.$client.end());

describe('setting a count and optional reasons', { skip: reachable ? false : 'no throwaway database (set DATABASE_URL to one ending in _test)' }, () => {
  let paint;

  before(async () => {
    await db.delete(kempoInventoryMovement);
    await db.delete(kempoInventoryItem);
    paint = ok(await createItem({ sku: 'PAINT-SET', name: 'Paint', quantity: 2, unit: 'oz' }));
  });

  after(async () => {
    if(reachable){
      await db.delete(kempoInventoryMovement);
      await db.delete(kempoInventoryItem);
    }
  });

  test('setting a count records the change needed to reach it', async () => {
    const item = ok(await adjustQuantity(paint.id, { set: 5 }));
    assert.equal(item.quantity, 5);
    const latest = ok(await getMovements({ itemId: paint.id, limit: 1 }))[0];
    assert.equal(latest.delta, 3);
    assert.equal(latest.quantityAfter, 5);
  });

  test('setting the count it already has changes nothing and records nothing', async () => {
    const before = ok(await getMovements({ itemId: paint.id, limit: 100 })).length;
    const item = ok(await adjustQuantity(paint.id, { set: 5 }));
    assert.equal(item.quantity, 5);
    assert.equal(ok(await getMovements({ itemId: paint.id, limit: 100 })).length, before);
  });

  test('a reason is optional: none is stored as none', async () => {
    ok(await adjustQuantity(paint.id, { delta: -1, reason: '' }));
    const latest = ok(await getMovements({ itemId: paint.id, limit: 1 }))[0];
    assert.equal(latest.reason, '');
    assert.equal(latest.delta, -1);
  });

  test('a count below zero is refused, and setting zero is allowed', async () => {
    const [error] = await adjustQuantity(paint.id, { set: -1 });
    assert.equal(error.code, 400);
    assert.equal(ok(await adjustQuantity(paint.id, { set: 0 })).quantity, 0);
  });

  test('a fraction is refused until decimal_quantity is on', async () => {
    const [error] = await adjustQuantity(paint.id, { set: 2.5 });
    assert.equal(error.code, 400);
    assert.equal((await getItem(paint.id))[1].quantity, 0);
  });

  test('a unit is kept on the item and shown as its effective unit', async () => {
    const item = ok(await getItem(paint.id));
    assert.equal(item.unit, 'oz');
    assert.equal(item.effectiveUnit, 'oz');
  });
});
