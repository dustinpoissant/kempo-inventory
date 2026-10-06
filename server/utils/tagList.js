import db from 'kempo/server/db/index.js';
import { sql } from 'drizzle-orm';
import { kempoInventoryItem, kempoInventoryCategory } from '../db/schema.js';

/*
  Every tag in use on items and categories, with how many items and categories carry it, most used
  first: [{ tag, count }]. `q` narrows it to tags containing that text (for suggestions as you type).
*/
export const getTags = async ({ q = '', limit = 100 } = {}) => {
  const term = String(q ?? '').trim().toLowerCase();
  const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
  try {
    const rows = await db.execute(sql`
      SELECT tag, count(*)::int AS count FROM (
        SELECT jsonb_array_elements_text(${kempoInventoryItem.tags}) AS tag FROM ${kempoInventoryItem}
        UNION ALL
        SELECT jsonb_array_elements_text(${kempoInventoryCategory.tags}) AS tag FROM ${kempoInventoryCategory}
      ) t
      ${term ? sql`WHERE tag LIKE ${pattern}` : sql``}
      GROUP BY tag ORDER BY count DESC, tag LIMIT ${limit}`);
    return [null, [...rows].map(r => ({ tag: r.tag, count: r.count }))];
  } catch {
    return [{ code: 500, msg: 'Failed to retrieve tags' }, null];
  }
};
