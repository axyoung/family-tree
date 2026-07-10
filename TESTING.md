# Family Tree — Test Checklist

Run through this after any Supabase migration or code update. Each item has
bitten us before, so they're worth re-checking, not just testing once.

## Viewing
- [ ] Load the site fresh (new incognito window) → view password prompt appears
- [ ] Wrong view password → clear error shown, still blocked
- [ ] Correct view password → tree loads, shows most of the family at once (not just 1-2 people)
- [ ] Reload the page → does NOT re-prompt for password (session cached)
- [ ] Open a new tab (same browser) → does NOT re-prompt (same session)
- [ ] Close browser fully, reopen → DOES re-prompt (session-only, not permanent)

## Navigating
- [ ] Click a person → tree re-centers on them, side panel opens
- [ ] Click "Reset View" → jumps back to a wide view, not just wherever you were
- [ ] Click "Biological" / "Adoptive" toggle → tree changes for anyone with dual parents; no console errors
- [ ] Person with lots of relatives shows a small indicator for hidden/collapsed relatives

## Side panel
- [ ] Shows avatar (if set), name, gender identity, birthday, description, photo gallery
- [ ] Description renders **markdown** (bold, italics, lists, links) correctly
- [ ] Panel is docked (pushes the tree over), not floating on top of it
- [ ] Tree is still clickable/scrollable while panel is open
- [ ] Close button (×) works

## Adding a person
- [ ] Add a standalone person with no relation → appears, findable via Reset View
- [ ] Add a person as **Biological parent 1** of someone existing → link shows immediately (no approval wait)
- [ ] Add a person as **Adoptive parent** of someone existing → same
- [ ] Add a spouse relation → shows correctly, doesn't affect parent/child toggle logic
- [ ] After adding, tree auto-refreshes without a manual page reload

## Editing a person
- [ ] Change name/birthday/description → saves, reflected immediately
- [ ] Upload an avatar → shows on card, file size is compressed (check Supabase Storage — should be under ~500KB even for a large source photo)
- [ ] Upload multiple gallery photos → all appear in side panel, scrollable
- [ ] Remove an existing photo → gone after save
- [ ] Editing one field (e.g. just avatar) does NOT wipe unrelated fields like `parents_bio`/`parents_adoptive` — check console for "DATA CONFLICT" warnings after saving anyone with dual parents
- [ ] Set/change Biological or Adoptive parent on an EXISTING person (not just at creation) → toggle reflects it correctly in both modes

## Deleting a person
- [ ] Delete request submits without a database error
- [ ] Person still appears in the tree until admin approves (not removed immediately — this one SHOULD require approval, unlike add/update)
- [ ] After admin approves in `/admin.html`: person is gone, and anyone who listed them as parent/child/spouse no longer references them (check a former sibling/parent's card — no broken link, no "DATA CONFLICT" in console)
- [ ] Delete someone who was set as a Biological or Adoptive parent of someone else → the child's parent dropdown for that slot is now empty, not pointing at a ghost ID
- [ ] Reject a delete request in admin → person remains untouched

## Password / access
- [ ] Edit mode with correct edit password → works
- [ ] Edit mode with wrong password → clear error, not silently stuck
- [ ] Logged into `/admin.html` in the same browser → Edit mode on the main site skips the password prompt entirely
- [ ] Log out of admin → edit password is required again on the main site

## Admin panel
- [ ] Only `status = 'pending'` items show (currently: delete requests only)
- [ ] Approve / Reject buttons work and remove the item from the pending list
- [ ] Supabase table editor still shows approved/rejected rows — this is intentional (history log), not a bug

## Data integrity spot-check (run anytime something looks "off")
```sql
-- Should return 0 rows. If not, paste the result — it names the exact conflict.
select id, data->'parents_bio' as bio, data->'parents_adoptive' as adoptive
from people
where jsonb_array_length(coalesce(data->'parents_bio','[]'::jsonb))
    + jsonb_array_length(coalesce(data->'parents_adoptive','[]'::jsonb)) > 2;
```

```sql
-- Should return 0 rows. If not, these are "ghost" ids referenced somewhere
-- but with no real people row — the cause of blank/black cards. Run
-- select scrub_dangling_refs(); to clean them up.
with all_refs as (
  select jsonb_array_elements_text(coalesce(rels->'children','[]'::jsonb)) as ref_id from people
  union all select jsonb_array_elements_text(coalesce(rels->'parents','[]'::jsonb)) from people
  union all select jsonb_array_elements_text(coalesce(rels->'spouses','[]'::jsonb)) from people
  union all select jsonb_array_elements_text(coalesce(data->'parents_bio','[]'::jsonb)) from people
  union all select jsonb_array_elements_text(coalesce(data->'parents_adoptive','[]'::jsonb)) from people
)
select distinct ref_id from all_refs where ref_id not in (select id from people);
```

Also worth re-running `select repair_reciprocal_rels();` after any bulk manual editing in the table editor.
