const BASE = '/inventory/api';

const req = async (method, path, data) => {
  const opts = { method, headers: {} };
  if(data !== undefined && method !== 'GET'){
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(data);
  }
  try {
    const res = await fetch(path, opts);
    const json = await res.json().catch(() => ({}));
    if(!res.ok) return [{ code: res.status, msg: json.error || 'An error occurred' }, null];
    return [null, json];
  } catch {
    return [{ code: 503, msg: 'Network error' }, null];
  }
};

const buildQuery = params => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false);
  if(!entries.length) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : v)}`).join('&');
};

const enc = encodeURIComponent;

/*
  Items. `filters` is an object of field key -> exact value, e.g. { manufacturer: 'Acme' }.
*/
export const getItems = (params = {}) => req('GET', `${BASE}/items${buildQuery(params)}`);
export const getItem = id => req('GET', `${BASE}/items/${enc(id)}`);
export const createItem = data => req('POST', `${BASE}/items`, data);
export const updateItem = (id, data) => req('PATCH', `${BASE}/items/${enc(id)}`, data);
export const deleteItem = id => req('DELETE', `${BASE}/items/${enc(id)}`);
export const adjustStock = (id, data) => req('POST', `${BASE}/items/${enc(id)}/adjust`, data);
export const getMovements = (params = {}) => req('GET', `${BASE}/movements${buildQuery(params)}`);

/*
  Fields
*/
/*
  A field belongs to one category or, with no category, to every item. getFields({ category: 'Paint' })
  returns what an item in that category shows (the default fields plus Paint's); with no argument it
  returns every field, each with its `category` key and `categoryName`. A field is identified by its
  key and category, so changing or deleting a category's field passes { category }.
*/
export const getFields = (params = {}) => req('GET', `${BASE}/fields${buildQuery(params)}`);
export const createField = data => req('POST', `${BASE}/fields`, data);
export const updateField = (key, data, { category = '' } = {}) => req('PATCH', `${BASE}/fields/${enc(key)}${buildQuery({ category })}`, data);
export const deleteField = (key, { category = '' } = {}) => req('DELETE', `${BASE}/fields/${enc(key)}${buildQuery({ category })}`);

/*
  Values already used for a text field that match what has been typed, most relevant first:
  [{ value, uses }]. With no `q` it returns the most used values.
*/
export const getSuggestions = (key, q = '', limit = 8, category = '') => req('GET', `${BASE}/fields/${enc(key)}/suggestions${buildQuery({ q, limit, category })}`);

/*
  Import and export (top tier only). exportUrl('json' | 'zip') is a download link (the zip carries the
  photos too). Importing is two steps with the file as the raw request body: previewImport(file) checks it
  and reports what would happen (and keeps the upload, returning its importId); applyImport(importId,
  'skip' | 'update') then does it. The server opens a zip, never the browser.
*/
export const exportUrl = format => `${BASE}/export?format=${format === 'zip' ? 'zip' : 'json'}`;
export const previewImport = async file => {
  try {
    const res = await fetch(`${BASE}/import/preview?name=${enc(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file, credentials: 'same-origin' });
    const json = await res.json().catch(() => ({}));
    return res.ok ? [null, json] : [{ code: res.status, msg: json.error || 'An error occurred' }, null];
  } catch {
    return [{ code: 503, msg: 'Network error' }, null];
  }
};
export const applyImport = (importId, onMatch) => req('POST', `${BASE}/import/apply`, { importId, onMatch });

/*
  Every tag in use on items and categories, most used first: { tags: [{ tag, count }] }. `q` narrows it to
  tags containing that text.
*/
export const getTags = (params = {}) => req('GET', `${BASE}/tags${buildQuery(params)}`);

/*
  Categories: { categories: [{ name, key, count, image, description }], uncategorised }. `image` is
  { id, kind, name, path, thumbnail } or null. Set one with a stored media id (null clears it).
*/
export const getCategories = (params = {}) => req('GET', `${BASE}/categories${buildQuery(params)}`);

/*
  Create or update a category; only what is passed changes: { description }, { image } (null clears
  it) or { newName } to rename it and update its items. Resolves to { category: { name, key, image,
  description, moved } }.
*/
export const saveCategory = (name, changes = {}) => req('PUT', `${BASE}/categories`, { name, ...changes });
export const setCategoryImage = (name, image = null) => saveCategory(name, { image });
/* Refused while any item is still in the category. */
export const deleteCategory = name => req('DELETE', `${BASE}/categories`, { name });
