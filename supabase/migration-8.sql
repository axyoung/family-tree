-- ===========================================================================
-- MIGRATION 8 — run once. Adds actual relation REMOVAL support (previously
-- relations could only ever be added — removing a spouse in the UI silently
-- did nothing on the backend).
-- ===========================================================================
alter table pending_edits add column if not exists relations_remove jsonb;

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

  insert into pending_edits (edit_type, person_id, payload, relations, relations_remove, relation_to_id, relation_type, submitted_by, status)
  values (p_edit_type, p_person_id, p_payload, p_relations, p_relations_remove, p_relation_to_id, p_relation_type, p_submitted_by, 'approved')
  returning id into v_id;

  return v_id;
end;
$$;
grant execute on function submit_pending_edit to anon, authenticated;

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

  -- REMOVE relations (strips the link on both sides)
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
-- ===========================================================================
