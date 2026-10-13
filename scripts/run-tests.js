import { spawnSync } from 'child_process';

/*
  The two test tiers, then the command to run in each. `node --test` runs every file in its own
  process, so there is deliberately no preload here: only the files that use the database pay for it.

    unit         `KEMPO_DB=pglite`: kempo's database module gives an in-process, in-memory Postgres
                 (PGlite) holding the tables in drizzle.config.js, so nothing external is needed and a
                 database suite can never skip for want of one.
    integration  a real Postgres at DATABASE_URL, for the suites that boot a second server process.
                 Here an unreachable database fails the run instead of skipping, so it cannot look
                 green without having run.

  `npm test` is the unit tier. `npm run test:integration` runs the whole suite on a real database. CI
  runs both.

  Usage: node scripts/run-tests.js <unit|integration> <command> [arguments]
*/

const [tier, command, ...args] = process.argv.slice(2);

if(!['unit', 'integration'].includes(tier) || !command){
  console.error('Usage: node scripts/run-tests.js <unit|integration> <command> [arguments]');
  process.exit(2);
}

const env = { ...process.env };

if(tier === 'unit'){
  env.KEMPO_DB = 'pglite';
  delete env.KEMPO_TEST_TIER;
} else {
  delete env.KEMPO_DB;
  env.KEMPO_TEST_TIER = 'integration';
  if(!env.DATABASE_URL){
    console.error('The integration tier needs DATABASE_URL pointing at a throwaway Postgres (named *_test) with the schema applied (npx drizzle-kit push).');
    process.exit(2);
  }
}

const result = spawnSync(command, args, { stdio: 'inherit', env, shell: true });

process.exit(result.status ?? 1);
