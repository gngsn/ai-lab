# Database migrations

`001`–`010` are the original SQL files, applied by hand in the Supabase SQL
editor. **The production database already has all ten applied.** Don't edit
them.

`supabase/migrations/` holds the same ten files, byte for byte, renamed to the
Supabase CLI format (`<14-digit timestamp>_<name>.sql`, `20260101000001` …
`20260101000010`, in the same order). New migrations go there from now on.

## Steps only a person should do

Nothing here has been run, and none of it should be automated, because it
touches the production database:

1. `supabase link --project-ref <ref>` (needs your Supabase login)
2. Tell the CLI the ten migrations are already applied, so `db push` doesn't
   run them again:
   `supabase migration repair --status applied 20260101000001 … 20260101000010`
3. Check with `supabase migration list` that local and remote match.
4. From then on, `supabase db push` applies new migrations.

`seed.sql` is a sample deck for a fresh database, not a migration.
