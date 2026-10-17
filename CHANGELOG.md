# Changelog

All notable changes to `kempo-inventory` are documented in this file.

## [Unreleased]

### Removed (breaking)

- **Held quantity is gone.** An item has one quantity again. `holdQuantity`, `releaseQuantity`, `consumeHeld`, the `kempo-inventory:quantity:before_hold` and `kempo-inventory:quantity:held` events, the `held` figure on an item, the "On hold" column and the refusal to delete an item with quantity on hold are removed. A hold belongs to whoever sells: kempo-products' ledger records the stock an order takes, and kempo-products-inventory takes the materials from here when it does and returns them when it is undone. Existing databases keep their `held`, `heldDelta` and `heldAfter` columns, which nothing reads or writes any more.

### Added

- **A "Category" link in the Products menu group**, straight to the categories page (priority 88, between Products and Inventory).

### Changed

- Its menu entry is in the **Products** group, after Products (priority 87), instead of Commerce.
- **Custom elements are renamed to `k-inventory-<name>`**, the extension's name after `k-`; the old tag names stop working: `inventory-media-field` is `k-inventory-media-field`, `inventory-color-field` is `k-inventory-color-field`, `inventory-row-action` is `k-inventory-row-action`, `k-inv-widget` is `k-inventory-widget`.
- **"Stock" is now "quantity", everywhere**, so an item, a product and a cart line all say the same word. `adjustStock` and `adjustStockMany` are `adjustQuantity` and `adjustQuantityMany`; the `kempo-inventory:stock:adjusted` and `before_adjust` events are `kempo-inventory:quantity:...`; the `kempo-inventory:stock:adjust` permission is `kempo-inventory:quantity:adjust` (`update.js` moves every group's grant to the new name, so nobody loses the right); the dashboard widget key is `quantity`. The `quantity` column was already called that. "In stock" and "out of stock" remain as the plain English they are. Anything that listens for the old events or calls the old functions has to change, and extensions that listen declare the new names in their `kempo-config.json`.
- **New uploads go to kempo-media whenever it is installed, and the `media_provider` setting is gone.** kempo-media now sits on kempo-files and gets its thumbnails from kempo-thumbs, so the choice between "kempo-media with its own thumbnails" and "kempo-files with kempo-thumbs" no longer exists: one upload gives a stored file and its thumbnail either way. A site with only kempo-files still uploads there directly. `update.js` removes the retired setting.
- **`public_photos` now covers kempo-media uploads too** (it used to apply only to kempo-files), so turning it off keeps new photos behind `files:download` whichever library takes them.
- **Reading is unchanged.** Stored values still say where they live (a bare id is a kempo-media asset, `files:<id>` a kempo-files file), so everything written before keeps resolving. An export of a kempo-media photo now reads its bytes through kempo-files.
- Needs kempo-media 0.3.0 or later for uploads (the earlier `storeUpload` / `createMediaAsset` pair it called no longer exists).

### Added

- The test scripts run files one at a time: they share and empty one database, which two files at once corrupted.
- **Dashboard widget.** A **Inventory** widget on the kempo admin dashboard showing item, unit and out-of-stock counts and the latest stock movements, with a **New item** button, declared in `widgets` in `kempo-config.json`. Needs a kempo with the dashboard; ignored on older versions.
- A **documentation site** (`docs-src/` built into `docs/` for GitHub Pages) with screenshots of the admin.
- **`adjustStockMany`**: several stock changes applied together, all or nothing, with a reference written on every movement so they can be reversed. For events that touch several items, such as the materials of a recipe.
- An **`inventory-item-actions` fragment** on the admin item page, so another extension can add to it.

First public release. An inventory core for kempo: items with a SKU, name, category, tags and
stock, custom fields, categories with images, an audited stock history, import and export, and a
server SDK and hooks for other extensions to build on.

- **Ownership.** Fields, categories and items can belong to an extension. The owner alone can
  delete them and change what defines them (an item's SKU, name and category; a category's name
  and merges; a field's key and type), while people keep editing everything else in the admin,
  stock included. Ownership only ever comes from the server SDK, never from an HTTP request.
  - `createItem(data, { owner })`, `updateItem(id, data, { owner })`, `deleteItem(id, { owner })`
  - `registerCategory` / `unregisterCategories`, and `registerField` can now target a category
  - `unregisterItems(owner, { release })` for uninstall.js
  - `getItems({ owner, ids })`, `getFields({ owner })`, `getCategories({ owner })`
- **More hooks.** `category:before_update`, `category:before_delete`, `field:before_create`,
  `field:before_update` and `field:before_delete` can refuse a change, and every hook payload now
  carries `actor`: the extension that made the change, or `''` for a person.
- **Admin.** A "Managed by" column on items and categories, and the SKU, name and category of an
  owned item (or the name of an owned category) are locked with an explanation.
- **Migration.** `update.js` adds `owner` to items and categories. Existing ones stay
  people-managed.
