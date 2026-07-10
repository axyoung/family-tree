-- ===========================================================================
-- MIGRATION 4 — run once. Fixes: (1) delete was blocked by an outdated
-- check constraint from before "delete" existed as a valid edit_type, and
-- (2) deleting someone now also scrubs them from parents_bio/parents_adoptive
-- on anyone who listed them there (previously only rels.* was scrubbed).
-- ===========================================================================

-- 1. Fix the constraint that was blocking every delete request
alter table pending_edits drop constraint if exists pending_edits_edit_type_check;
alter table pending_edits add constraint pending_edits_edit_type_check
  check (edit_type in ('add', 'update', 'delete'));

-- 2. Re-create approve_pending_edit so deletes also clean up
--    parents_bio / parents_adoptive references, not just rels.*
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

    -- scrub rels.* references
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

    -- scrub data.parents_bio / data.parents_adoptive references (NEW —
    -- these are separate from rels.* and were previously left dangling)
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

    rel_list := coalesce(
      e.relations,
      case when e.relation_to_id is not null
        then jsonb_build_array(jsonb_build_object('type', e.relation_type, 'person_id', e.relation_to_id))
        else '[]'::jsonb
      end
    );

    for rel in select * from jsonb_array_elements(rel_list) loop
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
          set rels = jsonb_set(existing_rels, array[field_name], coalesce(existing_rels->field_name,'[]'::jsonb) || to_jsonb(e.person_id::text))
          where id = rel->>'person_id';

          select rels into existing_rels from people where id = e.person_id;
          update people
          set rels = jsonb_set(existing_rels, array[reciprocal_field], coalesce(existing_rels->reciprocal_field,'[]'::jsonb) || to_jsonb((rel->>'person_id')::text))
          where id = e.person_id;
        end if;
      end if;
    end loop;
  end if;

  update pending_edits set status = 'approved' where id = p_edit_id;
end;
$$;
grant execute on function approve_pending_edit to authenticated;
-- ===========================================================================
