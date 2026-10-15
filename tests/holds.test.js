import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { kempoInventoryItem, kempoInventoryMovement } from '../server/db/schema.js';
import { createItem, adjustStock, deleteItem, getItem, getMovements } from '../server/utils/items.js';
import { holdStock, releaseStock, consumeHeld } from '../server/utils/holds.js';

/*
  Held stock against a real database. It skips itself when none is reachable, or when the database
  is not obviously a throwaway one (its name must end in _test): it empties the item tables first.

  Requires Postgres carrying kempo's schema and this extension's (`npx drizzle-kit push --force`)
  with DATABASE_URL set.
*/
const url = process.env.DATABASE_URL ?? '';
const unitTier = process.env.KEMPO_DB === 'pglite';
const reachable = (unitTier || /_test$/.test(url.split('?')[0])) && await db.execute(sql`select 1`).then(() => true).catch(() => false);

if(!reachable && process.env.KEMPO_TEST_TIER === 'integration'){
  throw new Error('The integration tier needs DATABASE_URL pointing at a throwaway Postgres named *_test with the schema applied (npx drizzle-kit push --force).');
}

const ok = ([error, value]) => {
  assert.equal(error, null, error?.msg);
  return value;
};

const refused = ([error, value], code) => {
  assert.ok(error, 'expected an error');
  assert.equal(value, null);
  if(code) assert.equal(error.code, code, error.msg);
  return error;
};

const figures = async id => {
  const item = ok(await getItem(id));
  return { available: item.quantity, held: item.held };
};

after(() => unitTier ? db.$client.close() : db.$client.end());

describe('held stock', { skip: reachable ? false : 'no throwaway database (set DATABASE_URL to one ending in _test)' }, () => {
  let resin;
  let paint;

  before(async () => {
    await db.delete(kempoInventoryMovement);
    await db.delete(kempoInventoryItem);
  });

  after(async () => {
    if(reachable){
      await db.delete(kempoInventoryMovement);
      await db.delete(kempoInventoryItem);
    }
  });

  const fresh = async () => {
    await db.delete(kempoInventoryMovement);
    await db.delete(kempoInventoryItem);
    resin = ok(await createItem({ sku: 'RESIN', name: 'Resin (g)', quantity: 1000 }));
    paint = ok(await createItem({ sku: 'PAINT', name: 'Paint (ml)', quantity: 50 }));
  };

  test('a new item holds nothing', async () => {
    await fresh();
    assert.deepEqual(await figures(resin.id), { available: 1000, held: 0 });
  });

  test('holding moves stock from available to held, and the total is unchanged', async () => {
    const { items } = ok(await holdStock([{ id: resin.id, quantity: 175 }], { ref: 'order-1' }));
    assert.equal(items[0].quantity, 825);
    assert.equal(items[0].held, 175);
    assert.deepEqual(await figures(resin.id), { available: 825, held: 175 });
  });

  test('every move is a movement with what it did to both figures', async () => {
    const movements = ok(await getMovements({ itemId: resin.id }));
    const hold = movements.find(movement => movement.reason === 'hold');
    assert.equal(hold.delta, -175);
    assert.equal(hold.quantityAfter, 825);
    assert.equal(hold.heldDelta, 175);
    assert.equal(hold.heldAfter, 175);
    assert.match(hold.note, /\[order-1\]/);
  });

  test('releasing gives held stock back to available', async () => {
    ok(await releaseStock([{ id: resin.id, quantity: 75 }], { ref: 'order-1' }));
    assert.deepEqual(await figures(resin.id), { available: 900, held: 100 });
  });

  test('consuming uses held stock up: it leaves held and does not return to available', async () => {
    ok(await consumeHeld([{ id: resin.id, quantity: 100 }], { ref: 'order-1' }));
    assert.deepEqual(await figures(resin.id), { available: 900, held: 0 });
    const consume = ok(await getMovements({ itemId: resin.id })).find(movement => movement.reason === 'consume');
    assert.equal(consume.delta, 0);
    assert.equal(consume.heldDelta, -100);
    assert.equal(consume.heldAfter, 0);
  });

  test('a hold cannot be larger than what is available, and a refusal changes nothing', async () => {
    await fresh();
    const error = refused(await holdStock([{ id: paint.id, quantity: 51 }]), 409);
    assert.match(error.msg, /Paint/);
    assert.deepEqual(await figures(paint.id), { available: 50, held: 0 });
  });

  test('releasing or consuming more than is held is refused', async () => {
    ok(await holdStock([{ id: paint.id, quantity: 10 }]));
    refused(await releaseStock([{ id: paint.id, quantity: 11 }]), 409);
    refused(await consumeHeld([{ id: paint.id, quantity: 11 }]), 409);
    assert.deepEqual(await figures(paint.id), { available: 40, held: 10 });
  });

  test('several items are all or nothing', async () => {
    await fresh();
    refused(await holdStock([{ id: resin.id, quantity: 100 }, { id: paint.id, quantity: 500 }]), 409);
    assert.deepEqual(await figures(resin.id), { available: 1000, held: 0 });

    ok(await holdStock([{ id: resin.id, quantity: 100 }, { id: paint.id, quantity: 20 }]));
    assert.deepEqual(await figures(resin.id), { available: 900, held: 100 });
    assert.deepEqual(await figures(paint.id), { available: 30, held: 20 });
  });

  test('the same item twice in one call is added together', async () => {
    ok(await holdStock([{ id: resin.id, quantity: 10 }, { id: resin.id, quantity: 15 }]));
    assert.deepEqual(await figures(resin.id), { available: 875, held: 125 });
  });

  test('quantities must be whole numbers above zero, and items must exist', async () => {
    for(const quantity of [0, -5, 1.5, 'x', null]){
      refused(await holdStock([{ id: resin.id, quantity }]), 400);
    }
    refused(await holdStock([]), 400);
    refused(await holdStock([{ id: 'nope', quantity: 1 }]), 404);
  });

  test('a single change can be given without a list', async () => {
    await fresh();
    ok(await holdStock({ id: resin.id, quantity: 5 }));
    assert.deepEqual(await figures(resin.id), { available: 995, held: 5 });
  });

  test('adjusting stock leaves what is held alone, and the movement says how much is held', async () => {
    ok(await adjustStock(resin.id, { delta: 100, reason: 'restock' }));
    assert.deepEqual(await figures(resin.id), { available: 1095, held: 5 });
    const restock = ok(await getMovements({ itemId: resin.id })).find(movement => movement.reason === 'restock');
    assert.equal(restock.heldAfter, 5);
  });

  test('an item with stock on hold cannot be deleted until it is given back', async () => {
    refused(await deleteItem(resin.id), 409);
    ok(await releaseStock({ id: resin.id, quantity: 5 }));
    ok(await deleteItem(resin.id));
  });

  test('held stock never exceeds what was available, even all at once', async () => {
    await fresh();
    const results = await Promise.all(Array.from({ length: 30 }, () => holdStock([{ id: paint.id, quantity: 2 }])));
    const held = results.filter(([error]) => !error).length;
    assert.equal(held, 25, '50 available, 2 each');
    assert.deepEqual(await figures(paint.id), { available: 0, held: 50 });
    assert.ok(results.filter(([error]) => error).every(([error]) => error.code === 409));
  });

  test('releasing and consuming at once never takes held below zero', async () => {
    const calls = [
      ...Array.from({ length: 10 }, () => releaseStock([{ id: paint.id, quantity: 10 }])),
      ...Array.from({ length: 10 }, () => consumeHeld([{ id: paint.id, quantity: 10 }])),
    ];
    const results = await Promise.all(calls);
    assert.equal(results.filter(([error]) => !error).length, 5, '50 held, 10 each');
    const { held, available } = await figures(paint.id);
    assert.equal(held, 0);
    assert.ok(available >= 0 && available <= 50);
  });
});
