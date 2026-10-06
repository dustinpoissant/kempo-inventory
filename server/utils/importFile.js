import { readZip } from './zipRead.js';
import { importData, FORMAT } from './importExport.js';
import { storeMedia } from './media.js';
import { refuseMedia, safeFileName } from './mediaSafety.js';

/*
  Importing an uploaded export (a .json or a .zip), entirely on the server.

  Nothing here may be reached by anyone but the top tier: the routes check `fields:manage` before they
  read a byte of the upload, and these functions assume it. What they do with the upload:

    - A zip is recognised by its first bytes, not its name, and read in memory by zipRead.js: entries are
      looked up by the exact names the inventory.json asks for, never written to disk by name, with a
      cap on how many files it may hold and how far one may inflate.
    - A photo reference must have the form "media/<name>" (no folders, no "..", no slashes). Anything else
      is left as it is and the row fails validation, so no name from the zip is ever used as a path.
    - A file is only stored if its extension is a photo, video, audio or PDF type AND its first bytes really
      are that type (mediaSafety.js). Everything else in the zip is skipped and reported.
    - Files are stored through the normal library routines (kempo-files or kempo-media), as the person doing
      the import, so those libraries apply their own rules (untrusted files are never executed).
*/
export const MAX_ITEMS = 50000;
export const MAX_MEDIA_FILES = 5000;
export const MAX_MEDIA_BYTES = 1024 * 1024 * 1024;   // all the photos in one import
const MAX_JSON_BYTES = 100 * 1024 * 1024;
const MEDIA_PATH = /^media\/[^/\\\u0000]{1,200}$/;

const isZip = bytes => bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6));

const isMediaPaths = value => Array.isArray(value) && value.length > 0 && value.every(v => typeof v === 'string' && MEDIA_PATH.test(v));

/* Opens the upload: { data, zip } or an { code, msg } fit to show a person. */
export const parseImportFile = async bytes => {
  let zip = null;
  let text;
  try {
    if(isZip(bytes)){
      zip = await readZip(bytes);
      text = await zip.text('inventory.json');
      if(text === null) return [{ code: 400, msg: 'This zip has no inventory.json. Is it an export from this inventory?' }, null];
    } else {
      if(bytes.length > MAX_JSON_BYTES) return [{ code: 413, msg: 'This file is too large to import' }, null];
      text = bytes.toString('utf8');
    }
  } catch(error) {
    return [{ code: 400, msg: error.message || 'This zip file could not be read' }, null];
  }
  if(text.length > MAX_JSON_BYTES) return [{ code: 413, msg: 'inventory.json is too large to import' }, null];
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [{ code: 400, msg: 'This file is not valid JSON.' }, null];
  }
  if(Array.isArray(data)) data = { items: data };
  if(!data || typeof data !== 'object' || !Array.isArray(data.items)) return [{ code: 400, msg: 'This file does not look like an inventory export (it has no list of items).' }, null];
  if(data.format && data.format !== FORMAT) return [{ code: 400, msg: 'This file is not an inventory export.' }, null];
  if(data.items.length > MAX_ITEMS) return [{ code: 413, msg: `This file has more than ${MAX_ITEMS} items` }, null];
  if(data.categories !== undefined && !Array.isArray(data.categories)) return [{ code: 400, msg: 'categories must be a list' }, null];
  return [null, { data: { ...data, categories: data.categories ?? [] }, zip }];
};

/* The rows without their photo references, which cannot be checked until the photos are stored. */
const withoutMedia = ({ items, categories }) => ({
  items: items.map(item => ({ ...item, fields: Object.fromEntries(Object.entries(item?.fields && typeof item.fields === 'object' ? item.fields : {}).filter(([, value]) => !isMediaPaths(value))) })),
  categories: categories.map(row => { const { image, ...rest } = row ?? {}; return rest; }),
});

const mediaIn = ({ items, categories }) => {
  const paths = new Set();
  for(const item of items) for(const value of Object.values(item?.fields ?? {})) if(isMediaPaths(value)) value.forEach(p => paths.add(p));
  for(const category of categories) if(typeof category?.image === 'string' && MEDIA_PATH.test(category.image)) paths.add(category.image);
  return paths;
};

const PERMISSIONS = { canUpdate: true, canAdjustStock: true, maxRows: MAX_ITEMS };   // the caller is the top tier, which holds all of these

/* What importing this file would do, changing nothing: { results, categoryResults, summary, media }. */
export const previewImport = async (bytes, { userId }) => {
  const [parseError, parsed] = await parseImportFile(bytes);
  if(parseError) return [parseError, null];
  const [error, report] = await importData({ ...withoutMedia(parsed.data), onMatch: 'update', dryRun: true }, { userId, ...PERMISSIONS });
  if(error) return [error, null];
  const paths = mediaIn(parsed.data);
  return [null, {
    ...report,
    counts: { items: parsed.data.items.length, categories: parsed.data.categories.length },
    withMedia: Boolean(parsed.zip),
    mediaFiles: paths.size,
  }];
};

/* Does the import: stores the photos the rows to be written need, then writes the rows. */
export const applyImport = async (bytes, { onMatch, userId }) => {
  const [parseError, parsed] = await parseImportFile(bytes);
  if(parseError) return [parseError, null];
  const { data, zip } = parsed;
  const items = structuredClone(data.items);
  const categories = structuredClone(data.categories);

  const stored = new Map();       // path -> stored id, or null when the file was refused
  const skippedFiles = [];
  let uploaded = 0;
  let uploadedBytes = 0;
  const idFor = async path => {
    if(stored.has(path)) return stored.get(path);
    stored.set(path, null);
    const name = safeFileName(data.media?.[path]?.name || path.split('/').pop());
    const file = zip ? await zip.read(path).catch(error => error) : null;
    if(file instanceof Error){ skippedFiles.push({ name, reason: file.message }); return null; }
    if(!file){ skippedFiles.push({ name, reason: 'not in the zip' }); return null; }
    const reason = refuseMedia(name, file);
    if(reason){ skippedFiles.push({ name, reason }); return null; }
    if(uploaded >= MAX_MEDIA_FILES || uploadedBytes + file.length > MAX_MEDIA_BYTES){ skippedFiles.push({ name, reason: 'over the size limit for one import' }); return null; }
    const [error, id] = await storeMedia({ name, bytes: file, altText: data.media?.[path]?.alt ?? '', userId });
    if(error){ skippedFiles.push({ name, reason: error.msg }); return null; }
    uploaded++;
    uploadedBytes += file.length;
    stored.set(path, id);
    return id;
  };

  /* Photos only for the rows that will actually be created or updated. */
  const [planError, plan] = await importData({ ...withoutMedia({ items, categories }), onMatch, dryRun: true }, { userId, ...PERMISSIONS });
  if(planError) return [planError, null];
  const wanted = new Set(plan.results.filter(r => r.action === 'create' || r.action === 'update').map(r => r.row));
  const wantedCategories = new Set(plan.categoryResults.filter(r => r.action === 'create' || r.action === 'update').map(r => r.row));

  for(const [index, item] of items.entries()){
    if(!item || typeof item.fields !== 'object') continue;
    for(const [key, value] of Object.entries(item.fields)){
      if(!isMediaPaths(value)) continue;
      if(!wanted.has(index + 1)){ delete item.fields[key]; continue; }
      const ids = [];
      for(const path of value){ const id = await idFor(path); if(id) ids.push(id); }
      if(ids.length) item.fields[key] = ids; else delete item.fields[key];
    }
  }
  for(const [index, category] of categories.entries()){
    if(typeof category?.image !== 'string') continue;
    const id = MEDIA_PATH.test(category.image) && wantedCategories.has(index + 1) ? await idFor(category.image) : null;
    if(id) category.image = id; else delete category.image;
  }

  const [error, report] = await importData({ items, categories, onMatch, dryRun: false }, { userId, ...PERMISSIONS });
  if(error) return [error, null];
  return [null, { ...report, uploaded, skippedFiles }];
};
