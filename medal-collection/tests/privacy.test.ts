import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const medal = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('Postgres policies isolate accounts and publish only explicit public fields', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, created_at timestamptz default now());
      alter table storage.objects enable row level security;
      create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
      grant usage on schema public, auth, storage to anon, authenticated;
    `);
    await db.exec(await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
    await db.exec(
      `grant all on public.profiles, public.medals to authenticated; grant select on public.profiles, public.medals to anon; grant select, insert, delete on storage.objects to authenticated; grant select on storage.objects to anon;`,
    );
    await db.query('insert into auth.users(id) values ($1), ($2)', [alice, bob]);
    await db.query(
      'insert into public.profiles(id, display_name, handle, is_public) values ($1, $2, $3, true)',
      [alice, 'Alice', 'alice-runs'],
    );
    const path = `${alice}/${medal}/photo.png`;
    const original = `${alice}/${medal}/original.png`;
    await db.query(
      "insert into public.medals(id, owner_id, race_name, race_date, distance, note, image_path, original_path, visibility) values ($1,$2,'My marathon','2025-01-01',42.195,'Private diary entry',$3,$4,'private')",
      [medal, alice, path, original],
    );
    await db.query(
      "insert into storage.objects(bucket_id, name) values ('medals',$1),('medals',$2)",
      [path, original],
    );
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [bob]);
    assert.equal((await db.query('select * from public.medals')).rows.length, 0);
    assert.equal((await db.query('select * from storage.objects')).rows.length, 0);
    assert.equal(
      (
        await db.query("update public.medals set race_name='Not mine' where id=$1 returning id", [
          medal,
        ])
      ).rows.length,
      0,
    );
    await assert.rejects(
      db.query(
        "insert into public.medals(id,owner_id,race_name,race_date,distance,image_path) values (gen_random_uuid(),$1,'Fake','2025-01-01',10,$2)",
        [alice, path],
      ),
    );
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [alice]);
    assert.equal((await db.query('select * from public.medals')).rows.length, 1);
    const privateShelf = (
      await db.query<{ public_shelf: { medals: unknown[] } }>(
        "select public.public_shelf('alice-runs')",
      )
    ).rows[0].public_shelf;
    assert.equal(privateShelf.medals.length, 0);
    await db.query("update public.medals set visibility='public' where id=$1", [medal]);
    await db.exec('reset role; set role anon');
    assert.equal((await db.query('select * from public.medals')).rows.length, 0);
    const publicShelf = (
      await db.query<{ public_shelf: { medals: Record<string, unknown>[] } }>(
        "select public.public_shelf('alice-runs')",
      )
    ).rows[0].public_shelf;
    assert.equal(publicShelf.medals.length, 1);
    assert.equal(publicShelf.medals[0].note, undefined);
    assert.equal(publicShelf.medals[0].original_path, undefined);
    assert.equal((await db.query('select * from storage.objects')).rows.length, 1);
    await db.exec('reset role; set role authenticated');
    await db.query('update public.profiles set is_public=false where id=$1', [alice]);
    await db.exec('reset role; set role anon');
    assert.equal((await db.query('select * from storage.objects')).rows.length, 0);
    const hiddenShelf = (
      await db.query<{ shelf: unknown }>("select public.public_shelf('alice-runs') as shelf")
    ).rows[0].shelf;
    assert.equal(hiddenShelf, null);
    await db.exec('reset role; set role authenticated');
    const hash = 'a'.repeat(64);
    const first = (
      await db.query<{ job: { id: string; claimed: boolean } }>(
        'select public.claim_image_job($1) as job',
        [hash],
      )
    ).rows[0].job;
    const second = (
      await db.query<{ job: { id: string; claimed: boolean } }>(
        'select public.claim_image_job($1) as job',
        [hash],
      )
    ).rows[0].job;
    assert.equal(first.claimed, true);
    assert.equal(second.claimed, false);
    assert.equal(first.id, second.id);
    for (let i = 1; i < 10; i++)
      await db.query('select public.claim_image_job($1)', [i.toString(16).padStart(64, '0')]);
    await assert.rejects(db.query('select public.claim_image_job($1)', ['f'.repeat(64)]), /hourly/);
  } finally {
    await db.close();
  }
});
