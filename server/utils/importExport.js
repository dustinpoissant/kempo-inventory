import db from 'kempo/server/db/index.js';
import { asc } from 'drizzle-orm';
import { kempoInventoryItem, kempoInventoryCategory } from '../db/schema.js';
import { getFields } from './fields.js';
import { getItemBySku, createItem, updateItem, adjustStock } from './items.js';
import { getCategories, saveCategory } from './categories.js';
import { applicableFields, coerceValues } from './fieldTypes.js';
import { normalizeTags } from './tags.js';
import { tidyCategory, categoryKey, MAX_CATEGORY } from './categoryLogic.js';
import { readMedia } from './media.js';

/*
  Exporting and importing an inventory.

  The export is one JSON document (see FORMAT below), on its own for "data only" or inside a zip together
  with every photo and file it uses ("with media"). Import reads the same document.

  What it carries: every item (SKU, name, category, quantity, tags, description and the values of
  its custom fields) and every category (description, tags, picture). It also lists the field
  definitions, for reference: an import never creates or changes fields, so fields have to exist
  already for their values to come across. Values for fields that do not exist here, or do not apply to an
  item's category, are ignored and counted.

  Photo and file fields only travel in the zip version. A field linking to another item is written as
  that item's SKU and resolved by SKU on import.
*/
export const FORMAT = 'kempo-inventory-export';
export const VERSION = 1;
export const MAX_IMPORT_ROWS = 500;

const safeName = name => String(name ?? 'file').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').slice(0, 80) || 'file';

/*
  Returns { data, files }: the JSON document and, with \`withMedia\`, the media files it refers to as
  [{ path, bytes }]. Media references in the document are paths within the zip ("media/3-photo.jpg"),
  described in \`data.media\`.
*/
export const buildExport = async ({ withMedia = false } = {}) => {
  const [fieldsError, fields] = await getFields();
  if(fieldsError) return [fieldsError, null];

  const itemRows = await db.select().from(kempoInventoryItem).orderBy(asc(kempoInventoryItem.sku));
  const categoryRows = await db.select().from(kempoInventoryCategory).orderBy(asc(kempoInventoryCategory.name));
  const skuById = new Map(itemRows.map(row => [row.id, row.sku]));

  /* The media each item holds, in the fields that apply to it. */
  const mediaIdsOf = row => applicableFields(fields, row.category)
    .filter(f => f.type === 'media')
    .flatMap(f => (row.data?.[f.key] ?? []));
  const wanted = [];
  if(withMedia){
    for(const row of itemRows) for(const id of mediaIdsOf(row)) if(!wanted.includes(id)) wanted.push(id);
    for(const row of categoryRows) if(row.image && !wanted.includes(row.image)) wanted.push(row.image);
  }

  const pathOf = new Map();
  const files = [];
  const media = {};
  let missingMedia = 0;
  for(const id of wanted){
    const [error, file] = await readMedia(id);
    if(error){ missingMedia++; continue; }
    const path = `media/${pathOf.size + 1}-${safeName(file.name)}`;
    pathOf.set(id, path);
    files.push({ path, bytes: file.bytes });
    media[path] = { name: file.name, kind: file.kind, alt: file.alt };
  }

  const items = itemRows.map(row => {
    const values = {};
    for(const field of applicableFields(fields, row.category)){
      const value = row.data?.[field.key];
      if(value === undefined || value === null) continue;
      if(field.type === 'media'){
        const paths = (value ?? []).map(id => pathOf.get(id)).filter(Boolean);
        if(paths.length) values[field.key] = paths;
      } else if(field.type === 'item'){
        const sku = skuById.get(value);
        if(sku) values[field.key] = sku;
      } else {
        values[field.key] = value;
      }
    }
    return { sku: row.sku, name: row.name, category: row.category, quantity: row.quantity, tags: row.tags ?? [], description: row.description, fields: values };
  });

  const categories = categoryRows.map(row => ({
    name: row.name,
    description: row.description,
    tags: row.tags ?? [],
    ...(row.image && pathOf.has(row.image) ? { image: pathOf.get(row.image) } : {}),
  }));

  const data = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    withMedia,
    fields: fields.map(f => ({ key: f.key, label: f.label, type: f.type, category: f.categoryName ?? '', required: f.required, options: f.options })),
    categories,
    items,
    ...(withMedia ? { media } : {}),
  };
  return [null, { data, files, missingMedia }];
};

const given = value => value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length);

/*
  Applies (or, with \`dryRun\`, only checks) a batch of items and categories from an export.

    onMatch  'skip'    an item or category that already exists (same SKU / same name) is left alone
             'update'  it is updated with the values the file provides; a value the file leaves empty
                       is never cleared. A changed quantity is applied as a stock adjustment, so the
                       history shows it.

  Rows are independent: one that fails does not stop the others. Resolves to
  [null, { results, categoryResults, summary }].
*/
export const importData = async ({ items = [], categories = [], onMatch = 'skip', dryRun = false } = {}, { userId = '', canUpdate = false, canAdjustStock = false, maxRows = MAX_IMPORT_ROWS } = {}) => {
  if(!['skip', 'update'].includes(onMatch)) return [{ code: 400, msg: 'onMatch must be "skip" or "update"' }, null];
  if(!Array.isArray(items) || !Array.isArray(categories)) return [{ code: 400, msg: 'items and categories must be lists' }, null];
  if(items.length > maxRows || categories.length > maxRows) return [{ code: 413, msg: `Send at most ${maxRows} rows at a time` }, null];
  if(onMatch === 'update' && !canUpdate) return [{ code: 403, msg: 'Updating existing items needs the items:update permission' }, null];

  const [fieldsError, fields] = await getFields();
  if(fieldsError) return [fieldsError, null];

  const summary = { created: 0, updated: 0, skipped: 0, errors: 0, ignoredValues: 0, categoriesCreated: 0, categoriesUpdated: 0, categoriesSkipped: 0 };
  const results = [];
  const deferredLinks = [];   // { result, sku, key, linkSku }: links to an item that does not exist yet

  const fail = (result, message) => { result.action = 'error'; result.message = message; summary.errors++; return result; };

  /* Categories first: whether one already exists is decided before this import's own items give it implicit existence. */
  const categoryResults = [];
  const [, existingCategories] = await getCategories({ includeEmpty: true });
  const known = new Set((existingCategories?.categories ?? []).map(c => c.key));
  for(const [index, row] of categories.entries()){
    const name = tidyCategory(row?.name);
    const result = { row: index + 1, name, action: '', message: '' };
    categoryResults.push(result);
    if(!name){ result.action = 'error'; result.message = 'Missing name'; summary.errors++; continue; }
    const exists = known.has(categoryKey(name));
    if(exists && onMatch === 'skip'){ result.action = 'skip'; summary.categoriesSkipped++; continue; }
    result.action = exists ? 'update' : 'create';
    if(dryRun){ exists ? summary.categoriesUpdated++ : summary.categoriesCreated++; continue; }
    const changes = {};
    if(given(row.description)) changes.description = String(row.description);
    if(given(row.tags)) changes.tags = row.tags;
    if(given(row.image)) changes.image = row.image;
    const [error] = await saveCategory(name, changes, { userId });
    if(error){ result.action = 'error'; result.message = error.msg; summary.errors++; continue; }
    known.add(categoryKey(name));
    exists ? summary.categoriesUpdated++ : summary.categoriesCreated++;
  }

  for(const [index, row] of items.entries()){
    const result = { row: index + 1, sku: String(row?.sku ?? '').trim(), name: String(row?.name ?? '').trim(), action: '', message: '' };
    results.push(result);
    if(!row || typeof row !== 'object') { fail(result, 'Not an item'); continue; }
    if(!result.sku){ fail(result, 'Missing SKU'); continue; }

    const [, existing] = await getItemBySku(result.sku);
    if(existing && onMatch === 'skip'){ result.action = 'skip'; result.message = 'Already exists'; summary.skipped++; continue; }

    const category = given(row.category) ? tidyCategory(row.category) : (existing?.category ?? '');
    if(category.length > MAX_CATEGORY){ fail(result, `Category must be ${MAX_CATEGORY} characters or fewer`); continue; }
    let tags;
    if(given(row.tags)){
      const [tagsError, cleanTags] = normalizeTags(row.tags);
      if(tagsError){ fail(result, tagsError.msg); continue; }
      tags = cleanTags;
    }
    let quantity;
    if(given(row.quantity)){
      quantity = Number(row.quantity);
      if(!Number.isInteger(quantity) || quantity < 0){ fail(result, 'Quantity must be a non-negative whole number'); continue; }
    }
    if(!existing && !result.name){ fail(result, 'Missing name'); continue; }

    /* Custom field values: only fields that exist and apply to the item's category. */
    const applicable = applicableFields(fields, category);
    const byKey = new Map(applicable.map(f => [f.key, f]));
    const values = {};
    const links = [];
    for(const [key, value] of Object.entries(row.fields && typeof row.fields === 'object' ? row.fields : {})){
      const field = byKey.get(key);
      if(!field){ summary.ignoredValues++; continue; }
      if(!given(value)) continue;
      if(field.type === 'item'){
        const [, target] = await getItemBySku(String(value).trim());
        if(target) values[key] = target.id; else links.push({ key, linkSku: String(value).trim() });
      } else {
        values[key] = value;
      }
    }
    const [invalid, coerced] = coerceValues(applicable, values, { partial: Boolean(existing) });
    if(invalid){ fail(result, invalid.msg); continue; }

    if(existing){
      if(quantity !== undefined && quantity !== existing.quantity && !canAdjustStock){ fail(result, 'Changing a quantity needs the stock:adjust permission'); continue; }
      result.action = 'update';
      if(dryRun){ summary.updated++; continue; }
      const changes = { fields: coerced };
      if(given(row.name)) changes.name = result.name;
      if(given(row.description)) changes.description = String(row.description);
      if(given(row.category)) changes.category = category;
      if(tags !== undefined) changes.tags = tags;
      const [error] = await updateItem(existing.id, { ...changes, userId });
      if(error && !(error.code === 400 && error.msg === 'No changes provided')){ fail(result, error.msg); continue; }
      if(quantity !== undefined && quantity !== existing.quantity){
        const [adjustError] = await adjustStock(existing.id, { delta: quantity - existing.quantity, reason: 'import', note: 'Imported', userId });
        if(adjustError){ fail(result, adjustError.msg); continue; }
      }
      summary.updated++;
      for(const link of links) deferredLinks.push({ result, itemId: existing.id, ...link });
    } else {
      result.action = 'create';
      if(dryRun){ summary.created++; continue; }
      const [error, created] = await createItem({
        sku: result.sku, name: result.name, description: given(row.description) ? String(row.description) : '',
        category, tags: tags ?? [], quantity: quantity ?? 0, fields: coerced, userId,
      });
      if(error){ fail(result, error.msg); continue; }
      summary.created++;
      for(const link of links) deferredLinks.push({ result, itemId: created.id, ...link });
    }
  }

  /* Links to items created later in the same import. */
  for(const link of deferredLinks){
    const [, target] = await getItemBySku(link.linkSku);
    if(!target){ link.result.message = `${link.result.message ? link.result.message + '; ' : ''}linked item ${link.linkSku} was not found`; continue; }
    await updateItem(link.itemId, { fields: { [link.key]: target.id }, userId });
  }

  return [null, { results, categoryResults, summary }];
};
