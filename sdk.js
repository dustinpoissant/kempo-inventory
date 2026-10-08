/*
  The server SDK other extensions build on. Every function resolves to [error, result].

  An extension that adds to inventory declares `"dependencies": ["kempo-inventory"]` in its
  kempo-config.json, registers its fields in install.js, and removes them in uninstall.js:

    import { registerFields } from 'kempo-inventory/sdk';
    export default async () => {
      const [error] = await registerFields('my-extension', [
        { key: 'manufacturer', label: 'Manufacturer', type: 'text' },
      ]);
      if(error) throw new Error(error.msg);
    };

  Fields, categories and items can all be owned. Pass your extension name as `owner` and only you can
  delete them or change the parts that define them; people keep editing everything else (stock
  included) in the admin. Owner is never read from an HTTP request, only from these server calls:

    registerCategory(owner, { name, description })       registerField(owner, { ..., category })
    createItem(data, { owner })                          updateItem(id, data, { owner })
    deleteItem(id, { owner })                            saveCategory(name, changes, { owner })
    unregisterItems(owner, { release }) / unregisterCategories(owner) / unregisterFields(owner)
*/
export {
  getItems,
  getItem,
  getItemBySku,
  getLinked,
  getMedia,
  createItem,
  updateItem,
  deleteItem,
  unregisterItems,
  adjustStock,
  adjustStockMany,
  getMovements,
} from './server/utils/items.js';

export {
  getFields,
  getField,
  createField,
  updateField,
  deleteField,
  registerField,
  registerFields,
  unregisterFields,
} from './server/utils/fields.js';

export { getSuggestions } from './server/utils/suggestions.js';
export { buildExport, importData } from './server/utils/importExport.js';
export { previewImport, applyImport } from './server/utils/importFile.js';
export { buildZip } from './server/utils/zip.js';
export { getTags } from './server/utils/tagList.js';
export { normalizeTags, MAX_TAG, MAX_TAGS } from './server/utils/tags.js';
export {
  getCategories,
  saveCategory,
  setCategoryImage,
  deleteCategory,
  registerCategory,
  unregisterCategories,
} from './server/utils/categories.js';
export { mediaAvailable, uploadProvider } from './server/utils/media.js';
export { FIELD_TYPES } from './server/utils/fieldTypes.js';
export { EVENTS } from './server/utils/events.js';
