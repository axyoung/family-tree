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
  edit_type text not null check (edit_type in ('add', 'update', 'delete')),
  person_id text not null,       -- id of the person being added/updated/deleted
  payload jsonb not null default '{}'::jsonb, -- proposed { data, rels }; {} for deletes
  -- Multiple relationships a new person connects through, e.g. a child of
  -- BOTH a biological and adoptive parent at once:
  -- [{"type":"child","person_id":"mom_bio"},{"type":"child","person_id":"mom_adoptive"}]
  relations jsonb,
  relations_remove jsonb, -- relations to unlink (e.g. removing a spouse)
  -- legacy single-relation columns, kept for backward compatibility with
  -- any pending rows created before multi-relation support existed
  relation_to_id text,
  relation_type text,
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
  view_password_hash text,
  constraint singleton check (id = 1)
);
insert into app_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
alter table people enable row level security;
alter table pending_edits enable row level security;
alter table app_settings enable row level security;

-- NOTE: there is deliberately NO public/anon select policy on `people`.
-- Viewing the tree requires the view password, enforced by the get_people()
-- RPC below (SECURITY DEFINER bypasses RLS only inside that function, after
-- checking the password). This is what actually makes viewing
-- password-protected — a client can't just query the table directly.

-- Only you, logged in via Supabase Auth, can directly modify people or
-- read/manage pending edits. Everyone else must go through the RPCs below.
create policy "admin manage people" on people
  for all using (auth.role() = 'authenticated');

create policy "admin manage pending" on pending_edits
  for all using (auth.role() = 'authenticated');

-- Nobody can read app_settings directly — only the RPC functions (which run
-- as the table owner via SECURITY DEFINER) can see the password hashes.
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
-- 5d. VERIFY THE EDIT PASSWORD without submitting an edit (lets the UI
--     refuse to even enter "edit mode" on a wrong password, instead of only
--     failing later when something is actually submitted)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 5b. SET / CHANGE THE VIEW PASSWORD  (run this yourself once, as admin)
-- ---------------------------------------------------------------------------
create or replace function set_view_password(p_new_password text)
returns void
language plpgsql
security definer
as $$
begin
  update app_settings
  set view_password_hash = crypt(p_new_password, gen_salt('bf'))
  where id = 1;
end;
$$;
grant execute on function set_view_password to authenticated;

-- ---------------------------------------------------------------------------
-- 5c. FETCH THE TREE  (called by anyone with the view password)
-- ---------------------------------------------------------------------------
create or replace function get_people(p_password text)
returns setof people
language plpgsql
security definer
as $$
declare
  v_hash text;
begin
  select view_password_hash into v_hash from app_settings where id = 1;
  if v_hash is null then
    raise exception 'View password has not been set up yet. Ask the site admin to run set_view_password().';
  end if;
  if crypt(p_password, v_hash) <> v_hash then
    raise exception 'Incorrect password';
  end if;
  return query select * from people;
end;
$$;
grant execute on function get_people to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. SUBMIT A PENDING EDIT  (called by anyone with the shared password)
-- ---------------------------------------------------------------------------
-- Drop first: if this function's parameter list ever changed (e.g. adding
-- p_relations later), Postgres treats the old signature as a DIFFERENT
-- function and CREATE OR REPLACE alone won't remove it, causing a
-- "function name is not unique" error next time this is called.
drop function if exists submit_pending_edit(text, text, jsonb, text, text, text, text);
-- ---------------------------------------------------------------------------
-- 6a. APPLY AN ADD/UPDATE DIRECTLY (shared by immediate-apply and legacy
--     pending rows). Only called internally by other SECURITY DEFINER
--     functions, so no anon grant needed.
-- ---------------------------------------------------------------------------
create or replace function apply_add_or_update(
  p_edit_type text,
  p_person_id text,
  p_payload jsonb,
  p_relations jsonb,
  p_relations_remove jsonb default '[]'::jsonb
) returns void
language plpgsql
security definer
as $$
declare
  existing_rels jsonb;
  field_name text;
  reciprocal_field text;
  rel jsonb;
begin
  if p_edit_type = 'update' then
    update people
    set data = p_payload->'data', rels = p_payload->'rels', updated_at = now()
    where id = p_person_id;

    if not found then
      insert into people (id, data, rels) values (p_person_id, p_payload->'data', p_payload->'rels');
    end if;

  elsif p_edit_type = 'add' then
    insert into people (id, data, rels)
    values (p_person_id, p_payload->'data', p_payload->'rels');
  end if;

  -- ADD relations (idempotent — skips if already linked)
  for rel in select * from jsonb_array_elements(coalesce(p_relations, '[]'::jsonb)) loop
    field_name := case rel->>'type'
      when 'child' then 'children' when 'parent' then 'parents' when 'spouse' then 'spouses' else null
    end;
    reciprocal_field := case rel->>'type'
      when 'child' then 'parents' when 'parent' then 'children' when 'spouse' then 'spouses' else null
    end;

    if field_name is not null and rel->>'person_id' is not null then
      select rels into existing_rels from people where id = rel->>'person_id';
      if existing_rels is not null then
        if not (coalesce(existing_rels->field_name, '[]'::jsonb) ? p_person_id) then
          update people
          set rels = jsonb_set(existing_rels, array[field_name], coalesce(existing_rels->field_name,'[]'::jsonb) || to_jsonb(p_person_id::text))
          where id = rel->>'person_id';
        end if;

        select rels into existing_rels from people where id = p_person_id;
        if not (coalesce(existing_rels->reciprocal_field, '[]'::jsonb) ? (rel->>'person_id')) then
          update people
          set rels = jsonb_set(existing_rels, array[reciprocal_field], coalesce(existing_rels->reciprocal_field,'[]'::jsonb) || to_jsonb((rel->>'person_id')::text))
          where id = p_person_id;
        end if;
      end if;
    end if;
  end loop;

  -- REMOVE relations (strips the link on both sides — e.g. removing a spouse)
  for rel in select * from jsonb_array_elements(coalesce(p_relations_remove, '[]'::jsonb)) loop
    field_name := case rel->>'type'
      when 'child' then 'children' when 'parent' then 'parents' when 'spouse' then 'spouses' else null
    end;
    reciprocal_field := case rel->>'type'
      when 'child' then 'parents' when 'parent' then 'children' when 'spouse' then 'spouses' else null
    end;

    if field_name is not null and rel->>'person_id' is not null then
      select rels into existing_rels from people where id = rel->>'person_id';
      if existing_rels is not null then
        update people set rels = jsonb_set(
          existing_rels, array[field_name],
          (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(coalesce(existing_rels->field_name,'[]'::jsonb)) x where x <> p_person_id)
        ) where id = rel->>'person_id';
      end if;

      select rels into existing_rels from people where id = p_person_id;
      if existing_rels is not null then
        update people set rels = jsonb_set(
          existing_rels, array[reciprocal_field],
          (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(coalesce(existing_rels->reciprocal_field,'[]'::jsonb)) x where x <> (rel->>'person_id'))
        ) where id = p_person_id;
      end if;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6b. SUBMIT AN EDIT
--     - add/update: applied IMMEDIATELY (no admin review), password-gated
--       unless the caller is the logged-in admin.
--     - delete: still goes to pending_edits for admin approval.
-- ---------------------------------------------------------------------------
drop function if exists submit_pending_edit(text, text, jsonb, text, text, text, text);
drop function if exists submit_pending_edit(text, text, jsonb, text, jsonb, text, text, text);
create or replace function submit_pending_edit(
  p_edit_type text,
  p_person_id text,
  p_payload jsonb,
  p_password text default null,
  p_relations jsonb default null,
  p_relations_remove jsonb default null,
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
  v_is_admin boolean;
begin
  v_is_admin := auth.role() = 'authenticated';

  if not v_is_admin then
    select edit_password_hash into v_hash from app_settings where id = 1;
    if v_hash is null then
      raise exception 'Edit password has not been set up yet. Ask the site admin to run set_edit_password().';
    end if;
    if p_password is null or crypt(p_password, v_hash) <> v_hash then
      raise exception 'Incorrect edit password';
    end if;
  end if;

  if p_edit_type = 'delete' then
    insert into pending_edits (edit_type, person_id, payload, relations, relation_to_id, relation_type, submitted_by)
    values (p_edit_type, p_person_id, p_payload, p_relations, p_relation_to_id, p_relation_type, p_submitted_by)
    returning id into v_id;
    return v_id;
  end if;

  perform apply_add_or_update(
    p_edit_type, p_person_id, p_payload,
    coalesce(p_relations, case when p_relation_to_id is not null
      then jsonb_build_array(jsonb_build_object('type', p_relation_type, 'person_id', p_relation_to_id))
      else '[]'::jsonb end),
    coalesce(p_relations_remove, '[]'::jsonb)
  );

  -- keep a history record, already resolved
  insert into pending_edits (edit_type, person_id, payload, relations, relations_remove, relation_to_id, relation_type, submitted_by, status)
  values (p_edit_type, p_person_id, p_payload, p_relations, p_relations_remove, p_relation_to_id, p_relation_type, p_submitted_by, 'approved')
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
  reciprocal_field text;
  rel jsonb;
  rel_list jsonb;
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
      insert into people (id, data, rels) values (e.person_id, e.payload->'data', e.payload->'rels');
    end if;

  elsif e.edit_type = 'delete' then
    delete from people where id = e.person_id;

    -- scrub any dangling references to the deleted person from everyone else
    update people set rels = jsonb_set(
      rels, '{children}',
      (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(coalesce(rels->'children','[]'::jsonb)) x where x <> e.person_id)
    ) where coalesce(rels->'children','[]'::jsonb) ? e.person_id;

    update people set rels = jsonb_set(
      rels, '{parents}',
      (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(coalesce(rels->'parents','[]'::jsonb)) x where x <> e.person_id)
    ) where coalesce(rels->'parents','[]'::jsonb) ? e.person_id;

    update people set rels = jsonb_set(
      rels, '{spouses}',
      (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(coalesce(rels->'spouses','[]'::jsonb)) x where x <> e.person_id)
    ) where coalesce(rels->'spouses','[]'::jsonb) ? e.person_id;

    -- also scrub data.parents_bio / data.parents_adoptive references
    update people set data = jsonb_set(
      data, '{parents_bio}',
      (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(coalesce(data->'parents_bio','[]'::jsonb)) x where x <> e.person_id)
    ) where coalesce(data->'parents_bio','[]'::jsonb) ? e.person_id;

    update people set data = jsonb_set(
      data, '{parents_adoptive}',
      (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(coalesce(data->'parents_adoptive','[]'::jsonb)) x where x <> e.person_id)
    ) where coalesce(data->'parents_adoptive','[]'::jsonb) ? e.person_id;

  elsif e.edit_type = 'add' then
    insert into people (id, data, rels)
    values (e.person_id, e.payload->'data', e.payload->'rels');

    -- Prefer the new multi-relation array; fall back to the legacy single
    -- relation columns for any pending rows created before this existed.
    rel_list := coalesce(
      e.relations,
      case when e.relation_to_id is not null
        then jsonb_build_array(jsonb_build_object('type', e.relation_type, 'person_id', e.relation_to_id))
        else '[]'::jsonb
      end
    );

    for rel in select * from jsonb_array_elements(rel_list) loop
      field_name := case rel->>'type'
        when 'child' then 'children'
        when 'parent' then 'parents'
        when 'spouse' then 'spouses'
        else null
      end;
      reciprocal_field := case rel->>'type'
        when 'child' then 'parents'
        when 'parent' then 'children'
        when 'spouse' then 'spouses'
        else null
      end;

      if field_name is not null and rel->>'person_id' is not null then
        select rels into existing_rels from people where id = rel->>'person_id';
        if existing_rels is not null then
          update people
          set rels = jsonb_set(
            existing_rels, array[field_name],
            (coalesce(existing_rels->field_name, '[]'::jsonb) || to_jsonb(e.person_id::text))
          )
          where id = rel->>'person_id';

          select rels into existing_rels from people where id = e.person_id;
          update people
          set rels = jsonb_set(
            existing_rels, array[reciprocal_field],
            (coalesce(existing_rels->reciprocal_field, '[]'::jsonb) || to_jsonb((rel->>'person_id')::text))
          )
          where id = e.person_id;
        end if;
      end if;
    end loop;
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

create policy "anyone can delete family-photos"
on storage.objects for delete
to public
using (bucket_id = 'family-photos');

-- Note: uploads/deletes aren't gated by the edit password at the storage
-- layer — only submitting a pending edit is. This is an intentional MVP
-- trade-off (see project notes) since a stray uploaded/deleted file with
-- nothing pointing to it doesn't accomplish much on its own.

-- ---------------------------------------------------------------------------
-- 9. REPAIR EXISTING ONE-SIDED RELATIONSHIPS
-- ---------------------------------------------------------------------------
-- Fixes any person already in the table whose relationship only exists in
-- one direction (e.g. a parent lists a child, but that child doesn't list
-- the parent back) — the exact bug that caused "child has more than 1
-- parent" crashes. Safe to re-run any time.
create or replace function repair_reciprocal_rels()
returns void
language plpgsql
security definer
as $$
declare
  p record;
  other_id text;
  other_rels jsonb;
begin
  for p in select id, rels from people loop
    for other_id in select jsonb_array_elements_text(coalesce(p.rels->'children', '[]'::jsonb)) loop
      select rels into other_rels from people where id = other_id;
      if other_rels is not null and not (coalesce(other_rels->'parents','[]'::jsonb) ? p.id) then
        update people set rels = jsonb_set(rels, '{parents}', coalesce(rels->'parents','[]'::jsonb) || to_jsonb(p.id))
        where id = other_id;
      end if;
    end loop;

    for other_id in select jsonb_array_elements_text(coalesce(p.rels->'parents', '[]'::jsonb)) loop
      select rels into other_rels from people where id = other_id;
      if other_rels is not null and not (coalesce(other_rels->'children','[]'::jsonb) ? p.id) then
        update people set rels = jsonb_set(rels, '{children}', coalesce(rels->'children','[]'::jsonb) || to_jsonb(p.id))
        where id = other_id;
      end if;
    end loop;

    for other_id in select jsonb_array_elements_text(coalesce(p.rels->'spouses', '[]'::jsonb)) loop
      select rels into other_rels from people where id = other_id;
      if other_rels is not null and not (coalesce(other_rels->'spouses','[]'::jsonb) ? p.id) then
        update people set rels = jsonb_set(rels, '{spouses}', coalesce(rels->'spouses','[]'::jsonb) || to_jsonb(p.id))
        where id = other_id;
      end if;
    end loop;
  end loop;
end;
$$;
grant execute on function repair_reciprocal_rels to authenticated;

-- ---------------------------------------------------------------------------
-- 10. SCRUB DANGLING REFERENCES
-- ---------------------------------------------------------------------------
-- Removes any reference (in rels.* or parents_bio/parents_adoptive) to an id
-- that has no actual row in `people`. Such an id can only ever be leftover
-- cruft from a bad edit — a real person's data always lives in that row, so
-- if the row doesn't exist, the reference is a "ghost" that should be
-- scrubbed. This is what causes blank/black cards with no info in the tree.
create or replace function scrub_dangling_refs()
returns void
language plpgsql
security definer
as $$
declare
  ghost_id text;
begin
  for ghost_id in
    with all_refs as (
      select jsonb_array_elements_text(coalesce(rels->'children','[]'::jsonb)) as ref_id from people
      union all select jsonb_array_elements_text(coalesce(rels->'parents','[]'::jsonb)) from people
      union all select jsonb_array_elements_text(coalesce(rels->'spouses','[]'::jsonb)) from people
      union all select jsonb_array_elements_text(coalesce(data->'parents_bio','[]'::jsonb)) from people
      union all select jsonb_array_elements_text(coalesce(data->'parents_adoptive','[]'::jsonb)) from people
    )
    select distinct ref_id from all_refs where ref_id not in (select id from people)
  loop
    update people set rels = jsonb_set(rels, '{children}',
      (select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements_text(coalesce(rels->'children','[]'::jsonb)) x where x <> ghost_id)
    ) where coalesce(rels->'children','[]'::jsonb) ? ghost_id;

    update people set rels = jsonb_set(rels, '{parents}',
      (select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements_text(coalesce(rels->'parents','[]'::jsonb)) x where x <> ghost_id)
    ) where coalesce(rels->'parents','[]'::jsonb) ? ghost_id;

    update people set rels = jsonb_set(rels, '{spouses}',
      (select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements_text(coalesce(rels->'spouses','[]'::jsonb)) x where x <> ghost_id)
    ) where coalesce(rels->'spouses','[]'::jsonb) ? ghost_id;

    update people set data = jsonb_set(data, '{parents_bio}',
      (select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements_text(coalesce(data->'parents_bio','[]'::jsonb)) x where x <> ghost_id)
    ) where coalesce(data->'parents_bio','[]'::jsonb) ? ghost_id;

    update people set data = jsonb_set(data, '{parents_adoptive}',
      (select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements_text(coalesce(data->'parents_adoptive','[]'::jsonb)) x where x <> ghost_id)
    ) where coalesce(data->'parents_adoptive','[]'::jsonb) ? ghost_id;
  end loop;
end;
$$;
grant execute on function scrub_dangling_refs to authenticated;

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
