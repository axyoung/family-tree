-- ===========================================================================
-- MIGRATION 5 — run once.
-- ===========================================================================

-- 1. Storage was missing a DELETE policy, so photo/avatar removal silently
--    failed even though the app called remove() correctly.
create policy "anyone can delete family-photos"
on storage.objects for delete
to public
using (bucket_id = 'family-photos');

-- 2. Find "ghost" IDs — referenced in someone's rels/parents_bio/parents_adoptive
--    but with no actual row in `people`. Run this first to see what's there
--    before cleaning up:
--
-- with all_refs as (
--   select jsonb_array_elements_text(coalesce(rels->'children','[]'::jsonb)) as ref_id from people
--   union all select jsonb_array_elements_text(coalesce(rels->'parents','[]'::jsonb)) from people
--   union all select jsonb_array_elements_text(coalesce(rels->'spouses','[]'::jsonb)) from people
--   union all select jsonb_array_elements_text(coalesce(data->'parents_bio','[]'::jsonb)) from people
--   union all select jsonb_array_elements_text(coalesce(data->'parents_adoptive','[]'::jsonb)) from people
-- )
-- select distinct ref_id from all_refs where ref_id not in (select id from people);

-- 3. Removes any such dangling reference wherever it appears. Safe to run —
--    an ID with no `people` row can only ever be leftover cruft, never a
--    real person (all real person data lives in that row).
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

select scrub_dangling_refs();
-- ===========================================================================
