import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { kempoInventoryField, kempoInventoryCategory } from '../server/db/schema.js';
import { createField, updateField, getField } from '../server/utils/fields.js';

/*
  Moving a field to another scope (Applies to) against PGlite, the unit tier's in-memory database.
  It empties the field and category tables first.
*/
const unitTier = process.env.KEMPO_DB === 'pglite';

const ok = ([error, value]) => {
  assert.equal(error, null, error?.msg);
  return value;
};

after(() => unitTier ? db.$client.close() : null);

describe('moving a field between Every item and a category', { skip: unitTier ? false : 'runs in the unit tier (KEMPO_DB=pglite)' }, () => {
  before(async () => {
    await db.delete(kempoInventoryField);
    await db.delete(kempoInventoryCategory);
  });

  test('a category field moves to every item, keeping its label and type', async () => {
    ok(await createField({ label: 'Brand', type: 'text', category: 'Paint' }));
    const moved = ok(await updateField('brand', { category: '' }, { category: 'paint' }));
    assert.equal(moved.category, '');
    assert.equal(ok(await getField('brand', '')).label, 'Brand');
    assert.equal(ok(await getField('brand', '')).type, 'text');
  });

  test('an every-item field moves into a category and that category exists as a record', async () => {
    ok(await createField({ label: 'Notes', type: 'text' }));
    const moved = ok(await updateField('notes', { category: 'Filament' }, { category: '' }));
    assert.equal(moved.category, 'filament');
    assert.equal(ok(await getField('notes', 'filament')).key, 'notes');
    const [record] = await db.select().from(kempoInventoryCategory).where(eq(kempoInventoryCategory.key, 'filament'));
    assert.equal(record.name, 'Filament');
  });

  test('a move that would collide with a key already in the new scope is refused', async () => {
    ok(await createField({ label: 'Size', type: 'text', category: 'Paint' }));
    ok(await createField({ label: 'Size', type: 'text', category: 'Filament' }));
    const [error] = await updateField('size', { category: '' }, { category: 'paint' });
    assert.equal(error.code, 409);
    assert.equal(ok(await getField('size', 'paint')).key, 'size', 'left where it was');
  });

  test('sending the current scope back changes nothing and is not an error', async () => {
    const field = ok(await updateField('brand', { category: '', label: 'Brand' }, { category: '' }));
    assert.equal(field.category, '');
  });
});
