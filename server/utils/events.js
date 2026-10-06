/*
  Events this extension fires. Other extensions subscribe by declaring them in their own
  kempo-config.json `hooks`, e.g. { "kempo-inventory:item:created": "./hooks/item-created.js" }.

  Guards ("before" events) run first and can change the pending operation or refuse it:
    - the payload carries a mutable `draft` (or `changes`); edit it in place to alter what is saved
    - throw `{ code, msg }` to refuse; the caller receives exactly that error
  Category and field guards can only refuse. Every payload carries `actor`: the extension that made
  the change through the server SDK, or '' for a person using the admin.
  Notifications ("after" events) run once the work is committed; nothing they do can undo it.
*/
export const EVENTS = {
  itemBeforeCreate: 'kempo-inventory:item:before_create',
  itemCreated: 'kempo-inventory:item:created',
  itemBeforeUpdate: 'kempo-inventory:item:before_update',
  itemUpdated: 'kempo-inventory:item:updated',
  itemBeforeDelete: 'kempo-inventory:item:before_delete',
  itemDeleted: 'kempo-inventory:item:deleted',
  stockBeforeAdjust: 'kempo-inventory:stock:before_adjust',
  stockAdjusted: 'kempo-inventory:stock:adjusted',
  categoryBeforeUpdate: 'kempo-inventory:category:before_update',
  categoryUpdated: 'kempo-inventory:category:updated',
  categoryBeforeDelete: 'kempo-inventory:category:before_delete',
  categoryDeleted: 'kempo-inventory:category:deleted',
  fieldBeforeCreate: 'kempo-inventory:field:before_create',
  fieldCreated: 'kempo-inventory:field:created',
  fieldBeforeUpdate: 'kempo-inventory:field:before_update',
  fieldUpdated: 'kempo-inventory:field:updated',
  fieldBeforeDelete: 'kempo-inventory:field:before_delete',
  fieldDeleted: 'kempo-inventory:field:deleted',
};
