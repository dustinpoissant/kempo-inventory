import db from 'kempo/server/db/index.js';
import { eq, and, or, ilike, sql, desc, asc, inArray } from 'drizzle-orm';
import crypto from 'crypto';
import { kempoInventoryItem, kempoInventoryMovement } from '../db/schema.js';
import { getFields } from './fields.js';
import { coerceValues, applicableFields, KEY_PATTERN, isEmpty } from './fieldTypes.js';
import { EVENTS, guard, notify } from './hooks.js';
import { tidyCategory, categoryKey, MAX_CATEGORY } from './categoryLogic.js';
import { normalizeTags, tidyTag } from './tags.js';
import { getAssets, checkAssets } from './media.js';
import { lockedItemChanges, notYours, ownerLabel } from './ownership.js';

const newId = () => crypto.randomBytes(8).toString('hex');

const toInt = (value, fallback) => {
  if(isEmpty(value)) return fallback;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
};

const isUniqueViolation = error => (error?.code || error?.cause?.code) === '23505';

/*
  The shape callers see: core properties plus `fields`, the values of the custom fields.
*/
const shape = row => row && ({
  id: row.id,
  sku: row.sku,
  name: row.name,
  description: row.description,
  category: row.category,
  quantity: row.quantity,
  tags: row.tags ?? [],
  fields: row.data ?? {},
  owner: row.owner,
  created: row.created,
  updated: row.updated,
});

/*
  Returns a map of id -> { id, sku, name } for every item the given items link to, so a client can
  show "Widget (W-100)" instead of an opaque id. A missing entry means the linked item was deleted.
*/
const resolveLinks = async (items, fields) => {
  const linkKeys = fields.filter(f => f.type === 'item').map(f => f.key);
  const ids = new Set();
  for(const item of items) for(const key of linkKeys) if(item.fields[key]) ids.add(item.fields[key]);
  if(!ids.size) return {};
  const rows = await db.select({ id: kempoInventoryItem.id, sku: kempoInventoryItem.sku, name: kempoInventoryItem.name })
    .from(kempoInventoryItem).where(inArray(kempoInventoryItem.id, [...ids]));
  return Object.fromEntries(rows.map(r => [r.id, r]));
};

/*
  Checks every `item` value points at a real item (and not at the item itself).
*/
/*
  `existing` is the item's current values when updating. Files it already holds are not checked
  again: an item with a photo from a library that is switched off can still be renamed, because
  only files being *added* need their library to be there.
*/
const checkLinks = async (fields, values, ownId = null, existing = {}) => {
  for(const field of fields.filter(f => f.type === 'item')){
    const id = values[field.key];
    if(!id) continue;
    if(id === ownId) return { code: 400, msg: `${field.label}: an item cannot link to itself` };
    const [row] = await db.select({ id: kempoInventoryItem.id }).from(kempoInventoryItem).where(eq(kempoInventoryItem.id, id));
    if(!row) return { code: 400, msg: `${field.label}: the linked item does not exist` };
  }
  for(const field of fields.filter(f => f.type === 'media')){
    const ids = values[field.key];
    if(!ids?.length) continue;
    const added = ids.filter(id => !(existing[field.key] ?? []).includes(id));
    const problem = added.length ? await checkAssets(added, field.label) : null;
    if(problem) return problem;
  }
  return null;
};

/*
  Returns a map of id -> a description of each media file the given items hold, for display.
  Empty when kempo-media is not installed, so a client simply has nothing to show.
*/
const resolveMedia = async (items, fields) => {
  const mediaKeys = fields.filter(f => f.type === 'media').map(f => f.key);
  const ids = [];
  for(const item of items) for(const key of mediaKeys) ids.push(...(item.fields[key] ?? []));
  return getAssets(ids);
};

const withoutNulls = values => Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null));

/*
  `ids` fetches exactly those items (any that no longer exist are simply absent), and `owner` keeps
  the items one owner manages: an extension name, or '' for the ones people manage.
*/
export const getItems = async ({ q, category, tag, uncategorised = false, filters = {}, ids, owner, limit = 50, offset = 0 } = {}) => {
  try {
    const [fieldsError, fields] = await getFields();
    if(fieldsError) return [fieldsError, null];
    const known = new Set(fields.map(f => f.key));

    const conditions = [];
    if(q){
      const like = `%${q}%`;
      conditions.push(or(
        ilike(kempoInventoryItem.name, like),
        ilike(kempoInventoryItem.sku, like),
        ilike(kempoInventoryItem.description, like),
        ilike(kempoInventoryItem.category, like),
        sql`${kempoInventoryItem.tags}::text ilike ${like}`,
        sql`${kempoInventoryItem.data}::text ilike ${like}`
      ));
    }
    /* Categories match ignoring case and spacing, the same way the category list groups them. */
    if(category){
      conditions.push(sql`lower(regexp_replace(btrim(${kempoInventoryItem.category}), '[[:space:]]+', ' ', 'g')) = ${categoryKey(category)}`);
    }
    /* Exact tags, any number of them: an item must have every one. */
    for(const wanted of [tag].flat().map(tidyTag).filter(Boolean)){
      conditions.push(sql`${kempoInventoryItem.tags} @> ${JSON.stringify([wanted])}::jsonb`);
    }
    if(uncategorised) conditions.push(sql`btrim(${kempoInventoryItem.category}) = ''`);
    if(ids !== undefined) conditions.push(inArray(kempoInventoryItem.id, [ids].flat().map(String)));
    if(owner !== undefined) conditions.push(eq(kempoInventoryItem.owner, String(owner ?? '')));
    for(const [key, value] of Object.entries(filters || {})){
      if(!KEY_PATTERN.test(key) || !known.has(key)) return [{ code: 400, msg: `Unknown field "${key}"` }, null];
      conditions.push(sql`${kempoInventoryItem.data}->>${key} = ${String(value)}`);
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const rows = await db.select().from(kempoInventoryItem).where(where)
      .orderBy(asc(kempoInventoryItem.name), asc(kempoInventoryItem.id)).limit(limit).offset(offset);
    const [{ total }] = await db.select({ total: sql`count(*)::int` }).from(kempoInventoryItem).where(where);
    const items = rows.map(shape);
    return [null, { items, total, linked: await resolveLinks(items, fields), media: await resolveMedia(items, fields) }];
  } catch {
    return [{ code: 500, msg: 'Failed to retrieve items' }, null];
  }
};

export const getItem = async id => {
  if(!id) return [{ code: 400, msg: 'Item ID is required' }, null];
  try {
    const [row] = await db.select().from(kempoInventoryItem).where(eq(kempoInventoryItem.id, id));
    if(!row) return [{ code: 404, msg: 'Item not found' }, null];
    return [null, shape(row)];
  } catch {
    return [{ code: 500, msg: 'Failed to retrieve item' }, null];
  }
};

export const getItemBySku = async sku => {
  if(!sku) return [{ code: 400, msg: 'SKU is required' }, null];
  try {
    const [row] = await db.select().from(kempoInventoryItem).where(eq(kempoInventoryItem.sku, sku));
    if(!row) return [{ code: 404, msg: 'Item not found' }, null];
    return [null, shape(row)];
  } catch {
    return [{ code: 500, msg: 'Failed to retrieve item' }, null];
  }
};

/*
  Resolves link ids for a single item (see resolveLinks).
*/
export const getLinked = async items => {
  const [error, fields] = await getFields();
  if(error) return [error, null];
  try {
    return [null, await resolveLinks(Array.isArray(items) ? items : [items], fields)];
  } catch {
    return [{ code: 500, msg: 'Failed to resolve linked items' }, null];
  }
};

/*
  Resolves media values to display descriptions (see resolveMedia).
*/
export const getMedia = async items => {
  const [error, fields] = await getFields();
  if(error) return [error, null];
  try {
    return [null, await resolveMedia(Array.isArray(items) ? items : [items], fields)];
  } catch {
    return [{ code: 500, msg: 'Failed to resolve media' }, null];
  }
};

/*
  `owner` (an extension name, from the server SDK only) marks the item as that extension's: see
  ownership.js for what that protects. It cannot be changed afterwards and is not part of the draft.
*/
export const createItem = async ({ sku, name, description = '', category = '', tags = [], quantity, fields: values = {}, userId = '' } = {}, { owner = '' } = {}) => {
  /*
    The draft is what a before_create hook sees and may edit: it can fill in or change any
    property, or throw { code, msg } to refuse. Everything is validated after the hooks have run,
    so a hook cannot smuggle in a value that would not otherwise be accepted.
  */
  const draft = { sku, name, description, category, tags, quantity, fields: { ...values } };
  const refused = await guard(EVENTS.itemBeforeCreate, { draft, userId, actor: owner });
  if(refused) return [refused, null];

  const cleanSku = String(draft.sku ?? '').trim();
  const cleanName = String(draft.name ?? '').trim();
  if(!cleanSku) return [{ code: 400, msg: 'SKU is required' }, null];
  if(!cleanName) return [{ code: 400, msg: 'Name is required' }, null];
  const cleanCategory = tidyCategory(draft.category);
  if(cleanCategory.length > MAX_CATEGORY) return [{ code: 400, msg: `Category must be ${MAX_CATEGORY} characters or fewer` }, null];
  const [tagsError, cleanTags] = normalizeTags(draft.tags);
  if(tagsError) return [tagsError, null];
  const qty = toInt(draft.quantity, 0);
  if(Number.isNaN(qty) || qty < 0) return [{ code: 400, msg: 'Quantity must be a non-negative whole number' }, null];

  const [fieldsError, fields] = await getFields();
  if(fieldsError) return [fieldsError, null];
  const [invalid, coerced] = coerceValues(applicableFields(fields, cleanCategory), draft.fields ?? {});
  if(invalid) return [invalid, null];
  const linkError = await checkLinks(fields, coerced);
  if(linkError) return [linkError, null];

  const now = new Date();
  try {
    const row = await db.transaction(async tx => {
      const [created] = await tx.insert(kempoInventoryItem).values({
        id: newId(), sku: cleanSku, name: cleanName, description: String(draft.description ?? '').trim(), category: cleanCategory, tags: cleanTags,
        quantity: qty, data: withoutNulls(coerced), owner, created: now, updated: now,
      }).returning();
      if(qty > 0){
        await tx.insert(kempoInventoryMovement).values({
          id: newId(), itemId: created.id, delta: qty, quantityAfter: qty,
          reason: 'initial', note: 'Initial stock', userId, created: now,
        });
      }
      return created;
    });
    const item = shape(row);
    await notify(EVENTS.itemCreated, { item, userId, actor: owner });
    return [null, item];
  } catch(error) {
    if(isUniqueViolation(error)) return [{ code: 409, msg: 'An item with that SKU already exists' }, null];
    return [{ code: 500, msg: 'Failed to create item' }, null];
  }
};

/*
  Updates sku, name, description and custom field values. Quantity is not editable here: it only
  changes through adjustStock, which keeps the movement history honest.
*/
export const updateItem = async (id, { sku, name, description, category, tags, fields: values, userId = '' } = {}, { owner = '' } = {}) => {
  const [lookupError, existing] = await getItem(id);
  if(lookupError) return [lookupError, null];

  const changes = {};
  if(sku !== undefined) changes.sku = sku;
  if(name !== undefined) changes.name = name;
  if(description !== undefined) changes.description = description;
  if(category !== undefined) changes.category = category;
  if(tags !== undefined) changes.tags = tags;
  if(values !== undefined) changes.fields = { ...values };

  const refused = await guard(EVENTS.itemBeforeUpdate, { item: existing, changes, userId, actor: owner });
  if(refused) return [refused, null];

  /* After the guards, so a hook cannot edit its way past it. */
  const locked = lockedItemChanges(existing, changes, owner);
  if(locked.length) return [{ code: 403, msg: `${locked.join(', ')} can only be changed by ${ownerLabel(existing.owner)}` }, null];

  const updates = {};
  if(changes.sku !== undefined){
    updates.sku = String(changes.sku).trim();
    if(!updates.sku) return [{ code: 400, msg: 'SKU cannot be empty' }, null];
  }
  if(changes.name !== undefined){
    updates.name = String(changes.name).trim();
    if(!updates.name) return [{ code: 400, msg: 'Name cannot be empty' }, null];
  }
  if(changes.description !== undefined) updates.description = String(changes.description).trim();
  if(changes.category !== undefined){
    updates.category = tidyCategory(changes.category);
    if(updates.category.length > MAX_CATEGORY) return [{ code: 400, msg: `Category must be ${MAX_CATEGORY} characters or fewer` }, null];
  }

  if(changes.tags !== undefined){
    const [tagsError, cleanTags] = normalizeTags(changes.tags);
    if(tagsError) return [tagsError, null];
    updates.tags = cleanTags;
  }

  if(changes.fields !== undefined){
    const [fieldsError, fields] = await getFields();
    if(fieldsError) return [fieldsError, null];
    /* Only the fields of the category the item will be in. Values it holds for others are kept, just not shown. */
    const [invalid, coerced] = coerceValues(applicableFields(fields, updates.category ?? existing.category), changes.fields, { partial: true });
    if(invalid) return [invalid, null];
    const linkError = await checkLinks(fields, coerced, id, existing.fields);
    if(linkError) return [linkError, null];
    updates.data = withoutNulls({ ...existing.fields, ...coerced });
    for(const [key, value] of Object.entries(coerced)) if(value === null) delete updates.data[key];
  }
  if(!Object.keys(updates).length) return [{ code: 400, msg: 'No changes provided' }, null];
  updates.updated = new Date();

  try {
    const [row] = await db.update(kempoInventoryItem).set(updates).where(eq(kempoInventoryItem.id, id)).returning();
    if(!row) return [{ code: 404, msg: 'Item not found' }, null];
    const item = shape(row);
    await notify(EVENTS.itemUpdated, { item, previous: existing, userId, actor: owner });
    return [null, item];
  } catch(error) {
    if(isUniqueViolation(error)) return [{ code: 409, msg: 'An item with that SKU already exists' }, null];
    return [{ code: 500, msg: 'Failed to update item' }, null];
  }
};

export const deleteItem = async (id, { userId = '', owner = '' } = {}) => {
  const [lookupError, existing] = await getItem(id);
  if(lookupError) return [lookupError, null];
  if(existing.owner !== owner) return [notYours('item', existing, owner), null];

  const refused = await guard(EVENTS.itemBeforeDelete, { item: existing, userId, actor: owner });
  if(refused) return [refused, null];

  try {
    const deleted = await db.transaction(async tx => {
      const rows = await tx.delete(kempoInventoryItem).where(eq(kempoInventoryItem.id, id)).returning();
      if(rows.length) await tx.delete(kempoInventoryMovement).where(eq(kempoInventoryMovement.itemId, id));
      return rows.length;
    });
    if(!deleted) return [{ code: 404, msg: 'Item not found' }, null];
    await notify(EVENTS.itemDeleted, { item: existing, userId, actor: owner });
    return [null, { success: true }];
  } catch {
    return [{ code: 500, msg: 'Failed to delete item' }, null];
  }
};

/*
  Atomic: the quantity changes in a single UPDATE guarded against going negative,
  so concurrent adjustments cannot oversell.
*/
/* Anyone may adjust stock, owned item or not; `owner` only tells hooks which extension did it. */
export const adjustStock = async (id, { delta, reason = 'adjustment', note = '', userId = '', owner = '' } = {}) => {
  const [lookupError, existing] = await getItem(id);
  if(lookupError) return [lookupError, null];

  const draft = { delta, reason, note };
  const refused = await guard(EVENTS.stockBeforeAdjust, { item: existing, draft, userId, actor: owner });
  if(refused) return [refused, null];

  const change = toInt(draft.delta, NaN);
  if(Number.isNaN(change) || change === 0) return [{ code: 400, msg: 'delta must be a non-zero whole number' }, null];

  try {
    const result = await db.transaction(async tx => {
      const [row] = await tx.update(kempoInventoryItem)
        .set({ quantity: sql`${kempoInventoryItem.quantity} + ${change}`, updated: new Date() })
        .where(and(eq(kempoInventoryItem.id, id), sql`${kempoInventoryItem.quantity} + ${change} >= 0`))
        .returning();
      if(!row) return null;
      const [movement] = await tx.insert(kempoInventoryMovement).values({
        id: newId(), itemId: id, delta: change, quantityAfter: row.quantity,
        reason: String(draft.reason || 'adjustment'), note: String(draft.note || ''), userId, created: new Date(),
      }).returning();
      return { row, movement };
    });
    if(!result) return [{ code: 409, msg: 'Insufficient stock' }, null];

    const item = shape(result.row);
    await notify(EVENTS.stockAdjusted, {
      item, previousQuantity: item.quantity - change, delta: change,
      reason: result.movement.reason, note: result.movement.note, movement: result.movement, userId, actor: owner,
    });
    return [null, item];
  } catch {
    return [{ code: 500, msg: 'Failed to adjust stock' }, null];
  }
};

/*
  Thrown inside a transaction to roll everything back with a message the caller can show.
*/
class Refusal {
  constructor(error){
    this.error = error;
  }
}

/*
  Applies several stock changes together: every one happens or none does. This is what makes
  taking the materials for a whole recipe safe, where one adjustStock per item could take the resin
  and then fail on the paint. `changes` is [{ id, delta, reason?, note? }]; changes to the same item
  are added together, and one that nets to nothing is left out. Each item runs through the same
  before_adjust guard as adjustStock, and fires the same stock:adjusted notification once everything
  is committed.

    const [error, result] = await adjustStockMany(
      [{ id: resin.id, delta: -175 }, { id: paint.id, delta: -20 }],
      { reason: 'sale', ref: 'order-1042', owner: 'my-extension' },
    );

  `ref` is recorded on every movement so the change can be found and reversed later. A refusal for
  lack of stock is a 409 that names the item, and nothing has changed. Resolves to
  [null, { items }] with the items as they are now.
*/
export const adjustStockMany = async (changes, { reason = 'adjustment', note = '', ref = '', userId = '', owner = '' } = {}) => {
  if(!Array.isArray(changes) || !changes.length) return [{ code: 400, msg: 'changes must be a non-empty list' }, null];

  const totals = new Map();
  for(const change of changes){
    const id = String(change?.id ?? '');
    const delta = toInt(change?.delta, NaN);
    if(!id) return [{ code: 400, msg: 'Every change needs an item id' }, null];
    if(Number.isNaN(delta)) return [{ code: 400, msg: 'Every delta must be a whole number' }, null];
    const entry = totals.get(id) ?? { id, delta: 0, reason: change.reason, note: change.note };
    entry.delta += delta;
    totals.set(id, entry);
  }
  /* In a fixed order, so two overlapping calls lock rows the same way round and cannot deadlock. */
  const wanted = [...totals.values()].filter(entry => entry.delta !== 0).sort((a, b) => a.id.localeCompare(b.id));
  if(!wanted.length) return [null, { items: [] }];

  let rows;
  try {
    rows = await db.select().from(kempoInventoryItem).where(inArray(kempoInventoryItem.id, wanted.map(entry => entry.id)));
  } catch {
    return [{ code: 500, msg: 'Failed to adjust stock' }, null];
  }
  const existing = new Map(rows.map(row => [row.id, shape(row)]));
  const missing = wanted.find(entry => !existing.has(entry.id));
  if(missing) return [{ code: 404, msg: 'An item in this change no longer exists' }, null];

  const drafts = new Map();
  for(const entry of wanted){
    const draft = { delta: entry.delta, reason: entry.reason ?? reason, note: entry.note ?? note };
    const refused = await guard(EVENTS.stockBeforeAdjust, { item: existing.get(entry.id), draft, userId, actor: owner });
    if(refused) return [refused, null];
    const delta = toInt(draft.delta, NaN);
    if(Number.isNaN(delta) || delta === 0) return [{ code: 400, msg: 'delta must be a non-zero whole number' }, null];
    drafts.set(entry.id, { delta, reason: String(draft.reason || 'adjustment'), note: String(draft.note || '') });
  }

  try {
    const applied = await db.transaction(async tx => {
      const results = [];
      for(const entry of wanted){
        const { delta, reason: why, note: text } = drafts.get(entry.id);
        const [row] = await tx.update(kempoInventoryItem)
          .set({ quantity: sql`${kempoInventoryItem.quantity} + ${delta}`, updated: new Date() })
          .where(and(eq(kempoInventoryItem.id, entry.id), sql`${kempoInventoryItem.quantity} + ${delta} >= 0`))
          .returning();
        if(!row) throw new Refusal({ code: 409, msg: `Insufficient stock of ${existing.get(entry.id).name}` });
        const [movement] = await tx.insert(kempoInventoryMovement).values({
          id: newId(), itemId: entry.id, delta, quantityAfter: row.quantity, reason: why,
          note: ref ? `${text ? `${text} ` : ''}[${ref}]` : text, userId, created: new Date(),
        }).returning();
        results.push({ row, movement, delta });
      }
      return results;
    });
    const items = [];
    for(const { row, movement, delta } of applied){
      const item = shape(row);
      items.push(item);
      await notify(EVENTS.stockAdjusted, {
        item, previousQuantity: item.quantity - delta, delta, reason: movement.reason, note: movement.note, movement, userId, actor: owner,
      });
    }
    return [null, { items }];
  } catch(error) {
    if(error instanceof Refusal) return [error.error, null];
    return [{ code: 500, msg: 'Failed to adjust stock' }, null];
  }
};

export const getMovements = async ({ itemId, limit = 50, offset = 0 } = {}) => {
  try {
    const where = itemId ? eq(kempoInventoryMovement.itemId, itemId) : undefined;
    const movements = await db.select().from(kempoInventoryMovement).where(where)
      .orderBy(desc(kempoInventoryMovement.created), desc(kempoInventoryMovement.id)).limit(limit).offset(offset);
    return [null, movements];
  } catch {
    return [{ code: 500, msg: 'Failed to retrieve movements' }, null];
  }
};

/*
  For an extension's uninstall.js: deletes every item it owns, with their history. With `release`
  the items are kept and handed back to the people who manage the inventory instead, which is the
  right choice when they hold real stock.
*/
export const unregisterItems = async (owner, { release = false } = {}) => {
  if(!owner) return [{ code: 400, msg: 'An owner (your extension name) is required' }, null];
  try {
    if(release){
      const rows = await db.update(kempoInventoryItem).set({ owner: '' }).where(eq(kempoInventoryItem.owner, owner)).returning({ id: kempoInventoryItem.id });
      return [null, { released: rows.length }];
    }
    const rows = await db.select({ id: kempoInventoryItem.id }).from(kempoInventoryItem).where(eq(kempoInventoryItem.owner, owner));
    for(const { id } of rows){
      const [error] = await deleteItem(id, { owner });
      if(error) return [error, null];
    }
    return [null, { removed: rows.length }];
  } catch {
    return [{ code: 500, msg: 'Failed to remove the items' }, null];
  }
};
