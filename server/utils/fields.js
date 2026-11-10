import db from 'kempo/server/db/index.js';
import { eq, and, asc, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { kempoInventoryField, kempoInventoryItem, kempoInventoryCategory } from '../db/schema.js';
import { categoryKey, tidyCategory, MAX_CATEGORY } from './categoryLogic.js';
import { normalizeFieldDefinition, OPTIONAL_TYPES, canConvert, coerceValue } from './fieldTypes.js';
import { mediaAvailable } from './media.js';
import { EVENTS, guard, notify } from './hooks.js';

const newId = () => crypto.randomBytes(8).toString('hex');

const isUniqueViolation = error => (error?.code || error?.cause?.code) === '23505';

/*
  The values items hold for a key, each checked as a web address. Resolves to [null, rewrites] with the
  full address of each, or an error naming the first value that is not one.
*/
const addressesOf = async (key, label) => {
  const rows = await db.select({ id: kempoInventoryItem.id, data: kempoInventoryItem.data }).from(kempoInventoryItem)
    .where(sql`${kempoInventoryItem.data}->>${key} IS NOT NULL`);
  const rewrites = [];
  for(const row of rows){
    const value = row.data[key];
    if(value === '' || value === null) continue;
    const [invalid, address] = coerceValue({ type: 'url', label }, value);
    if(invalid || !address) return [{ code: 409, msg: `"${value}" is not a web address, so this cannot become a URL field. Fix that item first` }, null];
    rewrites.push({ id: row.id, data: { ...row.data, [key]: address } });
  }
  return [null, rewrites];
};

/*
  Properties an extension's own field accepts on update, and what anyone else (the admin UI) may
  adjust on a field an extension owns. Key and ownership never change after creation, the scope
  (`category`) can, and the type only changes where nothing can be lost (see CONVERSIONS in fieldTypes.js).
*/
const OWNER_EDITABLE = ['label', 'description', 'required', 'listed', 'suggest', 'options', 'position', 'type', 'imageRatio', 'imageMax', 'category'];
const ANYONE_EDITABLE = ['label', 'description', 'listed', 'suggest', 'position', 'imageRatio', 'imageMax'];

/*
  Every field, each with the `category` key it is scoped to ('' = every item) and `categoryName`
  for display. Pass `category` to get only the fields an item in that category shows: the default
  ones plus that category's ('' gives just the defaults).
*/
export const getFields = async ({ category, owner } = {}) => {
  try {
    const rows = await db.select().from(kempoInventoryField)
      .orderBy(asc(kempoInventoryField.position), asc(kempoInventoryField.created), asc(kempoInventoryField.id));
    const records = await db.select({ key: kempoInventoryCategory.key, name: kempoInventoryCategory.name }).from(kempoInventoryCategory);
    const names = new Map(records.map(r => [r.key, r.name]));
    let fields = rows.map(f => ({ ...f, categoryName: f.category ? names.get(f.category) ?? f.category : '' }));
    if(category !== undefined){
      const key = categoryKey(category);
      fields = fields.filter(f => !f.category || f.category === key);
    }
    if(owner !== undefined) fields = fields.filter(f => f.owner === String(owner ?? ''));
    return [null, fields];
  } catch {
    return [{ code: 500, msg: 'Failed to retrieve fields' }, null];
  }
};

/* A field is identified by its key and the category it belongs to ('' for the default scope). */
export const getField = async (key, category = '') => {
  if(!key) return [{ code: 400, msg: 'Field key is required' }, null];
  try {
    const [field] = await db.select().from(kempoInventoryField)
      .where(and(eq(kempoInventoryField.key, key), eq(kempoInventoryField.category, categoryKey(category))));
    if(!field) return [{ code: 404, msg: 'Field not found' }, null];
    return [null, field];
  } catch {
    return [{ code: 500, msg: 'Failed to retrieve field' }, null];
  }
};

/* The items a field's values live on: everything for a default field, otherwise that category's items. */
export const itemsInScope = category => category
  ? sql`lower(regexp_replace(btrim(${kempoInventoryItem.category}), '[[:space:]]+', ' ', 'g')) = ${category}`
  : sql`true`;

/*
  Items in a category hold the default fields and that category's under one set of names, so a
  key cannot be reused where it would collide: a default field's key is taken in every category,
  and a category's key is taken in the default scope. `exclude` is the scope the field is leaving.
*/
const keyClash = async (key, scope, exclude = null) => {
  const [clash] = await db.select({ category: kempoInventoryField.category }).from(kempoInventoryField).where(and(
    eq(kempoInventoryField.key, key),
    exclude === null ? sql`true` : sql`${kempoInventoryField.category} <> ${exclude}`,
    scope ? sql`${kempoInventoryField.category} in ('', ${scope})` : sql`true`,
  ));
  if(!clash) return null;
  const where = clash.category === scope ? (scope ? 'this category' : 'the default fields') : (scope ? 'the default fields' : 'a category');
  return { code: 409, msg: `A field with the key "${key}" already exists in ${where}` };
};

/*
  Creates a field. `owner` is '' for a field made by a person in the admin, or the extension's
  name for one it registers itself.
*/
export const createField = async (definition, { owner = '' } = {}) => {
  const [invalid, normalized] = normalizeFieldDefinition(definition);
  if(invalid) return [invalid, null];

  const refused = await guard(EVENTS.fieldBeforeCreate, { draft: { ...normalized, category: tidyCategory(definition?.category) }, actor: owner });
  if(refused) return [refused, null];

  /* `definition.category` names the category the field belongs to; empty means every item. */
  const categoryName = tidyCategory(definition?.category);
  if(categoryName.length > MAX_CATEGORY) return [{ code: 400, msg: `A category name must be ${MAX_CATEGORY} characters or fewer` }, null];
  const scope = categoryKey(categoryName);
  if(normalized.type === 'media' && !(await mediaAvailable())){
    return [{ code: 409, msg: `Media fields need the ${OPTIONAL_TYPES.media} extension, which is not installed` }, null];
  }

  try {
    const clash = await keyClash(normalized.key, scope);
    if(clash) return [clash, null];

    const field = await db.transaction(async tx => {
      if(scope){
        /* A category with a field has to exist as a record, even before any item uses it. */
        const now = new Date();
        await tx.insert(kempoInventoryCategory)
          .values({ id: newId(), key: scope, name: categoryName, image: null, created: now, updated: now })
          .onConflictDoNothing();
      }
      const [created] = await tx.insert(kempoInventoryField)
        .values({ id: newId(), ...normalized, category: scope, owner, created: new Date() })
        .returning();
      return created;
    });
    await notify(EVENTS.fieldCreated, { field, actor: owner });
    return [null, field];
  } catch(error) {
    if(isUniqueViolation(error)) return [{ code: 409, msg: `A field with the key "${normalized.key}" already exists` }, null];
    return [{ code: 500, msg: 'Failed to create field' }, null];
  }
};

export const updateField = async (key, changes = {}, { owner = null, category = '' } = {}) => {
  const [lookupError, existing] = await getField(key, category);
  if(lookupError) return [lookupError, null];

  const targetName = changes.category === undefined ? undefined : tidyCategory(changes.category);
  const targetScope = targetName === undefined ? existing.category : categoryKey(targetName);
  const scopeChanged = targetScope !== existing.category;
  if(scopeChanged && targetName.length > MAX_CATEGORY) return [{ code: 400, msg: `A category name must be ${MAX_CATEGORY} characters or fewer` }, null];

  const targetType = changes.type ?? existing.type;
  if(!canConvert(existing.type, targetType)){
    return [{ code: 409, msg: `A ${existing.type} field cannot be changed to ${targetType}. Delete it and create a new one instead` }, null];
  }
  const isOwner = existing.owner === (owner ?? '');
  const allowed = isOwner ? OWNER_EDITABLE : ANYONE_EDITABLE;
  const rejected = Object.keys(changes).filter(k => k !== 'key' && !(k === 'category' && !scopeChanged) && !(k === 'type' && targetType === existing.type) && !allowed.includes(k));
  if(rejected.length){
    return [{ code: 403, msg: `${rejected.join(', ')} can only be changed by ${existing.owner ? `the "${existing.owner}" extension` : 'the field\'s owner'}` }, null];
  }

  const [invalid, normalized] = normalizeFieldDefinition({ ...existing, ...changes, key: existing.key, type: targetType });
  if(invalid) return [invalid, null];

  const updates = {};
  for(const property of allowed){
    if(property !== 'category' && changes[property] !== undefined) updates[property] = normalized[property];
  }
  if(targetType !== existing.type){
    /* Converting: the type changes, and what only made sense for the old type goes with it. */
    updates.type = targetType;
    updates.options = normalized.options;
    updates.suggest = normalized.suggest;
  }
  if(scopeChanged){
    const clash = await keyClash(existing.key, targetScope, existing.category);
    if(clash) return [clash, null];
    updates.category = targetScope;
  }
  if(!Object.keys(updates).length) return [{ code: 400, msg: 'No changes provided' }, null];

  /* Text to a URL: every value already held must be a web address, and is rewritten as the full address. */
  let rewrites = [];
  if(targetType === 'url' && existing.type !== 'url'){
    const [addressError, found] = await addressesOf(key, existing.label);
    if(addressError) return [addressError, null];
    rewrites = found;
  }

  const refused = await guard(EVENTS.fieldBeforeUpdate, { field: existing, changes: updates, actor: owner ?? '' });
  if(refused) return [refused, null];

  try {
    const field = await db.transaction(async tx => {
      if(scopeChanged && targetScope){
        /* Moving into a category: it has to exist as a record, as it does when a field is created there. */
        const now = new Date();
        await tx.insert(kempoInventoryCategory)
          .values({ id: newId(), key: targetScope, name: targetName, image: null, created: now, updated: now })
          .onConflictDoNothing();
      }
      for(const rewrite of rewrites){
        await tx.update(kempoInventoryItem).set({ data: rewrite.data }).where(eq(kempoInventoryItem.id, rewrite.id));
      }
      const [updated] = await tx.update(kempoInventoryField).set(updates)
        .where(and(eq(kempoInventoryField.key, key), eq(kempoInventoryField.category, existing.category))).returning();
      return updated;
    });
    await notify(EVENTS.fieldUpdated, { field, previous: existing, actor: owner ?? '' });
    return [null, field];
  } catch {
    return [{ code: 500, msg: 'Failed to update field' }, null];
  }
};

/*
  Deletes a field and the values items hold for it. A person using the admin deletes their own
  fields (owner ''); an extension deletes the ones it registered.
*/
export const deleteField = async (key, { owner = '', category = '' } = {}) => {
  const [lookupError, existing] = await getField(key, category);
  if(lookupError) return [lookupError, null];
  if(existing.owner !== owner){
    return [{ code: 403, msg: `This field is managed by the "${existing.owner}" extension and cannot be deleted here` }, null];
  }
  const refused = await guard(EVENTS.fieldBeforeDelete, { field: existing, actor: owner });
  if(refused) return [refused, null];

  try {
    await db.transaction(async tx => {
      await tx.update(kempoInventoryItem).set({ data: sql`${kempoInventoryItem.data} - ${key}::text` }).where(itemsInScope(existing.category));
      await tx.delete(kempoInventoryField).where(and(eq(kempoInventoryField.key, key), eq(kempoInventoryField.category, existing.category)));
    });
    await notify(EVENTS.fieldDeleted, { field: existing, actor: owner });
    return [null, { success: true }];
  } catch {
    return [{ code: 500, msg: 'Failed to delete field' }, null];
  }
};

/*
  Idempotent: safe to call from an extension's install.js and again on every update. Creates the
  field if it is new, otherwise refreshes what the owner is allowed to change. Refuses to take
  over a key another owner holds, or to change an existing field's type.

  `definition.category` scopes the field to one category (see registerCategory); without it the
  field is on every item.
*/
export const registerField = async (owner, definition) => {
  if(!owner) return [{ code: 400, msg: 'An owner (your extension name) is required' }, null];
  const [invalid, normalized] = normalizeFieldDefinition(definition);
  if(invalid) return [invalid, null];

  const category = tidyCategory(definition?.category);
  const [lookupError, existing] = await getField(normalized.key, category);
  if(lookupError && lookupError.code !== 404) return [lookupError, null];
  if(!existing) return createField({ ...normalized, category }, { owner });

  if(existing.owner !== owner){
    return [{ code: 409, msg: `The key "${normalized.key}" is already used by ${existing.owner ? `the "${existing.owner}" extension` : 'a user-defined field'}` }, null];
  }
  if(existing.type !== normalized.type){
    return [{ code: 409, msg: `"${normalized.key}" already exists as a ${existing.type} field` }, null];
  }
  const { key, type, ...changes } = normalized;
  return updateField(normalized.key, changes, { owner, category });
};

export const registerFields = async (owner, definitions = []) => {
  const registered = [];
  for(const definition of definitions){
    const [error, field] = await registerField(owner, definition);
    if(error) return [error, registered];
    registered.push(field);
  }
  return [null, registered];
};

/*
  For an extension's uninstall.js: removes every field it registered, and their values.
*/
export const unregisterFields = async owner => {
  if(!owner) return [{ code: 400, msg: 'An owner (your extension name) is required' }, null];
  const [error, fields] = await getFields();
  if(error) return [error, null];
  let removed = 0;
  for(const field of fields.filter(f => f.owner === owner)){
    const [deleteError] = await deleteField(field.key, { owner, category: field.category });
    if(deleteError) return [deleteError, null];
    removed++;
  }
  return [null, { removed }];
};
