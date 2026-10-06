/*
  Pure helpers with no database access, so field definitions and values can be validated
  and unit tested without a server.
*/

import { categoryKey } from './categoryLogic.js';
import { parseRatio } from './ratio.js';

export const FIELD_TYPES = ['text', 'longtext', 'number', 'boolean', 'date', 'color', 'rating', 'select', 'item', 'media'];

/*
  Types that depend on another extension being installed. They are always valid in a definition,
  but creating one is refused when the extension that backs it is missing (see fields.js).
*/
export const OPTIONAL_TYPES = { media: 'kempo-media or kempo-files' };

export const MAX_MEDIA = 20;
export const MAX_RATING = 5;
export const MAX_IMAGE_EDGE = 8000;

/*
  The only type changes that cannot lose or reject what items already hold: a choice list becomes
  free text (its values are already plain strings), and short text becomes long text. Anything
  else, such as text to a number, could orphan existing values, so it is refused: delete the field
  and make a new one instead.
*/
export const CONVERSIONS = { select: ['text'], text: ['longtext'] };

export const canConvert = (from, to) => from === to || (CONVERSIONS[from] ?? []).includes(to);

/*
  A `media` value is a list of ids, each saying where the file lives. A bare id is a kempo-media
  asset; "files:<id>" is a kempo-files file.
*/
const FILES_PREFIX = 'files:';
const MEDIA_ID = /^(files:)?[a-f0-9]{16}$/;

export const filesId = id => `${FILES_PREFIX}${id}`;

export const parseMediaId = id => id.startsWith(FILES_PREFIX)
  ? { provider: 'files', rawId: id.slice(FILES_PREFIX.length) }
  : { provider: 'media', rawId: id };

export const CORE_KEYS = ['id', 'sku', 'name', 'description', 'category', 'quantity', 'tags', 'created', 'updated', 'fields', 'data', 'linked'];

export const KEY_PATTERN = /^[a-z][a-zA-Z0-9]{0,39}$/;

const MAX_TEXT = 1000;
const MAX_LONGTEXT = 20000;

export const isEmpty = value => value === undefined || value === null || value === '';

/*
  Turns a human label into a valid key: "Reorder level" -> "reorderLevel".
*/
export const keyFromLabel = label => {
  const words = String(label ?? '').replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  if(!words.length) return '';
  const key = words.map((w, i) => i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)).join('');
  return /^[a-z]/.test(key) ? key.slice(0, 40) : '';
};

/*
  Validates and normalises a field definition. Returns [error, definition].
*/
export const normalizeFieldDefinition = (input = {}) => {
  const label = String(input.label ?? '').trim();
  if(!label) return [{ code: 400, msg: 'Field label is required' }, null];

  const key = String(input.key ?? keyFromLabel(label)).trim();
  if(!KEY_PATTERN.test(key)){
    return [{ code: 400, msg: 'Field key must start with a lowercase letter and contain only letters and numbers (max 40)' }, null];
  }
  if(CORE_KEYS.includes(key)) return [{ code: 400, msg: `"${key}" is reserved` }, null];

  if(!FIELD_TYPES.includes(input.type)) return [{ code: 400, msg: `Field type must be one of: ${FIELD_TYPES.join(', ')}` }, null];

  let options = [];
  if(input.type === 'select'){
    options = [...new Set((Array.isArray(input.options) ? input.options : []).map(o => String(o).trim()).filter(Boolean))];
    if(!options.length) return [{ code: 400, msg: 'A select field needs at least one option' }, null];
  }

  /*
    A photo field can force how photos are saved: a shape (an aspect ratio such as 1:1 or 16:9) they
    are cropped to as they are added, and a maximum size in pixels on either side. Other types ignore both.
  */
  let imageRatio = '';
  let imageMax = 0;
  if(input.type === 'media'){
    if(!isEmpty(input.imageRatio)){
      imageRatio = parseRatio(input.imageRatio);
      if(!imageRatio) return [{ code: 400, msg: 'The photo shape must be a ratio such as 1:1, 4:3 or 16:9' }, null];
    }
    if(!isEmpty(input.imageMax)){
      imageMax = Number(input.imageMax);
      if(!Number.isInteger(imageMax) || imageMax < 0 || (imageMax > 0 && imageMax < 16) || imageMax > MAX_IMAGE_EDGE){
        return [{ code: 400, msg: `The maximum photo size must be a whole number of pixels from 16 to ${MAX_IMAGE_EDGE} (or 0 for no limit)` }, null];
      }
    }
  }

  return [null, {
    key,
    label,
    type: input.type,
    description: String(input.description ?? ''),
    required: Boolean(input.required),
    listed: input.listed === undefined ? true : Boolean(input.listed),
    suggest: input.type === 'text' && Boolean(input.suggest),
    options,
    position: Number.isInteger(input.position) ? input.position : 0,
    imageRatio,
    imageMax,
  }];
};

/*
  Coerces one raw value to the field's type. Returns [error, value], where an empty input
  yields [null, null] (meaning "no value"). `item` fields are only shape-checked here; whether the
  linked item exists is checked by the caller, which has the database.
*/
export const coerceValue = (field, raw) => {
  if(field.type !== 'boolean' && (isEmpty(raw) || (Array.isArray(raw) && !raw.length))) return [null, null];
  const bad = msg => [{ code: 400, msg: `${field.label}: ${msg}` }, null];

  switch(field.type){
    case 'text': {
      /* Spaces before or after what was typed are never part of the value ("Vallejo " and "Vallejo" are one brand). */
      const value = String(raw).trim();
      if(!value) return [null, null];
      return value.length > MAX_TEXT ? bad(`must be ${MAX_TEXT} characters or fewer`) : [null, value];
    }
    case 'longtext': {
      const value = String(raw).trim();
      if(!value) return [null, null];
      return value.length > MAX_LONGTEXT ? bad(`must be ${MAX_LONGTEXT} characters or fewer`) : [null, value];
    }
    case 'number': {
      const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
      return Number.isFinite(value) ? [null, value] : bad('must be a number');
    }
    case 'rating': {
      /* A whole number of stars, 1 to 5. No stars (0) means no rating, the same as leaving it empty. */
      const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if(!Number.isInteger(value) || value < 0 || value > MAX_RATING) return bad(`must be a whole number of stars from 1 to ${MAX_RATING}`);
      return [null, value === 0 ? null : value];
    }
    case 'boolean': {
      if(isEmpty(raw)) return [null, null];
      if(typeof raw === 'boolean') return [null, raw];
      if(raw === 'true') return [null, true];
      if(raw === 'false') return [null, false];
      return bad('must be true or false');
    }
    case 'date': {
      const value = String(raw);
      const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
        && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
      return valid ? [null, value] : bad('must be a date (YYYY-MM-DD)');
    }
    case 'color': {
      /* A hex colour. Stored as "#rrggbb", or "#rrggbbaa" when it is see-through; "#abc" is expanded. */
      const text = String(raw).trim().toLowerCase();
      const short = text.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/);
      const value = short ? `#${short.slice(1).filter(Boolean).map(c => c + c).join('')}` : text;
      return /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/.test(value) ? [null, value.endsWith('ff') && value.length === 9 ? value.slice(0, 7) : value] : bad('must be a hex color such as #ff8800');
    }
    case 'select': {
      const value = String(raw).trim();
      if(!value) return [null, null];
      return field.options.includes(value) ? [null, value] : bad(`must be one of: ${field.options.join(', ')}`);
    }
    case 'item': {
      const value = String(raw);
      return /^[a-f0-9]{16}$/.test(value) ? [null, value] : bad('must be a valid item');
    }
    case 'media': {
      const list = Array.isArray(raw) ? raw : String(raw).split(',');
      const ids = [...new Set(list.map(v => String(v).trim()).filter(Boolean))];
      if(!ids.length) return [null, null];
      if(ids.length > MAX_MEDIA) return bad(`can hold at most ${MAX_MEDIA} files`);
      return ids.every(id => MEDIA_ID.test(id)) ? [null, ids] : bad('must be a list of media files');
    }
    default:
      return bad('has an unsupported type');
  }
};

/*
  Validates `input` (an object keyed by field key) against `fields`.
    partial=false: every required field must be present (creating an item)
    partial=true:  only the keys supplied are checked (updating an item)
  Returns [error, values] where `values[key]` is the coerced value or null to clear it.
*/
/*
  The fields an item shows: the default ones (category '') plus those scoped to its category.
  `category` is the item's category in any spelling; an uncategorised item gets only the defaults.
*/
export const applicableFields = (fields, category) => {
  const key = categoryKey(category);
  return fields.filter(f => !f.category || f.category === key);
};

export const coerceValues = (fields, input = {}, { partial = false } = {}) => {
  if(input === null || typeof input !== 'object' || Array.isArray(input)){
    return [{ code: 400, msg: 'fields must be an object' }, null];
  }
  const byKey = new Map(fields.map(f => [f.key, f]));
  const values = {};

  for(const key of Object.keys(input)){
    if(!byKey.has(key)) return [{ code: 400, msg: `Unknown field "${key}"` }, null];
  }

  for(const field of fields){
    const supplied = Object.prototype.hasOwnProperty.call(input, field.key);
    if(partial && !supplied) continue;
    const [error, value] = coerceValue(field, supplied ? input[field.key] : undefined);
    if(error) return [error, null];
    if(value === null && field.required){
      return [{ code: 400, msg: `${field.label} is required` }, null];
    }
    if(supplied || value !== null) values[field.key] = value;
  }
  return [null, values];
};
