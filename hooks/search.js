import { publicReadEnabled } from '../server/utils/access.js';
import { searchCategories, searchItems } from '../server/utils/searchInventory.js';
import { tokensOf } from '../server/utils/searchScore.js';

/*
  The inventory's part of a kempo-search search (the `search:query` hook), for the types:

    inventory-item      items, by name, SKU, description, category, tags and text fields
    inventory-category  categories, by name, tags and description

  Asking for both at once works, and a search of several words matches each word on its own against the item's properties,
  including its category: "blue filament" finds the item Blue in the category Filament, where "blue" alone also finds paints and
  "filament" alone finds every filament. The words' scores are combined into the item's score.

  Who may read is checked first, before the database is read: the `items:read` permission, or anyone when the `public_read`
  setting is on. A result never carries the quantity.
*/
export default async ({ search, types, window, permissions, isAdmin, results, totals }) => {
  const wantsItems = types.includes('inventory-item');
  const wantsCategories = types.includes('inventory-category');
  if(!wantsItems && !wantsCategories) return;

  if(!isAdmin && !permissions.includes('kempo-inventory:items:read') && !await publicReadEnabled()) return;

  const tokens = tokensOf(search);
  if(!tokens.length) return;

  const [itemsFound, categoriesFound] = await Promise.all([
    wantsItems ? searchItems({ tokens, window }) : [null, null],
    wantsCategories ? searchCategories({ tokens, window, adminUrl: isAdmin || permissions.includes('system:admin:access') ? '/admin/extension/kempo-inventory/' : '' }) : [null, null],
  ]);

  for(const [type, [error, found]] of [['inventory-item', itemsFound], ['inventory-category', categoriesFound]]){
    if(error) console.error(`[kempo-inventory] Searching "${type}" failed: ${error.msg}`);
    if(!found) continue;
    results[type].push(...found.results);
    totals[type] = found.total;
  }
};
