import db from 'kempo/server/db/index.js';
import { and, asc, ilike, inArray, or, sql } from 'drizzle-orm';
import { kempoInventoryCategory, kempoInventoryItem } from '../db/schema.js';
import { categoryKey } from './categoryLogic.js';
import { getCategories } from './categories.js';
import { getFields } from './fields.js';
import { applicableFields } from './fieldTypes.js';
import { scoreEntry } from './searchScore.js';

/*
  Finding inventory by words (see searchScore.js for how a score is made). Both return [null, { results, total }]: the best
  `window` results, and how many matched in all.

  Nothing here checks who is asking: the search hook handler (hooks/search.js) decides that before it calls these.
*/

/* The most items read to be scored, however far down the results go. */
const CANDIDATES = 500;

/* Field types whose values are text a person would search for. */
const TEXT_TYPES = ['text', 'longtext', 'select', 'url'];

const escape = text => text.replace(/[\\%_]/g, '\\$&');

const categoryKeyOfItem = sql`lower(regexp_replace(btrim(${kempoInventoryItem.category}), '[[:space:]]+', ' ', 'g'))`;

const byScore = (a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title));

/*
  Items. The database keeps the items that have every word somewhere (in the name, SKU, description, category, tags, a field, or
  the text of their category: its description and tags), then each is scored word by word. The category of an item is part of it,
  so "blue filament" finds an item called Blue in the category Filament.
*/
export const searchItems = async ({ tokens, window }) => {
  try {
    const [fieldsError, fields] = await getFields();
    if(fieldsError) return [fieldsError, null];
    const records = await db.select({ key: kempoInventoryCategory.key, name: kempoInventoryCategory.name, description: kempoInventoryCategory.description, tags: kempoInventoryCategory.tags }).from(kempoInventoryCategory);
    const recordTexts = record => [record.name, record.description, ...(record.tags ?? [])].map(text => String(text).toLowerCase());

    const where = and(...tokens.map(token => {
      const like = `%${escape(token)}%`;
      const keys = records.filter(record => recordTexts(record).some(text => text.includes(token))).map(record => record.key);
      return or(
        ilike(kempoInventoryItem.name, like),
        ilike(kempoInventoryItem.sku, like),
        ilike(kempoInventoryItem.description, like),
        ilike(kempoInventoryItem.category, like),
        sql`${kempoInventoryItem.tags}::text ilike ${like}`,
        sql`${kempoInventoryItem.data}::text ilike ${like}`,
        keys.length ? inArray(categoryKeyOfItem, keys) : undefined,
      );
    }));

    const limit = Math.max(window, CANDIDATES);
    const rows = await db.select().from(kempoInventoryItem).where(where).orderBy(asc(kempoInventoryItem.name), asc(kempoInventoryItem.id)).limit(limit);
    const recordByKey = new Map(records.map(record => [record.key, record]));

    const results = [];
    for(const row of rows){
      const record = recordByKey.get(categoryKey(row.category));
      const custom = applicableFields(fields, row.category).filter(field => TEXT_TYPES.includes(field.type)).map(field => ({ text: row.data?.[field.key], weight: 0.4 }));
      const score = scoreEntry({ tokens, fields: [
        { text: row.name },
        { text: row.sku, weight: 0.9 },
        { text: row.category, weight: 0.8 },
        { text: (row.tags ?? []).join(' '), weight: 0.6 },
        { text: row.description, weight: 0.5 },
        { text: (record?.tags ?? []).join(' '), weight: 0.5 },
        { text: record?.description, weight: 0.4 },
        ...custom,
      ] });
      if(!score) continue;
      results.push({
        score,
        id: row.id,
        title: row.name,
        description: [row.category, row.sku].filter(Boolean).join(' · '),
        url: `/items/${row.id}`,
        sku: row.sku,
        category: row.category,
      });
    }

    results.sort(byScore);
    /* When every candidate was read the count is exact; past the cap it is the database's count of items with every word somewhere. */
    const total = rows.length < limit ? results.length : (await db.select({ total: sql`count(*)::int` }).from(kempoInventoryItem).where(where))[0].total;
    return [null, { results: results.slice(0, window), total }];
  } catch {
    return [{ code: 500, msg: 'Failed to search items' }, null];
  }
};

/*
  Categories, by name, tags and description. `adminUrl` is where to send the person, or '' for someone with no admin to go to
  (a category has no page of its own, so it is then a title only).
*/
export const searchCategories = async ({ tokens, window, adminUrl = '' }) => {
  const [error, data] = await getCategories();
  if(error) return [error, null];

  const results = [];
  for(const category of data.categories){
    const score = scoreEntry({ tokens, fields: [
      { text: category.name },
      { text: category.tags.join(' '), weight: 0.6 },
      { text: category.description, weight: 0.5 },
    ] });
    if(!score) continue;
    results.push({
      score,
      id: category.key,
      title: category.name,
      description: `${category.count} item${category.count === 1 ? '' : 's'}${category.description ? ` · ${category.description}` : ''}`,
      count: category.count,
      ...(adminUrl && { url: adminUrl }),
    });
  }

  results.sort(byScore);
  return [null, { results: results.slice(0, window), total: results.length }];
};
