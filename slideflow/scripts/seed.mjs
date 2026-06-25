// Runs supabase/migrations/seed.sql against DATABASE_URL, if present.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const seedPath = join(here, '..', 'supabase', 'migrations', 'seed.sql');
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/slideflow';

async function main() {
  let sql;
  try {
    sql = await readFile(seedPath, 'utf8');
  } catch {
    console.log('No seed.sql yet — nothing to seed.');
    return;
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(sql);
    console.log('Seed applied.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
