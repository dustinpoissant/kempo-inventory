# kempo-inventory

The core of an inventory system for [kempo](https://www.npmjs.com/package/kempo) CMS. It is deliberately small: every item has just a **SKU**, **name**, **quantity** and **description**. Everything else is a *custom field* that a person adds in the admin, or that another extension registers, so the same base can model anything: parts, books, rentals, supplies.

- Stock changes go through one audited action, with a reason, a note and a movement history
- Custom fields of seven types, managed in **Admin > Inventory > Fields**
- A server SDK and a set of hooks so other extensions can extend it (reorder levels, pricing, suppliers, categories...), and fields, categories and items can be owned by an extension
- Admin page at **Admin > Inventory**, JSON API under `/inventory/api`

## Install

```bash
npm install kempo-inventory
```

Then **Admin > Extensions > Install** next to `kempo-inventory`.

## Custom fields

Users in the `kempo-inventory:admin` group add fields from **Inventory > Fields**. Each has a label, a key (derived from the label, fixed once created), a type, and whether it is required and shown in the item list.

| Type | Holds |
|---|---|
| `text` | Short text (up to 1,000 characters) |
| `longtext` | Longer text (up to 20,000 characters) |
| `number` | Any number |
| `boolean` | Yes / no |
| `date` | A date (`YYYY-MM-DD`) |
| `rating` | A whole number of stars, 1 to 5, chosen with Kempo UI's star rating (empty = no rating) |
| `color` | A hex colour (`#ff8800`, or `#ff880080` when see-through), chosen with Kempo UI's colour picker. Optional like any field: clear it to have none |
| `select` | One of a list of choices you define |
| `item` | A link to another item, for things that are related in some way |
| `media` | Photos and other files, up to 20 per field. Only available when [kempo-media](#photos-and-files-optional-kempo-media) is installed |

Text is stored **without leading or trailing spaces**: names, SKUs, descriptions and every text, long-text and choice field value are trimmed (by the API, so the forms, imports and scripts all get it), and a value of only spaces counts as empty (a required field with only spaces is missing). That keeps `FolkArt` and `FolkArt ` from becoming two brands. `update.js` 0.14 trimmed what was already stored, and suggestions ignore stray spaces in old data.

A `text` field can also **suggest values already used**: switch on "Suggest values already used" in the field editor and, as you type, the form offers matching values from other items (and the most used ones the moment the field is focused). That keeps repeated entries such as a brand consistent (`vallejo` and `Vallejo` count as one suggestion, shown the way it is most often written). It is only a suggestion: anything new can still be typed.

The item list, its filters and the item form are all built from the field list. Every `select` field gets a filter, and search covers custom values too. A field's type can only be changed where nothing can be lost: a choice list can become free text (its values are already plain strings) and short text can become long text. Anything else is refused, because existing values could be orphaned; delete the field and create a new one instead. The key never changes. Deleting a field removes its value from every item.

### Fields for one category

A field applies either to **every item** (the default) or to **one category**. Make a paint's "Finish" (Matte, Satin, Gloss) for the Paint category and it only appears on items whose category is Paint; filament can have its own "Diameter" and nothing else sees it. Choose what a field **Applies to** when you create it (**Inventory > Categories** has a gear button per category that opens its fields). The item form shows the default fields plus those of the typed category, and swaps them as the category changes.

- A key is unique within its category, so two categories can each have a "finish". A category cannot reuse a key a default field has (and the other way round), because both would be stored under the same name on its items.
- Moving an item to another category keeps the values it held for fields it no longer shows. They are hidden, not deleted, and come back if the item returns.
- Renaming a category takes its fields with it. Merging into a category that has a field with the same key is refused, and a category that still has fields cannot be deleted. Deleting a field removes its values only from that category's items.
- A field is identified by its key and category, so the API takes `?category=` to find a category's field.

A field is either **custom** (created in the admin; you manage it) or **owned by an extension** (registered through the SDK; only that extension can delete it or change what it holds, though you can rename it and choose whether it shows in the list).

## Categories

`category` is a built-in, optional property of every item, like `sku`. It is free text (up to 100 characters) and the item form suggests categories already in use. Categories are not a list you maintain: they are the distinct values in use, matched ignoring case and spacing (`Paint`, `paint` and ` Paint ` are one category). What the extension adds is a small record per category holding an **image** and a **description** (up to 500 characters).

Manage them in **Admin > Inventory > Categories**: create one before any item uses it, edit its description and image, rename it (the items change too, and renaming onto an existing name merges the two), or delete it. A category that items still use cannot be deleted.

```js
import { getCategories, saveCategory, deleteCategory } from 'kempo-inventory/sdk';   // server
import { getCategories, saveCategory, deleteCategory } from '/inventory/sdk.js';     // browser

const [, data] = await getCategories({ includeEmpty: true });
// { uncategorised: 2, categories: [{ name: 'Paint', key: 'paint', count: 7, description, image: { path, thumbnail, ... } | null }] }

await saveCategory('Paint', { description: 'Hobby paints' });          // only what you pass changes
await saveCategory('Paint', { image: 'files:0123456789abcdef' });      // a stored media id; null clears it
await saveCategory('Paint', { newName: 'Paints' });                    // renames and updates the items
await deleteCategory('Paint');                                         // refused (409) while items use it
```

By default only categories some item has are returned; `includeEmpty` also returns ones that exist only as a record. Images are stored media ids, so they need kempo-media or kempo-files. Fires `kempo-inventory:category:updated` and `kempo-inventory:category:deleted`.

## Forcing a photo's shape and size

A photo field (type "Photos / files") can **force how photos are saved**. When you create or edit one, set:

- **Force photo shape**: an aspect ratio such as `1:1`, `4:3` or `16:9`. Each photo added to the field opens in Kempo UI's `<k-image-crop>`, locked to that shape, so only that shape can be saved; **Skip** leaves a photo out.
- **Max size (px)**: photos are kept within this many pixels on a side (scaled down, never up). With only a max size and no shape, photos are simply scaled down, with no cropper.

Leave both empty and photos are uploaded as they are. The stored file is the cropped one, so the shape holds everywhere it is shown. A category's picture is always cropped to the `category_image_ratio` setting below. Anything the browser cannot edit (GIF, SVG, HEIC, video) is uploaded untouched. The same two properties (`imageRatio`, `imageMax`) are on the field API, and `<inventory-media-field crop-ratio="1 / 1" crop-max="1600">` applies them in your own forms. Needs kempo-ui 0.5 or newer.

## Image shape

Two settings (**Admin > Settings**) set the aspect ratio images are *shown* at (a display crop; a photo field's forced shape above changes what is stored): `category_image_ratio` and `item_image_ratio`, written `width:height` (`4:3` by default, or `1:1`, `16:9`...). A blank or invalid value falls back to `4:3`. Images are **cropped to fit** the shape, never stretched, and the originals are not changed, so changing the setting reshapes every image at once. The admin's category and item pickers use them, and `GET /inventory/api/fields` returns them as `imageRatios` (CSS, e.g. `"4 / 3"`) so a site can do the same; `<inventory-media-field ratio-for="category">` previews at the category shape.

## Import and export

**Admin > Inventory** has **Export** and **Import** buttons (admin portal only; the public site has none). Both are limited to the **top tier**: the `kempo-inventory:fields:manage` permission, held by the `kempo-inventory:admin` group. A manager, a viewer or a signed-out visitor gets a 403 (or 401) and does not see the buttons, because an export carries the whole inventory out and an import can rewrite and re-stock all of it.

**Export** downloads the whole inventory in one of two forms:

- **Data only** (`.json`): every item (SKU, name, category, quantity, tags, description, custom field values) and category (description, tags), plus a list of the field definitions for reference. No photos.
- **With media** (`.zip`): the same document as `inventory.json` plus every photo and file the items and categories use, under `media/`. Importing it brings the photos back.

**Import** takes either one (or any zip with an `inventory.json` in this format, including one re-zipped with compression). It is **done on the server**, in two steps:

1. **Check.** The file is uploaded once and checked. You see how many items are new, how many already exist (matched by **SKU**; categories by name), what would be ignored, and any rows that cannot be imported and why. Nothing in the inventory has changed yet.
2. **Import.** For the ones that already exist you choose **Ignore them** (leave what is here exactly as it is; the default) or **Update them** with the file's values (a value the file leaves empty never clears anything, and a changed quantity is recorded as a stock adjustment, "import", so the history stays honest).

Things worth knowing: an import never creates or changes **fields**; a value only comes across when a field with the same key exists and applies to the item's category (the rest are ignored and counted). Rows are independent: one that fails (a missing name, a bad number, a required field with no value) does not stop the others. A field linking to another item is exported as that item's SKU and resolved by SKU on import, including to items created in the same import. Photos only come from the zip; each distinct photo is stored once, to the library new uploads normally go to (as the person importing, with its own file-library rules), at its original size.

### How an uploaded file is handled (security)

- **Permission first.** Both import routes check `fields:manage` before they read, parse or store anything from the request. Anyone else gets 401/403 and the upload is never looked at. (kempo-server itself has already received the body by the time any route runs, on every route of the site, up to its `maxBodySize`; lower that in the site's kempo-server config to bound it, and see the `import_max_mb` setting below.)
- **Staging.** The checked upload is kept under a random 128-bit name in the system temp directory, mode 0600, never served, usable only by the person who uploaded it, and deleted when the import runs, when they stage another, or after 30 minutes.
- **Zips are opened in memory only.** A zip is recognised by its first bytes, not its name. Entries are looked up by the exact names `inventory.json` asks for (`media/<name>`, no folders, no `..`, no slashes), never written to disk by their names, and at most 20,000 files may be in a zip, 200 MB for one file to inflate to (so a small "zip bomb" cannot exhaust the server), 5,000 photos and 1 GB of photos per import.
- **Only real media.** A file is stored only if its extension is a photo, video, audio or PDF type (png, jpg, gif, webp, avif, bmp, mp4, webm, mov, mp3, wav, ogg, m4a, pdf) **and** its first bytes really are that type: a web page renamed `.png` is refused. Everything else is skipped and listed in the result. Stored files then go through the normal library (kempo-files stores them as untrusted, never executed in the browser).
- **Text is data.** The text in the JSON is stored as data and escaped wherever it is shown; an import cannot run anything.

The `import_max_mb` setting (**Admin > Settings**, 250 by default) is the largest file the import accepts.

For scripts: `GET /inventory/api/export?format=json|zip`; and for an import, `POST /inventory/api/import/preview` with the file as the raw request body (`Content-Type: application/octet-stream`) returns the report and an `importId`, then `POST /inventory/api/import/apply` with `{ importId, onMatch: "skip" | "update" }` does it. The server SDK has `buildExport`, `importData`, `previewImport` and `applyImport`, the browser SDK `exportUrl`, `previewImport` and `applyImport`.

## Tags

Items and categories can be **tagged**: short labels such as `acrylic`, `red`, `matte`, `water-based`. Tags are built in (like the category), **always lower case**, with spacing tidied (`Water-Based` and ` water-based ` are one tag): the API lower-cases whatever it is given, the item and category forms convert what you type as you type it (and pasted lists), tags show in lower case everywhere, and every search for a tag (`q`, `?tag=`, the site's search and filters) ignores case. `update.js` 0.13 lower-cased the tags that already existed, de-duplicating the ones that collapse together, at most 30 per item or category and 40 characters each. In the item and category forms they use Kempo UI's `<k-tags>`: type a tag and press Enter, Tab or comma to add it (leaving the box does not add it, but saving the form does), click a chip to remove it, and tags already used are completed as you type.

- **Search:** the `q` search of items matches tags, and categories can be searched by name, description or tag: `GET /inventory/api/categories?q=acrylic`.
- **Exact filter:** `?tag=red` returns items with that tag (categories too, on `/categories`); repeat it as a JSON list, `?tag=["red","matte"]`, to require all. Combine with `q`.
- **Writing:** `tags` (a list, or text such as `"acrylic, red"`) on `POST`/`PATCH /items` and `PUT /categories`; leaving it out leaves the tags alone. Merging categories unites their tags.
- **All tags:** `GET /inventory/api/tags` (`?q=` narrows it) returns `[{ tag, count }]` for items and categories together, most used first; the SDK has `getTags()`. Anyone who can read items can read it.
- **Inheritance:** an item does not inherit its category's tags. Searching a category's tag finds the category, and the category is how you reach its items.
- The admin lists show a Tags column. To reuse the control in your own forms, `ItemFields.js` exports `tagsValue(tags)`, `suggestTags` and `readTags($tags)` for use with `<k-tags .value=${tagsValue(tags)} .getSuggestions=${suggestTags}>`; `readTags` includes text typed but not yet added.

## Who can read, and who can see stock counts

Reading the inventory needs the `items:read` permission. Turn on the `public_read` setting (off by default) and **anyone can read it, signed in or not**, so it can be shared as a catalogue. Public reading covers items, categories and fields (and photos, see below); writing always needs the matching permission.

**Stock counts are only for people who manage stock.** A caller without `stock:adjust` or `items:update`, whether signed out, signed in with only `items:read`, or reading publicly, gets items **without `quantity`** and no stock history (`GET /inventory/api/movements` is refused). Callers who do manage stock get everything as before.

## Who can see photos

kempo-files only serves a file to people with its `files:download` permission, which someone who can merely *read* the inventory does not have, so their photos would be broken images. The `public_photos` setting (on by default) uploads photos as **public**, whether they go to kempo-media or kempo-files: viewable by anyone who has the link (ids are unguessable), which includes every inventory reader. Turn it off to keep photos behind `files:download`; then give your readers that permission. Changing the setting only affects new uploads. `update.js` also marks the photos items and categories already use (and their thumbnails) public when the setting is on.

## Photos and files (optional)

Three optional extensions can take part. Inventory never imports any of them up front, each is detected at runtime, and with none installed nothing else changes: the `media` field type is simply not offered, and creating one is refused with a clear message.

| Extension | Role |
|---|---|
| [kempo-media](https://github.com/dustinpoissant/kempo-media) | A media library: a kempo-files file plus kind, dimensions and alt text, with thumbnails from kempo-thumbs. It requires the other two, so installing it brings all three |
| [kempo-files](https://github.com/dustinpoissant/kempo-files) | A file library: files live outside `public/` and every download is permission-checked, unless the file is marked public |
| [kempo-thumbs](https://github.com/dustinpoissant/kempo-thumbs) | Generates thumbnails for kempo-files, including frames from video and audio |

When an item has more than one photo, the first is its **primary** photo (the one shown on cards and lists). In the item form each other photo has a **Make primary** button that moves it to the front.

Add a field of type "Photos / files" and every item gets an upload area. New uploads go to kempo-media when it is installed (it is kempo-files with thumbnails, so one upload gives you a stored file and its thumbnail), and to kempo-files directly on a site that has only that. There is no setting to choose; the old `media_provider` setting was retired, and `update.js` removes it.

A stored value records where its file lives (a bare id is a kempo-media asset, `files:<id>` a kempo-files file), so values written before this change, or by a site with only kempo-files, keep working on the same item as newer ones. The API returns a `media` map (stored id → `{ kind, name, alt, path, thumbnail }`) next to `linked`, so a client can show them. A kempo-files photo has no `thumbnail` until kempo-thumbs has generated one, so clients should fall back to `path`.

- If a library is disabled later, items keep their stored ids and everything else keeps working. Files from that library show as missing, and only *adding* a file from it is refused; an item can still be edited with its existing list unchanged.
- Deleting a file from its library leaves the id on the item, shown as a missing file.
- **Permissions:** the inventory groups do not grant media permissions, since they belong to the optional extensions. Uploading needs `media:upload` (kempo-media) or `files:upload` (kempo-files). With kempo-files, *viewing* a photo needs `files:download` too, so give read-only users a group that has it.

## Barcode scanning

The item form has a **Scan** button beside the SKU: point the camera at a barcode and the SKU is filled in, with a warning if another item already uses it. The scanner is a reusable module too:

```javascript
import { scanBarcode } from '/inventory/components/BarcodeScanner.js';

const code = await scanBarcode();   // the code's text, or null if cancelled
```

For a scanner that stays on screen and keeps going (a "scan page"), use `startScanner` with your own `<video>`:

```javascript
import { startScanner } from '/inventory/components/BarcodeScanner.js';

const scanner = await startScanner({ video: $video, onCode: code => lookUp(code) });
scanner.setPaused(true);   // ignore codes while a dialog is open
scanner.stop();            // release the camera
```

`onCode` fires once each time a code comes into view. The same code is not reported again until it has left the frame for a moment, so holding a bottle still gives one scan while scanning the next bottle of the same paint gives another. It rejects if the camera can't be started (`cameraProblem()` and `explainCameraError()` turn that into a sentence for the user).

- It uses the browser's own `BarcodeDetector` where it exists (Chrome on Android) and otherwise falls back to [ZXing](https://github.com/zxing-js/library), so it also works on iPhone and desktops. The fallback is bundled in `public/vendor/` (see `LICENSES.md` there), so nothing is loaded from a CDN.
- Reads EAN-13/8, UPC-A/E, Code 128/39/93, ITF, Codabar, QR, Data Matrix, PDF417 and Aztec.
- **Cameras only work on HTTPS pages** (and `localhost`). On a plain-http address the dialog says so rather than failing silently.
- The camera is switched off as soon as a code is read or the dialog is closed.
- A USB or Bluetooth barcode scanner needs no camera: it types the code into the SKU box and presses Enter. In the item form Enter in the SKU box moves to the name instead of submitting the form.
- `openItemDialog({ defaults: { sku } })` opens the new-item form with a SKU already filled in, which is how a site can offer "no item has this barcode, create it?".

## UI building blocks for sites

This extension ships the data and the API, plus an admin screen for managing it. A site that wants its own screens (a dashboard, product pages, a storefront) builds them itself, and can reuse the same browser modules the admin page uses:

```javascript
import { getItems, getFields, adjustStock } from '/inventory/sdk.js';            // the API client
import { openItemDialog, openAdjustDialog } from '/inventory/components/ItemDialog.js';
import { fieldTemplate, readField, displayValue } from '/inventory/components/ItemFields.js';

openItemDialog({ item, fields, onSaved: item => reload() });    // the form in a dialog, for a screen that really wants one
openAdjustDialog({ item, onSaved: item => reload() });          // add or remove stock
```

**Adding and editing an item are pages, not dialogs.** A dialog closes with a stray tap outside it and takes everything entered with it (photos taken with the camera included), so each gets a page of its own that keeps the work and warns before it is left. In the admin they are **Inventory > New Item** (`/admin/extension/kempo-inventory/new`) and the edit action on a row (`/admin/extension/kempo-inventory/edit?id=…`). A site gets the same from `NewItemPage.js`:

```javascript
import { mountNewItemPage, safeNext } from '/inventory/components/NewItemPage.js';
import { showFlash } from '/inventory/components/flash.js';

mountNewItemPage({ $container, fields, defaults: { category: 'Paint' }, askQuantity: false, next: '/category?name=Paint' });
mountEditItemPage({ $container, item, fields, context: { linked, media, ownId: item.id }, next: '/items/' + item.id });   // item, linked, media from getItem()
showFlash();   // on the page it goes back to: shows "Added <name>" or "Saved <name>" once
```

The new-item page has **Create item**, **Create and add another** and **Cancel**; the edit page has **Save** and **Cancel**. While anything entered has not been saved, leaving the page (a link, the back button, a refresh, closing the tab) triggers the browser's own "changes may not be saved" prompt, and Cancel asks before discarding. `window.hasUnsavedInventoryWork()` tells anything else that wants to move the page (an offline redirect, say) whether to hold back. `next` must be a path on the same site: `safeNext(value, fallback)` refuses anything else. The form itself is `createItemForm` (`ItemForm.js`: `{ $root, save(), isDirty() }`), which the pages and the dialog all use. (`openItemDialog` is still there for a screen that wants a dialog; it does not close when you click outside it.)

`openItemDialog` builds its form from the field list, so custom fields, item links and photo uploads work without any site code. `fieldTemplate` / `readField` render and read a single field's input if you want your own layout, and `displayValue` gives a plain-text rendering safe to put in a table cell.

## Building on this extension

An extension that adds to inventory declares the dependency, registers its fields, and cleans up after itself:

```json
// kempo-config.json
{
  "dependencies": ["kempo-inventory"],
  "hooks": {
    "kempo-inventory:item:before_create": "./hooks/before-create.js",
    "kempo-inventory:stock:adjusted": "./hooks/stock-adjusted.js"
  }
}
```

```javascript
// install.js
import { registerFields } from 'kempo-inventory/sdk';

export default async () => {
  const [error] = await registerFields('kempo-inventory-reorder', [
    { key: 'reorderLevel', label: 'Reorder level', type: 'number' },
    { key: 'supplier', label: 'Supplier', type: 'item' },
  ]);
  if(error) throw new Error(error.msg);
};
```

```javascript
// uninstall.js
import { unregisterFields } from 'kempo-inventory/sdk';

export default async () => { await unregisterFields('kempo-inventory-reorder'); };
```

`registerFields` is idempotent, so it is safe to call again on update. It refuses to take a key another owner holds, or to change an existing field's type. Kempo stops a dependency being uninstalled while something that depends on it is enabled.

### Ownership

Fields, categories and items can each belong to an extension. `owner` is `''` for what people manage in the admin, or the name of the extension that created it. Ownership protects what the owner builds on, and leaves the rest alone so its items stay useful in the admin:

| | Only the owner can | Anyone with the permission can still |
|---|---|---|
| **Field** | delete it, change its key, type (within the safe conversions), requirement or options | rename it, change its description, list/suggest settings and position |
| **Category** | rename it (which rewrites its items), merge into or out of it, delete it | change its image, description and tags, and put items in it |
| **Item** | change its SKU, name and category, delete it | edit description, tags and custom field values, and **adjust stock** |

A category cannot be renamed or merged by anyone but its owner while it holds items or fields another extension owns, because that would rewrite them. Sending an owned item's current SKU, name and category back unchanged is not a change, so the admin form keeps working.

Ownership only comes from the server SDK. The HTTP routes never read an owner from a request, so the admin and the JSON API always act as people (`''`), and an extension cannot be impersonated from the browser. An extension calling the SDK passes its own name as `owner` to act as the owner; leave it out and it is treated as people, so it cannot rename or delete another extension's records, or even one a person made.

```javascript
// install.js
import { registerCategory, registerField } from 'kempo-inventory/sdk';

export default async () => {
  await registerCategory('kempo-products', { name: 'Finished goods', description: 'Ready to ship' });
  await registerField('kempo-products', { key: 'price', label: 'Price', type: 'number', category: 'Finished goods' });
};

// at runtime
import { createItem, updateItem, getItems } from 'kempo-inventory/sdk';
const [, item] = await createItem({ sku: 'CAR-1', name: 'Model car', category: 'Finished goods', quantity: 2 }, { owner: 'kempo-products' });
await updateItem(item.id, { name: 'Model car v2' }, { owner: 'kempo-products' });
const [, mine] = await getItems({ owner: 'kempo-products' });   // also: getItems({ ids: [...] }), getFields({ owner }), getCategories({ owner })
```

`registerCategory(owner, { name, description, tags, image }, { adopt })` is idempotent. It refuses a category people already manage (409) unless `adopt` is set, which takes the record over; the items in it stay people's. `registerField` takes `category` to scope the field to one category. An owner cannot be changed after creation.

For uninstall.js, remove in this order:

```javascript
import { unregisterItems, unregisterFields, unregisterCategories } from 'kempo-inventory/sdk';

export default async () => {
  await unregisterItems('kempo-products', { release: true }); // or omit `release` to delete them and their history
  await unregisterFields('kempo-products');
  await unregisterCategories('kempo-products');                // ones still in use are handed back to people, not deleted
};
```

To protect more than this (say, the *values* of a field you own), subscribe to the `before_*` hooks: every payload carries `actor`, the extension making the change or `''` for a person.

### Server SDK

```javascript
import { getItems, createItem, adjustStock, registerFields } from 'kempo-inventory/sdk';
```

Every function resolves to `[error, result]`, where `error` is `{ code, msg }` or `null`.

| Function | Purpose |
|---|---|
| `getItems({ q, filters, ids, owner, limit, offset })` | List and search. `filters` is `{ fieldKey: 'exact value' }`, `ids` fetches exactly those items, `owner` keeps one owner's. Returns `{ items, total, linked }` |
| `getItem(id)`, `getItemBySku(sku)` | One item |
| `getLinked(items)` | Resolves `item`-type values to `{ id, sku, name }` |
| `createItem({ sku, name, description, quantity, fields, userId }, { owner })` | Create. `owner` makes it your extension's |
| `updateItem(id, { sku, name, description, fields, userId }, { owner })` | Update; `fields` is merged, and an empty value clears a field. SKU, name and category of an owned item need its `owner` |
| `deleteItem(id, { userId, owner })` | Delete an item and its history (owned items need their `owner`) |
| `adjustStock(id, { delta, reason, note, userId })` | The way quantity changes, for anyone. Atomic; refuses to go below zero |
| `adjustStockMany(changes, { reason, note, ref, userId, owner })` | Several stock changes together: every one happens or none does. `changes` is `[{ id, delta }]`. Use it when one event touches several items, such as the materials of a recipe |
| `unregisterItems(owner, { release })` | Delete every item you own, or with `release` hand them back to people |
| `getMovements({ itemId, limit, offset })` | Stock history |
| `getFields({ category, owner })`, `getField(key, category)` | Read field definitions. `getFields()` is every field (each with its `category` key and `categoryName`); with `category` it is what an item in that category shows |
| `createField(definition)`, `updateField(key, changes)`, `deleteField(key)` | Manage user-defined fields |
| `getCategories({ includeEmpty, owner })`, `saveCategory(name, { newName, image, description, tags }, { owner })`, `deleteCategory(name, { owner })` | The categories, and managing them |
| `registerCategory(owner, { name, description, tags, image }, { adopt })`, `unregisterCategories(owner)` | Add categories owned by your extension, and remove them |
| `getSuggestions(key, { q, limit, category })` | Values already used for a text field, ranked for what has been typed |
| `registerField(owner, definition)`, `registerFields(owner, definitions)` | Add fields owned by your extension; `definition.category` scopes one to a category |
| `unregisterFields(owner)` | Remove every field your extension owns, and their values |
| `FIELD_TYPES`, `EVENTS` | The field types and the hook event names |

An item looks like `{ id, sku, name, description, category, tags, quantity, fields: { ...custom values }, owner, created, updated }`.

### Several items at once

`adjustStock` changes one item in its own transaction, so a sale that uses resin, paint and filament could take the resin and then find the paint short. `adjustStockMany` applies the whole set together:

```javascript
import { adjustStockMany } from 'kempo-inventory/sdk';

const [error, { items }] = await adjustStockMany(
  [{ id: resin.id, delta: -175 }, { id: paint.id, delta: -20 }],
  { reason: 'sale', ref: 'order-1042', owner: 'my-extension' },
);
// error.code 409 and error.msg "Insufficient stock of Paint (ml)": nothing changed
```

Changes to the same item are added together and one that nets to nothing is left out. Every item goes through the same `before_adjust` guard as `adjustStock`, and each fires `stock:adjusted` once everything is committed. `ref` is written on every stock movement (as `[order-1042]` in its note) so the change can be found, and reversed, later.

### Adding to the item page

An extension can add to the admin item page by supplying a fragment named `inventory-item-actions`, in `admin/inventory-item-actions.fragment.html` in its own package. It appears under the item form, and reads the item from `?id=` in the address. (kempo-products-inventory uses it for "Make product from this item".)

### Hooks

Declare these in your `kempo-config.json` `hooks`. Every payload also carries `actor`: the extension that made the change through the SDK, or `''` for a person using the admin.

**Guards** run before the work and can change it or refuse it. The payload holds a mutable object; edit it in place to change what gets saved, or `throw { code, msg }` to refuse, and the caller receives exactly that error. Everything is validated *after* guards run, so a guard cannot sneak in a value that would not otherwise be accepted. A guard that throws anything other than `{ code, msg }` is logged and reported to the user generically.

| Event | Payload | Edit / refuse |
|---|---|---|
| `kempo-inventory:item:before_create` | `{ draft: { sku, name, description, quantity, fields }, userId }` | edit `draft` |
| `kempo-inventory:item:before_update` | `{ item, changes: { sku?, name?, description?, fields? }, userId }` | edit `changes` |
| `kempo-inventory:item:before_delete` | `{ item, userId }` | refuse only |
| `kempo-inventory:stock:before_adjust` | `{ item, draft: { delta, reason, note }, userId }` | edit `draft` |
| `kempo-inventory:category:before_update` | `{ name, newName, changes: { description?, tags?, image? }, userId }` | refuse only |
| `kempo-inventory:category:before_delete` | `{ category, name, userId }` (`category` is `null` for one with no record) | refuse only |
| `kempo-inventory:field:before_create` | `{ draft }` | refuse only |
| `kempo-inventory:field:before_update` | `{ field, changes }` | refuse only |
| `kempo-inventory:field:before_delete` | `{ field }` | refuse only |

Ownership is checked first, so these only run for changes that would otherwise go ahead.

**Notifications** run after the change is committed; nothing they do can undo it, and an error in one is logged without affecting the others.

| Event | Payload |
|---|---|
| `kempo-inventory:item:created` | `{ item, userId }` |
| `kempo-inventory:item:updated` | `{ item, previous, userId }` |
| `kempo-inventory:item:deleted` | `{ item, userId }` |
| `kempo-inventory:stock:adjusted` | `{ item, previousQuantity, delta, reason, note, movement, userId }` |
| `kempo-inventory:category:updated` | `{ category, previous, moved, userId }` |
| `kempo-inventory:category:deleted` | `{ category, userId }` |
| `kempo-inventory:field:created` | `{ field }` |
| `kempo-inventory:field:updated` | `{ field, previous }` |
| `kempo-inventory:field:deleted` | `{ field }` |

For example, a low-stock check that reacts to every adjustment:

```javascript
// hooks/stock-adjusted.js
export default async ({ item }) => {
  const level = item.fields.reorderLevel;
  if(level !== undefined && item.quantity <= level){
    // notify someone, create a purchase order, ...
  }
};
```

Hooks run one at a time, in registration order, and are awaited, so a slow handler delays the request that triggered it.

## Permissions and groups

| Permission | Allows |
|---|---|
| `kempo-inventory:items:read` | View items, fields and movements |
| `kempo-inventory:items:create` | Add items |
| `kempo-inventory:items:update` | Edit items |
| `kempo-inventory:items:delete` | Delete items (and their history) |
| `kempo-inventory:stock:adjust` | Add or remove stock |
| `kempo-inventory:fields:manage` | Create, edit and delete custom fields |

Groups, each including everything in the one before it:

| Group | Can |
|---|---|
| `kempo-inventory:viewer` | View items, fields and movements |
| `kempo-inventory:manager` | Also create, edit and delete items and adjust stock |
| `kempo-inventory:admin` | Also set up the custom fields (`fields:manage`) |

Every group also includes `system:admin:access`, because kempo serves extension pages inside the admin panel and redirects anyone without it. That only opens the panel itself: its other sections stay locked behind their own permissions.

## API

All routes require a session holding the permission above.

| Route | Purpose |
|---|---|
| `GET /inventory/api/items?q=&filters={"key":"value"}&owner=&limit=&offset=` | List and search; `owner` keeps one extension's items. Returns `{ items, total, linked, media }` |
| `POST /inventory/api/items` | Create `{ sku, name, description?, quantity?, fields? }` |
| `GET /inventory/api/items/[id]` | Item, recent movements and linked items |
| `PATCH /inventory/api/items/[id]` | Update `{ sku?, name?, description?, fields? }` (not quantity) |
| `DELETE /inventory/api/items/[id]` | Delete |
| `POST /inventory/api/items/[id]/adjust` | `{ delta, reason?, note? }` |
| `GET /inventory/api/movements?itemId=` | Movement history |
| `GET /inventory/api/categories` | The categories: `{ categories: [{ name, key, count, fields, image, description }], uncategorised, defaultFields }`; `?includeEmpty=true` includes ones no item uses |
| `PUT /inventory/api/categories` | Create or update `{ name, newName?, image?, description? }`; only the keys sent change (needs `items:update`) |
| `DELETE /inventory/api/categories` | Delete `{ name }`; 409 while items use it (needs `items:update`) |
| `GET /inventory/api/fields` | Field definitions, each with its `category` (`''` = every item); `?category=Paint` returns what an item in that category shows |
| `POST /inventory/api/fields` | Create `{ label, type, key?, description?, required?, listed?, options?, position?, category? }`; `category` makes it apply to that category only |
| `PATCH /inventory/api/fields/[key]?category=` | Update a field (`category` identifies a category's field) |
| `DELETE /inventory/api/fields/[key]?category=` | Delete a user-defined field |
| `GET /inventory/api/fields/[key]/suggestions?q=&limit=&category=` | Values already used for a text field, most relevant first: `[{ value, uses }]`. Matches are ranked prefix first, then by use. With no `q`, the most used values |

## Notes

- Adding a column to an existing table is done in `update.js`, because kempo only creates tables that are new. Version 0.2 adds `suggest` to the field table, 0.3 adds the category table, 0.4 makes `category` a built-in column (moving values from an old custom `category` field) and 0.5 adds category descriptions and 0.11 lets photo fields force a shape and size, 0.10 adds tags to items and categories, 0.14 trims stored text, 0.13 lower-cases every stored tag, 0.12 adds the `import_max_mb` setting, 0.9 adds the `public_read` setting, 0.8 makes photos public by default (the `public_photos` setting), 0.7 adds the image ratio settings and 0.6 lets a field belong to one category (the field key index becomes unique per category).
- Kempo's installer ignores indexes declared in the schema, so `install.js` creates the unique SKU and field-key indexes itself.
- Version 0.15 adds `owner` to items and categories (existing ones stay people-managed).
- Uninstalling drops the item, field and movement tables, including your data.
- Custom values are stored in a single `jsonb` column, so adding a field never alters the schema.
- `item` links store the linked item's id. Deleting an item leaves any links to it in place, shown as "(deleted item)".

## Development

The documentation site is written in `docs-src/` and built into `docs/` (served by GitHub Pages from the `docs` folder). Edit `docs-src/`, never `docs/`, then run `npm run docs:build`; `npm run docs:dev` serves it on port 4050. Screenshots come in pairs: write `<img src="./media/name.png" ...>` in a page, and put `name-light.png` and `name-dark.png` in `docs-src/media`. The build turns the tag into both images and the site shows the one matching the visitor's theme.
