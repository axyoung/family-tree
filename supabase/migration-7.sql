-- ===========================================================================
-- MIGRATION 7 — run once. Lets the "relations" (spouse) system apply to
-- 'update' edits too, not just 'add', and makes the reciprocal-link logic
-- idempotent (re-submitting the same spouse twice won't duplicate it).
-- ===========================================================================
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
  end if;

  -- Apply relations (currently just spouse links) for BOTH add and update.
  -- Idempotent: skips if the link already exists, so resubmitting the same
  -- form twice doesn't create duplicate entries.
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
end;
$$;
-- ===========================================================================
