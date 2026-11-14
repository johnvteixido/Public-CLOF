# Supabase migrations

This folder holds SQL migrations that define the database schema for the app.

## Apply a migration

1. Open your Supabase project → SQL Editor.
2. Paste the contents of the highest-numbered file in `migrations/` that you
   haven't run yet, then click **Run**.
3. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to `.env.local` (and Vercel).

The Supabase service-role key bypasses RLS. The Express server is the only
caller, so RLS is disabled for simplicity. Never expose the service-role key
to the browser.

## Migrations

- `0001_init.sql` — Phase 1: `profile`, `leads`, `sends` tables.
- `0002_gmail.sql` — Phase 3: Gmail OAuth refresh-token storage. (TBD)
