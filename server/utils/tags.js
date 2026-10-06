/*
  Tags: short labels on items and categories ("acrylic", "red", "water-based") that search finds.
  Pure helpers with no database access, so they can be unit tested.

  A tag is stored lower case with its spacing tidied, so "Water-Based" and " water-based " are one tag.
*/
export const MAX_TAG = 40;
export const MAX_TAGS = 30;

export const tidyTag = tag => String(tag ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/*
  Accepts a list, or text separated by commas or new lines ("acrylic, red"), and returns
  [error, tags] with the tags tidied, de-duplicated and in the order given.
*/
export const normalizeTags = input => {
  if(input === undefined || input === null || input === '') return [null, []];
  const list = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[,\n]/) : null;
  if(!list) return [{ code: 400, msg: 'Tags must be a list' }, null];
  const tags = [];
  for(const raw of list){
    if(typeof raw !== 'string') return [{ code: 400, msg: 'Each tag must be text' }, null];
    const tag = tidyTag(raw);
    if(!tag) continue;
    if(tag.length > MAX_TAG) return [{ code: 400, msg: `A tag must be ${MAX_TAG} characters or fewer` }, null];
    if(!tags.includes(tag)) tags.push(tag);
  }
  if(tags.length > MAX_TAGS) return [{ code: 400, msg: `At most ${MAX_TAGS} tags are allowed` }, null];
  return [null, tags];
};

/* A `tag` query parameter: one tag, a repeated parameter, or a JSON list ('["a","b"]'), as a list. */
export const parseTagParam = value => {
  if(Array.isArray(value)) return value.map(tidyTag).filter(Boolean);
  if(typeof value !== 'string' || !value.trim()) return [];
  if(value.trim().startsWith('[')){
    try { return parseTagParam(JSON.parse(value)); } catch { /* not JSON: treat it as a tag */ }
  }
  return [tidyTag(value)].filter(Boolean);
};

/* The distinct tags across several lists with how many lists each is in, most used first. */
export const countTags = lists => {
  const counts = new Map();
  for(const list of lists) for(const tag of new Set(list ?? [])) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
};
