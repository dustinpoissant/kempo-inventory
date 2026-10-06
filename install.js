import { sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';

/*
  kempo's installer builds CREATE TABLE from the Drizzle columns only; indexes and unique
  constraints declared in server/db/schema.js are not carried across. The unique SKU and field-key
  indexes are correctness guarantees, so they are created here, matching the schema.
*/
const INDEXES = [
  sql`CREATE UNIQUE INDEX IF NOT EXISTS "kempoInventoryItemSkuIdx" ON "kempoInventoryItem" ("sku")`,
  sql`CREATE UNIQUE INDEX IF NOT EXISTS "kempoInventoryFieldKeyIdx" ON "kempoInventoryField" ("category", "key")`,
  sql`CREATE UNIQUE INDEX IF NOT EXISTS "kempoInventoryCategoryKeyIdx" ON "kempoInventoryCategory" ("key")`,
  sql`CREATE INDEX IF NOT EXISTS "kempoInventoryMovementItemIdx" ON "kempoInventoryMovement" ("itemId")`,
  sql`CREATE INDEX IF NOT EXISTS "kempoInventoryItemOwnerIdx" ON "kempoInventoryItem" ("owner")`,
];

export default async () => {
  for(const statement of INDEXES) await db.execute(statement);
};
