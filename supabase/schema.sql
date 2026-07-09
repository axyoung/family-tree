-- ===========================================================================
-- FAMILY TREE — SUPABASE SCHEMA
-- ===========================================================================
-- Run this whole file once in your Supabase project's SQL Editor
-- (Dashboard → SQL Editor → New query → paste this → Run).
-- ===========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. LIVE, PUBLIC DATA
-- ---------------------------------------------------------------------------
-- This is what the website reads on every visit. Same shape as the old
-- data.js: { id, data: {...}, rels: {...} }
create table people (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  rels jsonb not null default '{"spouses":[],"children":[],"parents":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. PENDING EDITS — awaiting your approval
-- ---------------------------------------------------------------------------
create table pending_edits (
  id uuid primary key default gen_random_uuid(),
  edit_type text not null check (edit_type in ('add', 'update')),
  person_id text not null,       -- id of the person being added/updated
  payload jsonb not null,        -- proposed { data, rels }
  -- for 'add' edits: how the new person connects to someone who already exists
  relation_to_id text,           -- existing person's id (null for 'update' edits)
  relation_type text,            -- 'child' | 'parent' | 'spouse' (null for 'update')
  submitted_by text,             -- optional free-text name the submitter typed in
  submitted_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','approved','rejected'))
);

-- ---------------------------------------------------------------------------
-- 3. SHARED EDIT PASSWORD (hashed, never readable from the client)
-- ---------------------------------------------------------------------------
create table app_settings (
  id int primary key default 1,
  edit_password_hash text,
  constraint singleton check (id = 1)
);
insert into app_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
alter table people enable row level security;
alter table pending_edits enable row level security;
alter table app_settings enable row level security;

-- Anyone (including anonymous visitors) can read the live tree
create policy "public read people" on people
  for select using (true);

-- Only you, logged in via Supabase Auth, can directly modify people or
-- read/manage pending edits. Everyone else must go through the RPCs below.
create policy "admin manage people" on people
  for all using (auth.role() = 'authenticated');

create policy "admin manage pending" on pending_edits
  for all using (auth.role() = 'authenticated');

-- Nobody can read app_settings directly — only the RPC functions (which run
-- as the table owner via SECURITY DEFINER) can see the password hash.
-- (No select policy is created, so RLS blocks all direct client reads.)

-- ---------------------------------------------------------------------------
-- 5. SET / CHANGE THE SHARED EDIT PASSWORD  (run this yourself once, as admin)
-- ---------------------------------------------------------------------------
create or replace function set_edit_password(p_new_password text)
returns void
language plpgsql
security definer
as $$
begin
  update app_settings
  set edit_password_hash = crypt(p_new_password, gen_salt('bf'))
  where id = 1;
end;
$$;
grant execute on function set_edit_password to authenticated;

-- ---------------------------------------------------------------------------
-- 6. SUBMIT A PENDING EDIT  (called by anyone with the shared password)
-- ---------------------------------------------------------------------------
create or replace function submit_pending_edit(
  p_edit_type text,
  p_person_id text,
  p_payload jsonb,
  p_password text,
  p_relation_to_id text default null,
  p_relation_type text default null,
  p_submitted_by text default null
) returns uuid
language plpgsql
security definer
as $$
declare
  v_hash text;
  v_id uuid;
begin
  select edit_password_hash into v_hash from app_settings where id = 1;

  if v_hash is null then
    raise exception 'Edit password has not been set up yet. Ask the site admin to run set_edit_password().';
  end if;

  if crypt(p_password, v_hash) <> v_hash then
    raise exception 'Incorrect edit password';
  end if;

  insert into pending_edits (edit_type, person_id, payload, relation_to_id, relation_type, submitted_by)
  values (p_edit_type, p_person_id, p_payload, p_relation_to_id, p_relation_type, p_submitted_by)
  returning id into v_id;

  return v_id;
end;
$$;
grant execute on function submit_pending_edit to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. APPROVE A PENDING EDIT  (called by you, logged in as admin)
-- ---------------------------------------------------------------------------
-- Applies the edit to the live `people` table, and — for 'add' edits — patches
-- the reciprocal relationship on the linked existing person, all in one
-- transaction so the tree never ends up in a half-updated state.
create or replace function approve_pending_edit(p_edit_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  e record;
  existing_rels jsonb;
  field_name text;
begin
  select * into e from pending_edits where id = p_edit_id and status = 'pending';
  if not found then
    raise exception 'Pending edit not found or already resolved';
  end if;

  if e.edit_type = 'update' then
    update people
    set data = e.payload->'data',
        rels = e.payload->'rels',
        updated_at = now()
    where id = e.person_id;

    if not found then
      -- shouldn't normally happen, but handle gracefully
      insert into people (id, data, rels) values (e.person_id, e.payload->'data', e.payload->'rels');
    end if;

  elsif e.edit_type = 'add' then
    insert into people (id, data, rels)
    values (e.person_id, e.payload->'data', e.payload->'rels');

    if e.relation_to_id is not null then
      field_name := case e.relation_type
        when 'child' then 'children'
        when 'parent' then 'parents'
        when 'spouse' then 'spouses'
        else null
      end;

      if field_name is not null then
        select rels into existing_rels from people where id = e.relation_to_id;
        update people
        set rels = jsonb_set(
          existing_rels,
          array[field_name],
          (coalesce(existing_rels->field_name, '[]'::jsonb) || to_jsonb(e.person_id::text))
        )
        where id = e.relation_to_id;
      end if;
    end if;
  end if;

  update pending_edits set status = 'approved' where id = p_edit_id;
end;
$$;
grant execute on function approve_pending_edit to authenticated;

create or replace function reject_pending_edit(p_edit_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update pending_edits set status = 'rejected' where id = p_edit_id and status = 'pending';
end;
$$;
grant execute on function reject_pending_edit to authenticated;

-- ---------------------------------------------------------------------------
-- 8. STORAGE POLICIES — allow photo uploads to the "family-photos" bucket
-- ---------------------------------------------------------------------------
-- IMPORTANT: create the bucket first (Storage → New bucket → name it exactly
-- "family-photos" → Public bucket ON), THEN run this section. "Public bucket"
-- only makes objects readable by anyone with the URL — it does NOT allow
-- uploads. These policies are what actually let the website's edit form
-- upload files; without them every upload fails with a row-level-security
-- error even though the bucket is "public".
create policy "anyone can upload to family-photos"
on storage.objects for insert
to public
with check (bucket_id = 'family-photos');

create policy "anyone can view family-photos"
on storage.objects for select
to public
using (bucket_id = 'family-photos');

-- Note: uploads aren't gated by the edit password at the storage layer —
-- only submitting a pending edit is. This is an intentional MVP trade-off
-- (see project notes) since a stray uploaded file with nothing pointing to
-- it doesn't accomplish much on its own.

-- ===========================================================================
-- NEXT STEPS (do these in the Supabase dashboard, not this SQL file):
--
-- 1. Storage → New bucket → name it "family-photos" → toggle "Public bucket" ON.
--    (Public read is fine — it's just photos. Uploads are still gated by the
--    edit password check the frontend performs before offering the upload UI.)
--
-- 2. Authentication → Users → Add user → create YOUR OWN email + password.
--    This is the only real login account — it's just for you, to see and
--    approve pending edits.
--
-- 3. Run this once in the SQL editor (with your real password) to set the
--    shared edit password relatives will use:
--       select set_edit_password('your-shared-password-here');
--    (You must be logged in as the admin user you created in step 2 for
--    this to work, since set_edit_password requires authenticated role —
--    easiest way: Dashboard → SQL Editor runs as a service role by default
--    and will work directly there.)
-- ===========================================================================
