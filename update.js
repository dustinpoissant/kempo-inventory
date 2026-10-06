import { sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { getSetting, setSetting } from 'kempo/server/sdk.js';

/*
  kempo creates tables that are new in an update but never alters ones that already exist, so a
  column added to an existing table has to be added here. Every statement is idempotent, so running
  this on a database that already has the change is harmless.
*/
export default async () => {
  // 0.15: items and categories can be owned by an extension ('' = managed by people, as before)
  await db.execute(sql`ALTER TABLE "kempoInventoryItem" ADD COLUMN IF NOT EXISTS "owner" text NOT NULL DEFAULT ''`);
  await db.execute(sql`ALTER TABLE "kempoInventoryCategory" ADD COLUMN IF NOT EXISTS "owner" text NOT NULL DEFAULT ''`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "kempoInventoryItemOwnerIdx" ON "kempoInventoryItem" ("owner")`);

  // 0.14: text is stored without leading or trailing spaces. Trim what is already stored: custom field values that are text, plus names and descriptions.
  const edge = "'^[[:space:]' || chr(160) || ']+|[[:space:]' || chr(160) || ']+$'";
  await db.execute(sql.raw(`
    UPDATE "kempoInventoryItem" SET "data" = (
      SELECT COALESCE(jsonb_object_agg(e.key, CASE WHEN jsonb_typeof(e.value) = 'string' THEN to_jsonb(regexp_replace(e.value #>> '{}', ${edge}, '', 'g')) ELSE e.value END), '{}'::jsonb)
      FROM jsonb_each("data") e)
    WHERE EXISTS (SELECT 1 FROM jsonb_each("data") e WHERE jsonb_typeof(e.value) = 'string' AND (e.value #>> '{}') ~ (${edge}))`));
  for(const column of ['name', 'description']){
    await db.execute(sql.raw(`UPDATE "kempoInventoryItem" SET "${column}" = regexp_replace("${column}", ${edge}, '', 'g') WHERE "${column}" ~ (${edge})`));
  }

  // 0.13: tags are lower case. Lower-case every tag already stored, tidy its spacing, drop duplicates the change creates, keep the order.
  for(const table of ['kempoInventoryItem', 'kempoInventoryCategory']){
    await db.execute(sql.raw(`
      UPDATE "${table}" SET "tags" = COALESCE((
        SELECT jsonb_agg(t ORDER BY first) FROM (
          SELECT lower(regexp_replace(btrim(x), '[[:space:]]+', ' ', 'g')) AS t, min(ord) AS first
          FROM jsonb_array_elements_text("tags") WITH ORDINALITY AS a(x, ord)
          WHERE btrim(x) <> '' GROUP BY 1
        ) s
      ), '[]'::jsonb)
      WHERE "tags"::text <> lower("tags"::text)`));
  }

  // 0.12: the import size limit. Added only when missing.
  const [, importMax] = await getSetting('kempo-inventory', 'import_max_mb', null);
  if(importMax === null) await setSetting('kempo-inventory', 'import_max_mb', 250, 'number', false, 'The largest import file (a .json or .zip made by Export) the admin Import accepts, in MB.');

  // 0.11: photo fields can force a shape and a maximum size
  await db.execute(sql`ALTER TABLE "kempoInventoryField" ADD COLUMN IF NOT EXISTS "imageRatio" text NOT NULL DEFAULT ''`);
  await db.execute(sql`ALTER TABLE "kempoInventoryField" ADD COLUMN IF NOT EXISTS "imageMax" integer NOT NULL DEFAULT 0`);

  // 0.10: tags on items and categories
  await db.execute(sql`ALTER TABLE "kempoInventoryItem" ADD COLUMN IF NOT EXISTS "tags" jsonb NOT NULL DEFAULT '[]'::jsonb`);
  await db.execute(sql`ALTER TABLE "kempoInventoryCategory" ADD COLUMN IF NOT EXISTS "tags" jsonb NOT NULL DEFAULT '[]'::jsonb`);

  // 0.9: optional public (signed-out) browsing. Added only when missing, and off.
  const [, publicRead] = await getSetting('kempo-inventory', 'public_read', null);
  if(publicRead === null) await setSetting('kempo-inventory', 'public_read', false, 'boolean', false, 'Let anyone, signed in or not, browse the inventory (items, categories, photos). They never see stock counts. Off by default: reading otherwise needs the items:read permission.');

  // 0.8: photos are public by default, so read-only users can see them. Added only when missing.
  const [, publicSetting] = await getSetting('kempo-inventory', 'public_photos', null);
  if(publicSetting === null) await setSetting('kempo-inventory', 'public_photos', true, 'boolean', false, 'Photos uploaded to kempo-files are viewable by anyone with the link, so every person who can read the inventory sees them (kempo-files otherwise needs each of them to have its files:download permission). Turn off to keep photos behind that permission.');
  const [, makePublic] = await getSetting('kempo-inventory', 'public_photos', true);
  if(makePublic !== false && makePublic !== 'false'){
    /* Photos already uploaded: every kempo-files file an item or category uses, and its thumbnails. */
    const [{ files, thumbs }] = [...await db.execute(sql`SELECT to_regclass('"kempoFile"') AS files, to_regclass('"kempoThumbnail"') AS thumbs`)];
    if(files){
      await db.execute(sql`
        UPDATE "kempoFile" SET "public" = true
        WHERE "public" = false AND "id" IN (
          SELECT substr(v, 7) FROM "kempoInventoryItem" i,
            LATERAL jsonb_each(i."data") e(k, val),
            LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(val) = 'array' THEN val ELSE '[]'::jsonb END) v
          WHERE v LIKE 'files:%'
          UNION SELECT substr("image", 7) FROM "kempoInventoryCategory" WHERE "image" LIKE 'files:%')`);
      if(thumbs){
        await db.execute(sql`
          UPDATE "kempoFile" SET "public" = true
          WHERE "public" = false AND "id" IN (
            SELECT t."fileId" FROM "kempoThumbnail" t JOIN "kempoFile" f ON f."id" = t."sourceFileId"
            WHERE f."public" = true AND t."fileId" IS NOT NULL)`);
      }
    }
  }

  // 0.7: image aspect ratio settings. Added only when missing, so a value someone chose is never overwritten.
  for(const [name, description] of [
    ['category_image_ratio', 'The aspect ratio category images are shown at, as width:height (4:3, 1:1, 16:9). Images are cropped to fit, never stretched.'],
    ['item_image_ratio', 'The aspect ratio item photos are shown at, as width:height (4:3, 1:1, 16:9). Images are cropped to fit, never stretched.'],
  ]){
    const [, existing] = await getSetting('kempo-inventory', name, null);
    if(existing === null) await setSetting('kempo-inventory', name, '4:3', 'string', false, description);
  }

  // 0.2: text fields can suggest values already used on other items
  await db.execute(sql`ALTER TABLE "kempoInventoryField" ADD COLUMN IF NOT EXISTS "suggest" boolean NOT NULL DEFAULT false`);

  // 0.3: categories can have an image
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "kempoInventoryCategory" (
      "id" text PRIMARY KEY,
      "key" text NOT NULL,
      "name" text NOT NULL,
      "image" text,
      "created" timestamp NOT NULL,
      "updated" timestamp NOT NULL
    )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "kempoInventoryCategoryKeyIdx" ON "kempoInventoryCategory" ("key")`);

  // 0.4: category is a built-in property of every item, not a custom field
  await db.execute(sql`ALTER TABLE "kempoInventoryItem" ADD COLUMN IF NOT EXISTS "category" text NOT NULL DEFAULT ''`);
  const oldField = [...await db.execute(sql`SELECT 1 FROM "kempoInventoryField" WHERE "key" = 'category' LIMIT 1`)];
  if(oldField.length){
    /* Move each item's value across (tidied the way new ones are), then drop the old field. */
    await db.execute(sql`
      UPDATE "kempoInventoryItem"
      SET "category" = regexp_replace(btrim(coalesce("data"->>'category', '')), '[[:space:]]+', ' ', 'g'),
          "data" = "data" - 'category'
      WHERE "data"->>'category' IS NOT NULL`);
    await db.execute(sql`DELETE FROM "kempoInventoryField" WHERE "key" = 'category'`);
  }

  // 0.5: categories can have a description
  await db.execute(sql`ALTER TABLE "kempoInventoryCategory" ADD COLUMN IF NOT EXISTS "description" text NOT NULL DEFAULT ''`);

  // 0.6: fields can belong to one category ('' = every item), so a key is unique per category
  await db.execute(sql`ALTER TABLE "kempoInventoryField" ADD COLUMN IF NOT EXISTS "category" text NOT NULL DEFAULT ''`);
  await db.execute(sql`DROP INDEX IF EXISTS "kempoInventoryFieldKeyIdx"`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "kempoInventoryFieldKeyIdx" ON "kempoInventoryField" ("category", "key")`);
};
