/*
  Local/CI test-database setup only: this extension has no migrations of its own in production. Its
  tables are created the real way, via createTablesFromSchema at install time. This file stands up a
  throwaway database holding kempo's core tables and this extension's own, and the unit tier's
  in-memory database is built from the same list.

  A plain object, which is all drizzle-kit's `defineConfig` returns, so this file does not need
  drizzle-kit to be resolvable from this repo.

  No dotenv on purpose: DATABASE_URL must be a real environment variable.
*/
export default {
  schema: [
    './server/db/schema.js',
    './node_modules/kempo/server/db/schema.js',
  ],
  out: './server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
};
