-- ===========================================================================
-- MIGRATION 9 — run once. Adds a trivial, no-auth-required RPC purely so a
-- scheduled ping (e.g. Vercel Cron) can touch the database weekly and
-- prevent Supabase's free-tier auto-pause after a period of inactivity.
-- Does not read or expose any real data.
-- ===========================================================================
create or replace function keepalive_ping()
returns text
language sql
as $$
  select 'ok';
$$;
grant execute on function keepalive_ping to anon;
-- ===========================================================================
