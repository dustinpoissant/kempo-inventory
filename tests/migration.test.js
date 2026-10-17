import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { permission, group, groupPermission } from 'kempo/server/db/schema.js';
import update from '../update.js';

/*
  The stock to quantity rename: a site that gave the old permission to a group still has it, under its
  new name, after the update. Running the update again changes nothing.
*/
const url = process.env.DATABASE_URL ?? '';
const unitTier = process.env.KEMPO_DB === 'pglite';
const reachable = (unitTier || /_test$/.test(url.split('?')[0])) && await db.execute(sql`select 1`).then(() => true).catch(() => false);

const OLD = 'kempo-inventory:stock:adjust';
const NEW = 'kempo-inventory:quantity:adjust';
const GROUP = 'migration-test-group';

const grants = async () => (await db.execute(sql`select "permissionName" from "groupPermission" where "groupName" = ${GROUP}`)).map(row => row.permissionName);

after(() => unitTier ? db.$client.close() : db.$client.end());

describe('the permission rename', { skip: reachable ? false : 'no throwaway database' }, () => {
  before(async () => {
    const now = new Date();
    await db.insert(permission).values({ name: OLD, description: 'Add or remove stock', owner: 'kempo-inventory', createdAt: now }).onConflictDoNothing();
    await db.insert(group).values({ name: GROUP, description: 'test', owner: 'user', createdAt: now }).onConflictDoNothing();
    await db.insert(groupPermission).values({ id: 'migration-test-grant', groupName: GROUP, permissionName: OLD, createdAt: now }).onConflictDoNothing();
  });

  after(async () => {
    if(!reachable) return;
    await db.execute(sql`delete from "groupPermission" where "groupName" = ${GROUP}`);
    await db.execute(sql`delete from "group" where "name" = ${GROUP}`);
    await db.execute(sql`delete from "permission" where "name" in (${OLD}, ${NEW})`);
  });

  test('a group that had the old permission has the new one, and the old one is gone', async () => {
    await update();
    assert.deepEqual(await grants(), [NEW]);
    const names = (await db.execute(sql`select "name" from "permission" where "name" in (${OLD}, ${NEW})`)).map(row => row.name);
    assert.deepEqual(names, [NEW]);
    await update();
    assert.deepEqual(await grants(), [NEW]);
  });
});
