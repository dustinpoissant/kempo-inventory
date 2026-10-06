import { tidyCategory } from './categoryLogic.js';

/*
  Who may change what. `owner` is '' for things people manage in the admin, or the name of the
  extension that created it, and `actor` is whoever is making the change in the same terms: the
  HTTP layer never names an actor ('' = a person), only an extension calling the server SDK can.

  Ownership never changes what stock does: anyone with the permission can still adjust an owned
  item's quantity. It protects what the owner builds on:

    items       sku, name, category and deletion belong to the owner
    categories  renaming (which rewrites every item's category) and deletion belong to the owner
    fields      see fields.js

  Everything else (description, tags, images, custom field values) stays editable by anyone, so an
  extension's items still show up and can be tidied in the admin. An extension that needs to guard
  more than this subscribes to the before_* hooks.
*/
export const LOCKED_ITEM_PROPERTIES = ['sku', 'name', 'category'];

export const ownerLabel = owner => owner ? `the "${owner}" extension` : 'people using the admin';

/* The locked properties `changes` would actually change. Sending the current value back is not a change. */
export const lockedItemChanges = (existing, changes, actor = '') => existing.owner === actor ? [] : LOCKED_ITEM_PROPERTIES.filter(property => {
  const value = changes[property];
  if(value === undefined) return false;
  return (property === 'category' ? tidyCategory(value) : String(value).trim()) !== existing[property];
});

export const notYours = (what, existing, actor = '') => ({
  code: 403,
  msg: `This ${what} is managed by ${ownerLabel(existing.owner)}${actor ? `, not "${actor}"` : ''}`,
});

/*
  Whether `actor` may rename or delete a record `owner` owns, and may merge into one.
*/
export const mayManage = (record, actor = '') => !record || record.owner === actor;

/*
  Renaming a category rewrites the category on its items and moves its fields, so it must not
  pull the rug from an extension that owns any of them. `holders` are the owners found there.
*/
export const blockingOwner = (holders, actor = '') => holders.find(owner => owner && owner !== actor) ?? null;
