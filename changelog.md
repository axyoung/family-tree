# Changelog

## v0.1 — Initial Prototype
- Scaffolded with Vite + `family-chart`
- Sample data with biological/adoptive lineage toggle
- Custom HTML cards showing `gender_identity` instead of raw M/F
- Photo gallery via a popup modal

## v0.2 — Fix: Reciprocal Parent Links
- Fixed "child has more than 1 parent" crash: the lineage toggle only ever *removed* a child from the inactive parent's list, never *added* them to the active one

## v0.3 — Fix: Sample Data Consistency
- Fixed a second cause of the same crash: a person's parents were listed one-directionally in the sample data (parent → child link existed, but not child → parent)
- Verified with an automated headless render test before shipping

## v1.0 — Editing & Supabase Backend
- Migrated from a static `data.js` file to a live Supabase backend (Postgres + Storage + Auth)
- Add/Edit/Delete people directly from the site, gated by a shared edit password, held for admin approval
- Photo and avatar upload
- Admin review page (`admin.html`) to approve/reject submitted edits
- Seed script to migrate the original sample data into Supabase

## v1.1 — Storage Fix, UI Overhaul
- Fixed Storage upload permissions (RLS policy was missing)
- Fixed the "no relation" option being unavailable when adding a standalone person
- Site branding/title update
- Darker theme so tree connector lines are actually visible
- Avatar photo shown directly on cards
- Replaced the photo-button popup with a docked side panel (name, description, photos) opened by clicking a card

## v1.2 — Fix: Data Loss on Edit, Toolbar Contrast
- Fixed edits silently wiping unrelated fields (e.g. saving an avatar was deleting `parents_bio`/`parents_adoptive`) — edits now merge into existing data instead of overwriting it
- Normalized relationship data on load so missing fields can't crash rendering
- Darkened the toolbar to match the rest of the theme

## v1.3 — Fix: Tree Visibility & Navigation
- Fixed the tree defaulting to showing only 1 generation up/down (was the library's default limit)
- Tree now anchors on a sensible root ancestor instead of an arbitrary first record
- Fixed the lineage toggle not properly reflecting parent changes in the rendered tree

## v1.4 — Fix: Root Anchoring Heuristic
- Improved root-person selection to pick whichever ancestor has the most descendants, so switching lineage modes can't land on a near-empty branch

## v1.5 — Diagnostic Tooling
- Added a data-conflict validator that names the exact person/parents involved before the tree crashes, instead of a generic library error

## v2.0 — Instant Edits, Docked Editing, Markdown
- Add/update edits now apply immediately (no admin review); only delete requests still require approval
- Delete support added, including reciprocal cleanup on approval
- Edit/Add Person panel redesigned to match the docked side-panel style instead of a centered popup
- Description field supports Markdown, sanitized on render
- Relationship picker simplified to spouse-only (parent/child links now exclusively go through dedicated Biological/Adoptive fields, removing a whole class of duplicate-link bugs)
- Admin can skip the edit password when logged in
- Mini-tree indicators for cards with hidden relatives

## v2.1 — Fix: Hidden-Element CSS, Blank Tree
- Fixed several UI elements missing their `.hidden` CSS rule (visible when they shouldn't be)
- Fixed the tree failing to render under certain lineage states

## v2.2 — Fix: Root Cause of Recurring "More Than 1 Parent" Crashes
- Identified and disabled the library's auto-generated placeholder "Unknown spouse" cards for single-parent children — the actual source of most of the earlier parent-count crashes

## v2.3 — Fix: Method Chain Placement
- Fixed a runtime error from calling a Chart-level method on the wrong object; verified with a headless render test

## v3.0 — Discoverability & Password Validation
- "Jump to person" search, so standalone/unconnected people are always reachable
- Gallery images enlarged; captions now editable on already-saved photos
- Edit password is now verified server-side before granting edit mode, instead of only failing later on submit

## v3.1 — Spouse Editing, Resizable Panel, More Generations
- Spouse selector added to the Edit (not just Add) form
- Side panel is now resizable by dragging its edge, with the width remembered
- Clicking a card recenters the tree accounting for the panel's width
- Generation depth limit raised significantly
- Larger name heading in the side panel

## v3.2 — Unified Docked Panels
- Edit/Add Person panel and the description panel now share the exact same docked styling and position
- Closing either panel recenters the tree

## v3.3 — Fix: Recenter on Open
- Opening the edit/add panel now also recenters the tree, not just closing it

## v3.4 — Fix: Delete Constraint, Storage Cleanup
- Fixed a database constraint left over from before "delete" was a valid edit type, which was silently blocking all delete requests
- Deleting a person now also cleans up their `parents_bio`/`parents_adoptive` references on other people, and their photos in Storage

## v3.5 — Compression, Simplified Relation UI
- Increased image compression ratio to reduce storage usage further
- Removed the redundant "Spouse of" type dropdown (spouse was the only option)

## v3.6 — Fix: Storage Permissions, Ghost Cards
- Fixed Storage's missing DELETE policy (photo/avatar removal wasn't actually freeing space)
- Added a cleanup function for "ghost" references (ids pointing to people that don't actually exist in the database)

## v3.7 — Mobile Support
- Fixed iOS Safari auto-zoom on input focus
- Responsive header that stacks/shrinks on small screens
- Side panels become full-screen overlays on mobile instead of a docked sidebar

## v3.8 — Mobile Fixes, Real Spouse Removal, Name Fields
- Fixed the side panel only taking ~75% width on mobile (a CSS specificity issue — `position: fixed` wasn't marked `!important`, so the desktop rule was still winning)
- Further shrunk mobile header controls
- Spouse removal now actually works (previously only additions were supported server-side; removing a spouse in the UI silently did nothing)
- Added middle name, maiden name, suffix, and date of death fields
- All names now display consistently (first + middle + last + suffix) across cards, side panel, and every dropdown
- Selecting a parent auto-suggests their existing spouse for the second parent slot
- Fixed a console warning from form elements missing `name` attributes

## v3.9 — Alphabetical Dropdowns and Side Panel Editing
- Changed all dropdowns to be sorted into alphabetical order
- Updated the side panel to add an Edit button when in Editing mode. This will allow for editing directly from the side panel
- Fix mobile issue where can't scroll down to submit button