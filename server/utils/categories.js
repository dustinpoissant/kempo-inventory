import db from 'kempo/server/db/index.js';
import { sql, eq } from 'drizzle-orm';
import crypto from 'crypto';
import { kempoInventoryItem, kempoInventoryCategory, kempoInventoryField } from '../db/schema.js';
import { normalizeTags, tidyTag } from './tags.js';
import { categoryKey, groupCategories, tidyCategory, MAX_CATEGORY, MAX_DESCRIPTION } from './categoryLogic.js';
import { coerceValue } from './fieldTypes.js';
import { getAssets, checkAssets } from './media.js';
import { EVENTS, guard, notify } from './hooks.js';
import { blockingOwner, mayManage, notYours, ownerLabel } from './ownership.js';

/* Matches an item's category to a key the same way the category list groups them. */
const sameCategory = key => sql`lower(regexp_replace(btrim(${kempoInventoryItem.category}), '[[:space:]]+', ' ', 'g')) = ${key}`;

const countItems = async key => {
  const [{ total }] = await db.select({ total: sql`count(*)::int` }).from(kempoInventoryItem).where(sameCategory(key));
  return total;
};

/*
  The categories, each with how many items it has, its image (if any) and description:
    { categories: [{ name, key, count, image, description }], uncategorised }

  A category is the value of an item's built-in `category` property, so there is no list to
  maintain: they are the distinct values, merged ignoring case and spacing. By default only
  categories some item has are returned; `includeEmpty` also returns ones that exist only as a
  record (created in the admin before any item uses them). `uncategorised` counts items with none.
*/
export const getCategories = async ({ includeEmpty = false, q = '', tag = '', owner } = {}) => {
  try {
    const [{ total }] = await db.select({ total: sql`count(*)::int` }).from(kempoInventoryItem);

    const rows = [...await db.execute(sql`
      SELECT ${kempoInventoryItem.category} AS value, count(*)::int AS uses
      FROM ${kempoInventoryItem}
      WHERE btrim(${kempoInventoryItem.category}) <> ''
      GROUP BY 1`)];
    const records = await db.select().from(kempoInventoryCategory);

    const grouped = groupCategories(rows, records, { includeEmpty });
    const assets = await getAssets(grouped.map(c => c.image).filter(Boolean));
    const fieldRows = [...await db.execute(sql`SELECT ${kempoInventoryField.category} AS key, count(*)::int AS total FROM ${kempoInventoryField} WHERE ${kempoInventoryField.category} <> '' GROUP BY 1`)];
    const fieldCounts = new Map(fieldRows.map(r => [r.key, r.total]));
    let categories = grouped.map(c => ({ ...c, fields: fieldCounts.get(c.key) ?? 0, image: c.image ? assets[c.image] ?? null : null }));

    /* `q` finds categories by name, description or tag; `tag` keeps those with every tag named (exact). */
    const term = String(q ?? '').trim().toLowerCase();
    if(term) categories = categories.filter(c => [c.name, c.description, ...c.tags].some(text => String(text).toLowerCase().includes(term)));
    if(owner !== undefined) categories = categories.filter(c => c.owner === String(owner ?? ''));
    const wanted = [tag].flat().map(tidyTag).filter(Boolean);
    if(wanted.length) categories = categories.filter(c => wanted.every(t => c.tags.includes(t)));
    const categorised = rows.reduce((sum, r) => sum + r.uses, 0);

    const defaultFields = [...await db.execute(sql`SELECT count(*)::int AS total FROM ${kempoInventoryField} WHERE ${kempoInventoryField.category} = ''`)][0].total;
    return [null, { categories, uncategorised: Math.max(0, total - categorised), defaultFields }];
  } catch {
    return [{ code: 500, msg: 'Failed to retrieve categories' }, null];
  }
};

/*
  Creates or updates a category, by name (any spelling of it finds the same one). Only what is
  passed changes:

    saveCategory('Paint', { description: 'Hobby paints' })
    saveCategory('Paint', { image: 'files:0123456789abcdef' })     // a stored media id; null clears it
    saveCategory('Paint', { newName: 'Paints' })                   // renames, and updates the items

  Renaming changes the category on every item that has it. Renaming onto a name that already exists
  merges the two: the items join the existing category, which keeps its own image and description
  unless new ones are given. Resolves to [null, { name, key, image, description, tags, owner, moved }]
  where `moved` is how many items were renamed.

  A category with an `owner` (see registerCategory) can only be renamed, or merged into or out of,
  by that owner; anyone can still change its image, description and tags. `owner` here is the
  extension making the call ('' for a person), and a category created by this call belongs to it.
*/
export const saveCategory = async (name, { newName, image, description, tags } = {}, { userId = '', owner = '' } = {}) => {
  const displayName = tidyCategory(name);
  const key = categoryKey(displayName);
  if(!key) return [{ code: 400, msg: 'A category name is required' }, null];

  const changes = {};
  if(description !== undefined){
    const text = String(description ?? '').trim();
    if(text.length > MAX_DESCRIPTION) return [{ code: 400, msg: `A description must be ${MAX_DESCRIPTION} characters or fewer` }, null];
    changes.description = text;
  }
  if(tags !== undefined){
    const [tagsError, cleanTags] = normalizeTags(tags);
    if(tagsError) return [tagsError, null];
    changes.tags = cleanTags;
  }
  if(image !== undefined){
    if(image === null || image === ''){
      changes.image = null;
    } else {
      const [invalid, ids] = coerceValue({ type: 'media', label: 'Image' }, [image]);
      if(invalid) return [invalid, null];
      const problem = await checkAssets([ids[0]], 'Image');
      if(problem) return [problem, null];
      changes.image = ids[0];
    }
  }

  let targetName = displayName;
  if(newName !== undefined){
    targetName = tidyCategory(newName);
    if(!targetName) return [{ code: 400, msg: 'A category needs a name' }, null];
    if(targetName.length > MAX_CATEGORY) return [{ code: 400, msg: `A category name must be ${MAX_CATEGORY} characters or fewer` }, null];
  }
  const targetKey = categoryKey(targetName);
  const renaming = targetName !== displayName;

  const refused = await guard(EVENTS.categoryBeforeUpdate, { name: displayName, newName: renaming ? targetName : null, changes, userId, actor: owner });
  if(refused) return [refused, null];

  try {
    /* A category's own fields go with it when it is renamed. Merging two that both define a key would lose one. */
    if(targetKey !== key){
      const clash = [...await db.execute(sql`
        SELECT a."key" FROM ${kempoInventoryField} a JOIN ${kempoInventoryField} b ON a."key" = b."key"
        WHERE a."category" = ${key} AND b."category" = ${targetKey} LIMIT 1`)];
      if(clash.length) return [{ code: 409, msg: `Both categories have a field with the key "${clash[0].key}". Delete or change one first` }, null];
    }

    const now = new Date();
    const outcome = await db.transaction(async tx => {
      const [source] = await tx.select().from(kempoInventoryCategory).where(eq(kempoInventoryCategory.key, key));
      const [target] = targetKey === key ? [source] : await tx.select().from(kempoInventoryCategory).where(eq(kempoInventoryCategory.key, targetKey));

      /*
        Renaming rewrites the category on every item in it and moves its fields, and merging does the
        same to the other category's, so neither may touch what another extension owns.
      */
      if(renaming || targetKey !== key){
        if(!mayManage(source, owner)) return { refused: notYours('category', source, owner) };
        if(!mayManage(target, owner)) return { refused: notYours('category', target, owner) };
        const keys = [...new Set([key, targetKey])];
        const holders = [...await tx.execute(sql`
          SELECT DISTINCT owner FROM (
            SELECT ${kempoInventoryItem.owner} AS owner FROM ${kempoInventoryItem} WHERE ${sql.join(keys.map(k => sameCategory(k)), sql` OR `)}
            UNION ALL
            SELECT ${kempoInventoryField.owner} AS owner FROM ${kempoInventoryField} WHERE ${kempoInventoryField.category} IN (${sql.join(keys.map(k => sql`${k}`), sql`, `)})
          ) held`)].map(r => r.owner);
        const blocker = blockingOwner(holders, owner);
        if(blocker) return { refused: { code: 403, msg: `This category holds items or fields managed by ${ownerLabel(blocker)}, so it cannot be renamed or merged here` } };
      }

      /* Items first, so a failure leaves the record untouched. Both spellings end up as the new name. */
      let moved = 0;
      if(renaming){
        const rows = await tx.update(kempoInventoryItem)
          .set({ category: targetName, updated: now })
          .where(targetKey === key ? sameCategory(key) : sql`${sameCategory(key)} OR ${sameCategory(targetKey)}`)
          .returning({ id: kempoInventoryItem.id });
        moved = rows.length;
      }

      if(targetKey !== key) await tx.update(kempoInventoryField).set({ category: targetKey }).where(eq(kempoInventoryField.category, key));

      /* What the category ends up holding: this call's changes, then the existing record, then the one merged away. */
      const merged = {
        image: changes.image !== undefined ? changes.image : (target?.image ?? source?.image ?? null),
        description: changes.description !== undefined ? changes.description : (target?.description || source?.description || ''),
        /* Merging two categories keeps the tags of both. */
        tags: changes.tags !== undefined ? changes.tags : [...new Set([...(target?.tags ?? []), ...(source && source !== target ? source.tags ?? [] : [])])],
      };

      if(targetKey !== key && source) await tx.delete(kempoInventoryCategory).where(eq(kempoInventoryCategory.key, key));

      let row;
      if(target){
        [row] = await tx.update(kempoInventoryCategory).set({ name: targetName, ...merged, updated: now }).where(eq(kempoInventoryCategory.key, targetKey)).returning();
      } else {
        [row] = await tx.insert(kempoInventoryCategory)
          .values({ id: crypto.randomBytes(8).toString('hex'), key: targetKey, name: targetName, ...merged, owner, created: now, updated: now })
          .returning();
      }
      return { row, moved, previous: source ?? null };
    });
    if(outcome.refused) return [outcome.refused, null];

    await notify(EVENTS.categoryUpdated, { category: outcome.row, previous: outcome.previous, moved: outcome.moved, userId, actor: owner });
    return [null, { name: outcome.row.name, key: outcome.row.key, image: outcome.row.image, description: outcome.row.description, tags: outcome.row.tags ?? [], owner: outcome.row.owner, moved: outcome.moved }];
  } catch {
    return [{ code: 500, msg: 'Failed to save the category' }, null];
  }
};

/* Kept for callers that only set a picture. */
export const setCategoryImage = (name, image = null, options) => saveCategory(name, { image }, options);

/*
  Deletes a category's record (its image and description). Refused while any item is still in the
  category, so deleting can never quietly strip categories off items: move or clear those first.
*/
export const deleteCategory = async (name, { userId = '', owner = '' } = {}) => {
  const key = categoryKey(name);
  if(!key) return [{ code: 400, msg: 'A category name is required' }, null];
  try {
    const [record] = await db.select().from(kempoInventoryCategory).where(eq(kempoInventoryCategory.key, key));
    if(record && !mayManage(record, owner)) return [notYours('category', record, owner), null];
    const refused = await guard(EVENTS.categoryBeforeDelete, { category: record ?? null, name: tidyCategory(name), userId, actor: owner });
    if(refused) return [refused, null];
    const [{ fields }] = await db.select({ fields: sql`count(*)::int` }).from(kempoInventoryField).where(eq(kempoInventoryField.category, key));
    if(fields) return [{ code: 409, msg: `This category has ${fields} field${fields === 1 ? '' : 's'}. Delete ${fields === 1 ? 'it' : 'them'} first` }, null];
    const used = await countItems(key);
    if(used) return [{ code: 409, msg: `${used} item${used === 1 ? ' is' : 's are'} still in this category. Move or clear ${used === 1 ? 'it' : 'them'} first` }, null];
    const [row] = await db.delete(kempoInventoryCategory).where(eq(kempoInventoryCategory.key, key)).returning();
    if(!row) return [{ code: 404, msg: 'Category not found' }, null];
    await notify(EVENTS.categoryDeleted, { category: row, userId, actor: owner });
    return [null, { success: true }];
  } catch {
    return [{ code: 500, msg: 'Failed to delete the category' }, null];
  }
};

/*
  Idempotent: safe to call from an extension's install.js and again on every update. Makes the
  category a record the extension owns, so people cannot rename or delete it, and refreshes the
  description, tags and image the owner supplies. Refuses a category people already manage unless
  `adopt` is set, which takes it over (its items stay as they are, and stay people's).

    registerCategory('kempo-products', { name: 'Finished goods', description: 'Ready to ship' })
*/
export const registerCategory = async (owner, { name, description, tags, image } = {}, { adopt = false } = {}) => {
  if(!owner) return [{ code: 400, msg: 'An owner (your extension name) is required' }, null];
  const key = categoryKey(name);
  if(!key) return [{ code: 400, msg: 'A category name is required' }, null];
  try {
    const [existing] = await db.select().from(kempoInventoryCategory).where(eq(kempoInventoryCategory.key, key));
    if(existing && existing.owner !== owner && (existing.owner || !adopt)){
      return [{ code: 409, msg: `The category "${existing.name}" is already managed by ${ownerLabel(existing.owner)}` }, null];
    }
    const [error, saved] = await saveCategory(name, { description, tags, image }, { owner });
    if(error) return [error, null];
    if(existing && existing.owner !== owner) await db.update(kempoInventoryCategory).set({ owner }).where(eq(kempoInventoryCategory.key, key));
    return [null, { ...saved, owner }];
  } catch {
    return [{ code: 500, msg: 'Failed to register the category' }, null];
  }
};

/*
  For an extension's uninstall.js, after unregisterItems and unregisterFields. Deletes the
  categories it registered, except any that items or fields still use: those are handed back to
  the people who manage the inventory rather than leaving them stranded or stripping their items.
*/
export const unregisterCategories = async owner => {
  if(!owner) return [{ code: 400, msg: 'An owner (your extension name) is required' }, null];
  try {
    const rows = await db.select().from(kempoInventoryCategory).where(eq(kempoInventoryCategory.owner, owner));
    let removed = 0;
    let released = 0;
    for(const row of rows){
      const [error] = await deleteCategory(row.name, { owner });
      if(!error){ removed++; continue; }
      if(error.code !== 409) return [error, null];
      await db.update(kempoInventoryCategory).set({ owner: '' }).where(eq(kempoInventoryCategory.key, row.key));
      released++;
    }
    return [null, { removed, released }];
  } catch {
    return [{ code: 500, msg: 'Failed to remove the categories' }, null];
  }
};
