# Changelog

All notable changes to `kempo-inventory` are documented in this file.

## [Unreleased]

### Changed

- The item page has no wrapper element, so its tabs sit directly in `<main>`, as the rest of a site's pages do.
- The SDK sends its requests through kempo's shared request layer (`/kempo/fetch.js`), so a page and its components that ask for the same thing make one request. Requires kempo 4.13.0 or later.

## [0.6.0] - 2026-11-12

Requires kempo-ui 1.5.0 or later (the read-only fields).

### Added

- **One item page.** `/items/<id>` is the page to read and, for people who may update items, to edit: Details (the form, with Save and Reset at the top right, both off until something changes; a save stays on the page and shows a toast at the bottom right), Quantity, and the tabs extensions add (Barcodes). The separate edit page is gone from this extension.
- **URL field type (`url`).** Stored like short text, shown as a link on the item page. Without a scheme `https://` is added; only http and https are accepted, so a link cannot run a script. A text field can be converted to a URL field: every value it holds must be a web address, and is kept as its full address. A javascript: address is stripped of its scheme when a field is converted, and only http and https addresses become links (anything else shows as plain text). Other values stay as they are; every URL field value is shown as a link that opens in a new tab.
- **Units.** Items and categories have a unit (oz, g, or anything up to 20 characters). An item's own unit overrides its category's. The unit is shown beside quantities on the item's Quantity tab and in the admin list, and it is kept by export and import. Nothing is built in: a unit is only what someone types.
- **Decimal quantities.** The `decimal_quantity` setting (off by default) allows quantities with up to four decimal places, such as 2.5 oz. Off, quantities stay whole numbers. Turning it on does not change quantities already stored. Quantities are now stored with decimal places, so this update changes the quantity columns' type on existing databases.
- **Set to a count.** The Quantity tab and the admin Adjust dialog can set the count outright; the change is worked out from the count held at the moment of the write. Setting the count it already has records nothing.
- **Quantity tab** on the admin edit page and the item page: the count, add or remove, and the history.
- **An `inventory-item-tabs` location** on the admin item page. The page is now tabbed (Details first), and an extension adds its own tab with an admin/*.global.html file.

### Changed

- **The item page looks the same for everyone.** People who cannot edit see the same form with every box read only (a link beside a URL or linked item opens it; a photo opens the viewer), and no Save, Reset or Delete. `createItemForm` takes `readOnly`, and `fieldTemplate` takes `readOnly` in its context. The Quantity tab shows for everyone, signed in or not: `GET /inventory/api/items/[id]` now sends the count and history to any reader (without `userId` unless they manage quantity). Lists, searches and `GET /inventory/api/movements` are unchanged.
- **The Quantity tab lays out in two rows** (How and Count, then Reason and Note), without footnotes. Count is marked required with a red asterisk; everything else is optional.
- **The reason is optional.** A quantity change with no reason is stored with no reason, and the history shows nothing in the Reason column. Changes made through the API without a `reason` still record `adjustment`.
- A field's **Applies to** can be changed when the field is edited (it was fixed at creation). Its values move with it, and the change is refused if the key is already used in the new scope. Only the extension that manages a field can change its scope; the admin cannot.

## [0.5.1] - 2026-11-09

### Added

- An **`inventory-item-sections` location** on the admin item page, below the form, so several extensions can each add a section to it (the `inventory-item-actions` fragment has a single winner).

## [0.5.0] - 2026-11-09

Requires kempo 4.11.0 or later.

### Changed

- The `kempo-ui` peer dependency is now `>=1.0.0`.
- The `kempo` peer dependency is now `>=4.11.0`.

- **Fields is a tab on the Inventory page**, with the Items and Categories tabs. Its own page and the Fields button on the Items toolbar are removed, with no redirect. The tab loads when it is first opened, and needs `kempo-inventory:fields:manage`.

- **Inventory and Inventory Categories are one admin page** at `/admin/extension/kempo-inventory/`, with an Items tab and a Categories tab (hash routing, so each has its own address: `#categories`). The Categories page, its nav entry and the Categories button on the Items toolbar are removed, with no redirect from the old address. Fields stays its own page.

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

## [0.4.1] - 2026-10-26
### Changed
- The items list is a kempo-ui table. The row opens the item, and Edit and Adjust quantity are row controls.
- Requires kempo 4.9.7 (the admin lists use kempo-ui tables).
