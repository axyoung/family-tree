-- ===========================================================================
-- MIGRATION 2 — consolidated, correctly ordered. Run this once, top to
-- bottom, in SQL Editor if your project was set up before view-password
-- support, delete support, and multi-relation support existed.
-- Safe to re-run in full if interrupted partway.
-- ===========================================================================

-- 1. New columns
alter table pending_edits add column if not exists relations jsonb;
alter table app_settings add column if not exists view_password_hash text;

-- 2. Remove the old "anyone can read" policy — viewing now requires the
--    view password, enforced by get_people() below.
drop policy if exists "public read people" on people;

-- 3. Drop the old submit_pending_edit signature so re-creating it below
--    doesn't collide with the original (fewer-argument) version.
drop function if exists submit_pending_edit(text, text, jsonb, text, text, text, text);

-- 4. (Re)create every function with current definitions.
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

create or replace function submit_pending_edit(
  p_edit_type text,
  p_person_id text,
  p_payload jsonb,
  p_password text,
  p_relations jsonb default null,
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

  insert into pending_edits (edit_type, person_id, payload, relations, relation_to_id, relation_type, submitted_by)
  values (p_edit_type, p_person_id, p_payload, p_relations, p_relation_to_id, p_relation_type, p_submitted_by)
  returning id into v_id;

  return v_id;
end;
$$;
grant execute on function submit_pending_edit to anon, authenticated;

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

  elsif e.edit_type = 'add' then
    insert into people (id, data, rels)
    values (e.person_id, e.payload->'data', e.payload->'rels');

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

-- 5. Set your view password LAST (functions above must exist first)
select set_view_password('put-your-view-password-here');
-- ===========================================================================
