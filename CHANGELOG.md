# Changelog

All notable changes to `kempo-inventory` are documented in this file.

## [Unreleased]

### Changed

- **New uploads go to kempo-media whenever it is installed, and the `media_provider` setting is gone.** kempo-media now sits on kempo-files and gets its thumbnails from kempo-thumbs, so the choice between "kempo-media with its own thumbnails" and "kempo-files with kempo-thumbs" no longer exists: one upload gives a stored file and its thumbnail either way. A site with only kempo-files still uploads there directly. `update.js` removes the retired setting.
- **`public_photos` now covers kempo-media uploads too** (it used to apply only to kempo-files), so turning it off keeps new photos behind `files:download` whichever library takes them.
- **Reading is unchanged.** Stored values still say where they live (a bare id is a kempo-media asset, `files:<id>` a kempo-files file), so everything written before keeps resolving. An export of a kempo-media photo now reads its bytes through kempo-files.
- Needs kempo-media 0.3.0 or later for uploads (the earlier `storeUpload` / `createMediaAsset` pair it called no longer exists).

### Added

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
