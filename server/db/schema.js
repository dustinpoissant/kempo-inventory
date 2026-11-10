import { pgTable, text, timestamp, integer, numeric, boolean, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';

/*
  A quantity has four decimal places at most. Whole numbers unless the decimal_quantity setting allows fractions.
*/
const quantityColumn = name => numeric(name, { precision: 14, scale: 4, mode: 'number' });

/*
  An item has only the core columns. Everything else lives in `data`, keyed by the `key` of a
  kempoInventoryField row, so fields can be added and removed without touching the schema.
*/
export const kempoInventoryItem = pgTable('kempoInventoryItem', {
  id: text('id').primaryKey(),
  sku: text('sku').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  category: text('category').notNull().default(''), // built in and optional; '' means uncategorised
  quantity: quantityColumn('quantity').notNull().default(0),
  unit: text('unit').notNull().default(''), // built in and optional: what the quantity counts (oz, g); '' uses the category's unit
  tags: jsonb('tags').notNull().default([]), // built in: short lower-case labels search finds
  data: jsonb('data').notNull().default({}),
  owner: text('owner').notNull().default(''), // '' for items people manage, or the extension that created it; see ownership.js
  created: timestamp('created').notNull(),
  updated: timestamp('updated').notNull(),
}, table => [uniqueIndex('kempoInventoryItemSkuIdx').on(table.sku), index('kempoInventoryItemOwnerIdx').on(table.owner)]);

/*
  `owner` is '' for fields a user created in the admin, or the name of the extension that
  registered it. Only the owner can delete a field or change what it holds.

  `category` scopes a field: '' is the default scope, shown on every item, and a category key makes
  it appear only on items in that category. A key is unique within its scope, and a category cannot
  reuse a key the default scope has, because both would be stored under the same name on its items.
*/
export const kempoInventoryField = pgTable('kempoInventoryField', {
  id: text('id').primaryKey(),
  key: text('key').notNull(),
  label: text('label').notNull(),
  type: text('type').notNull(),
  description: text('description').notNull().default(''),
  required: boolean('required').notNull().default(false),
  listed: boolean('listed').notNull().default(true),
  suggest: boolean('suggest').notNull().default(false), // text fields: offer values already used on other items
  options: jsonb('options').notNull().default([]),
  owner: text('owner').notNull().default(''),
  position: integer('position').notNull().default(0),
  imageRatio: text('imageRatio').notNull().default(''), // media fields: the shape photos are cropped to, e.g. '1 / 1'; '' = any shape
  imageMax: integer('imageMax').notNull().default(0),   // media fields: photos are kept within this many pixels on a side; 0 = no limit
  category: text('category').notNull().default(''), // '' = every item; otherwise the key of the one category it belongs to
  created: timestamp('created').notNull(),
}, table => [uniqueIndex('kempoInventoryFieldKeyIdx').on(table.category, table.key)]);

export const kempoInventoryMovement = pgTable('kempoInventoryMovement', {
  id: text('id').primaryKey(),
  itemId: text('itemId').notNull(),
  delta: quantityColumn('delta').notNull(),
  quantityAfter: quantityColumn('quantityAfter').notNull(),
  reason: text('reason').notNull().default('adjustment'),
  note: text('note').notNull().default(''),
  userId: text('userId').notNull().default(''),
  created: timestamp('created').notNull(),
}, table => [index('kempoInventoryMovementItemIdx').on(table.itemId)]);

/*
  Extra information about a category (currently its image), matched to items by `key`: the
  category name lower-cased with its spacing tidied, so "Paint" and "paint" are one category. Items
  do not point at these; they keep their plain text field. A category with no record still exists,
  it just has no image.
*/
export const kempoInventoryCategory = pgTable('kempoInventoryCategory', {
  id: text('id').primaryKey(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  image: text('image'), // a stored media id, as held by a media field
  unit: text('unit').notNull().default(''), // what items in the category count in, unless an item has its own
  description: text('description').notNull().default(''),
  tags: jsonb('tags').notNull().default([]),
  owner: text('owner').notNull().default(''), // '' for categories people manage, or the extension that registered it
  created: timestamp('created').notNull(),
  updated: timestamp('updated').notNull(),
}, table => [uniqueIndex('kempoInventoryCategoryKeyIdx').on(table.key)]);
