import db from 'kempo/server/db/index.js';
import { sql } from 'drizzle-orm';
import { kempoInventoryItem } from '../db/schema.js';
import { getField, itemsInScope } from './fields.js';
import { rankSuggestions } from './rank.js';

export { rankSuggestions };

/*
  The values already used for a text field, matching what has been typed. An empty `q` gives the
  most used values overall, which is what a field wants to offer the moment it is focused.
*/
export const getSuggestions = async (key, { q = '', limit = 8, category = '' } = {}) => {
  const [lookupError, field] = await getField(key, category);
  if(lookupError) return [lookupError, null];
  if(field.type !== 'text') return [{ code: 400, msg: 'Only text fields can suggest values' }, null];

  const term = String(q ?? '').trim();
  /* LIKE treats % and _ as wildcards, so a typed one has to be escaped to mean itself. */
  const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`;

  try {
    const rows = await db.execute(sql`
      SELECT btrim(${kempoInventoryItem.data}->>${key}) AS value, count(*)::int AS uses
      FROM ${kempoInventoryItem}
      WHERE ${itemsInScope(field.category)}
        AND btrim(${kempoInventoryItem.data}->>${key}) IS NOT NULL
        AND btrim(${kempoInventoryItem.data}->>${key}) <> ''
        ${term ? sql`AND btrim(${kempoInventoryItem.data}->>${key}) ILIKE ${pattern}` : sql``}
      GROUP BY 1
      LIMIT 500`);
    return [null, rankSuggestions([...rows], term, limit)];
  } catch {
    return [{ code: 500, msg: 'Failed to retrieve suggestions' }, null];
  }
};
