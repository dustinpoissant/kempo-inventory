/*
  Pure helpers for categories, with no database access so they can be tested without a server.

  An item's category is a built-in text property (like its SKU), not something items point at. What
  this extension adds is a small record per category name that can hold an image and a description,
  matched to items by a normalised key, so "Paint", "paint" and " Paint " are one category.
*/

export const MAX_CATEGORY = 100;
export const MAX_DESCRIPTION = 500;

/* How a category is stored: trimmed, with runs of whitespace collapsed to one space. */
export const tidyCategory = name => String(name ?? '').trim().replace(/\s+/g, ' ');

export const categoryKey = name => String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/*
  Builds the list a client shows from two sources:
    rows     [{ value, uses }]  every distinct value items hold, with how many items hold it
    records  [{ key, name, image, description, owner }]  the stored category records

  Spellings that differ only in case or spacing are merged and counted together. The name shown is
  the stored record's if there is one, otherwise the most used spelling (on a tie, the one that
  starts with a capital). Categories no item has are left out unless `includeEmpty` is set, which an
  admin screen uses so a category can exist, with its picture and description, before it has items.
  Sorted by name.
*/
export const groupCategories = (rows, records = [], { includeEmpty = false } = {}) => {
  const byKey = new Map();
  for(const { value, uses } of rows){
    const key = categoryKey(value);
    if(!key) continue;
    const entry = byKey.get(key) ?? { count: 0, spellings: new Map() };
    entry.count += uses;
    entry.spellings.set(value, (entry.spellings.get(value) ?? 0) + uses);
    byKey.set(key, entry);
  }

  const recordByKey = new Map(records.map(record => [record.key, record]));
  const startsUpper = text => /^\p{Lu}/u.test(text);

  const used = [...byKey.entries()].map(([key, entry]) => {
    const record = recordByKey.get(key);
    const spelling = [...entry.spellings.entries()]
      .sort((a, b) => b[1] - a[1] || Number(startsUpper(b[0])) - Number(startsUpper(a[0])) || a[0].localeCompare(b[0]))[0][0];
    return { key, name: record?.name ?? spelling, count: entry.count, image: record?.image ?? null, description: record?.description ?? '', tags: record?.tags ?? [], owner: record?.owner ?? '' };
  });

  const empty = includeEmpty
    ? records.filter(record => !byKey.has(record.key)).map(record => ({ key: record.key, name: record.name, count: 0, image: record.image ?? null, description: record.description ?? '', tags: record.tags ?? [], owner: record.owner ?? '' }))
    : [];

  return [...used, ...empty].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
};
