// Applies supabase/migrations/*.sql in filename order to DATABASE_URL.
// Backend-neutral: same SQL runs against the Docker Postgres or a Supabase project.
// Tracks applied files in a _migrations table; safe to re-run (idempotent).

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'supabase', 'migrations');
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/slideflow';

async function listMigrations() {
  try {
    const files = await readdir(migrationsDir);
    return files.filter((f) => f.endsWith('.sql') && f !== 'seed.sql').sort();
  } catch {
    return [];
  }
}

async function main() {
  const files = await listMigrations();
  if (files.length === 0) {
    console.log('No migrations found yet — nothing to apply.');
    return;
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      'create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    const { rows } = await client.query('select name from _migrations');
    const applied = new Set(rows.map((r) => r.name));

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`= skip ${file}`);
        continue;
      }
      const sql = await readFile(join(migrationsDir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into _migrations(name) values ($1)', [file]);
        await client.query('commit');
        console.log(`+ applied ${file}`);
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Migration failed: ${file}\n${err.message}`);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
