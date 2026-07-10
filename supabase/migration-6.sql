-- ===========================================================================
-- MIGRATION 6 — run once. Adds a way to verify the edit password up front
-- (before entering edit mode), rather than only failing at submit time.
-- ===========================================================================
create or replace function verify_edit_password(p_password text)
returns boolean
language plpgsql
security definer
as $$
declare
  v_hash text;
begin
  if auth.role() = 'authenticated' then
    return true; -- logged-in admin always passes
  end if;

  select edit_password_hash into v_hash from app_settings where id = 1;
  if v_hash is null then
    return false;
  end if;

  return crypt(p_password, v_hash) = v_hash;
end;
$$;
grant execute on function verify_edit_password to anon, authenticated;
-- ===========================================================================
