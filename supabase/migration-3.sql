-- ===========================================================================
-- MIGRATION 3 — run once. Makes add/update apply immediately (no admin
-- review), only delete still needs approval. Also lets the logged-in admin
-- skip the edit password entirely.
-- ===========================================================================

-- 6a. APPLY AN ADD/UPDATE DIRECTLY (shared by immediate-apply and legacy
--     pending rows). Only called internally by other SECURITY DEFINER
--     functions, so no anon grant needed.
-- ---------------------------------------------------------------------------
create or replace function apply_add_or_update(
  p_edit_type text,
  p_person_id text,
  p_payload jsonb,
  p_relations jsonb
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
          update people
          set rels = jsonb_set(existing_rels, array[field_name], coalesce(existing_rels->field_name,'[]'::jsonb) || to_jsonb(p_person_id::text))
          where id = rel->>'person_id';

          select rels into existing_rels from people where id = p_person_id;
          update people
          set rels = jsonb_set(existing_rels, array[reciprocal_field], coalesce(existing_rels->reciprocal_field,'[]'::jsonb) || to_jsonb((rel->>'person_id')::text))
          where id = p_person_id;
        end if;
      end if;
    end loop;
  end if;
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

  -- add/update: apply now
  perform apply_add_or_update(
    p_edit_type, p_person_id, p_payload,
    coalesce(p_relations, case when p_relation_to_id is not null
      then jsonb_build_array(jsonb_build_object('type', p_relation_type, 'person_id', p_relation_to_id))
      else '[]'::jsonb end)
  );

  -- keep a history record, already resolved
  insert into pending_edits (edit_type, person_id, payload, relations, relation_to_id, relation_type, submitted_by, status)
  values (p_edit_type, p_person_id, p_payload, p_relations, p_relation_to_id, p_relation_type, p_submitted_by, 'approved')
  returning id into v_id;

  return v_id;
end;
$$;
grant execute on function submit_pending_edit to anon, authenticated;
