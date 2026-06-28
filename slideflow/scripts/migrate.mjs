// Applies supabase/migrations/*.sql in filename order to DATABASE_URL.
// Backend-neutral: same SQL runs against the Docker Postgres or a Supabase project.
// Also applies supabase/dev-migrations/*.sql UNLESS BACKEND=supabase (dev-only objects
// such as dev_login must never reach a cloud project).
// Tracks applied files in a _migrations table; safe to re-run (idempotent).

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'supabase', 'migrations');
const devMigrationsDir = join(here, '..', 'supabase', 'dev-migrations');
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/slideflow';
const backend = process.env.BACKEND ?? 'local';

async function listSql(dir, prefix) {
  try {
    const files = await readdir(dir);
    return files
      .filter((f) => f.endsWith('.sql') && f !== 'seed.sql')
      .sort()
      .map((name) => ({ name: `${prefix}${name}`, dir, file: name }));
  } catch {
    return [];
  }
}

async function applyPending(client, migrations) {
  const { rows } = await client.query('select name from _migrations');
  const applied = new Set(rows.map((r) => r.name));

  for (const { name, dir, file } of migrations) {
    if (applied.has(name)) {
      console.log(`= skip ${name}`);
      continue;
    }
    const sql = await readFile(join(dir, file), 'utf8');
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into _migrations(name) values ($1)', [name]);
      await client.query('commit');
      console.log(`+ applied ${name}`);
    } catch (err) {
      await client.query('rollback');
      throw new Error(`Migration failed: ${name}\n${err.message}`);
    }
  }
}

async function main() {
  const migrations = [...(await listSql(migrationsDir, ''))];
  if (backend !== 'supabase') {
    migrations.push(...(await listSql(devMigrationsDir, 'dev/')));
  }
  if (migrations.length === 0) {
    console.log('No migrations found yet — nothing to apply.');
    return;
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      'create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    await applyPending(client, migrations);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
