# Notes

## Core Setup
- Interactive family tree built on `family-chart`, with data stored in Supabase (Postgres + Storage + Auth)
- Two entry points: the main tree (`index.html`) and an admin review page (`admin.html`)
- Password-gated viewing (separate from editing), enforced server-side via a Postgres RPC — not just a UI prompt
- Shared edit password lets any family member submit changes; a logged-in admin account reviews/approves certain changes and can skip the password entirely

## Family Tree / Lineage
- Support for dual parentage (biological vs. adoptive) via a **Biological/Adoptive lineage toggle**, using dedicated parent fields per person rather than the generic relationship system
- Support for up to 2 biological + 2 adoptive parents per person
- Multi-relationship support when adding a person (e.g. spouse links) instead of only one relation at a time
- Picking a parent auto-suggests their existing spouse for the second parent slot
- Tree now shows the whole family at once (raised generation depth limit, and anchors the initial view on whichever ancestor has the most descendants) instead of only 1-2 people
- "Reset View" button and a "Jump to person" search dropdown, so even standalone/unconnected people are always reachable
- Mini-tree indicators show when a card has hidden relatives (parents or children) not currently displayed
- Disabled the library's auto-generated placeholder "Unknown spouse" cards for single-parent children (these were also the root cause of several "child has more than 1 parent" crashes)

## Person Details
- Avatar photo shown directly on each card
- Full name fields: first, middle, last, maiden name, and suffix (Jr., Sr., III, etc.), combined consistently everywhere a name is shown (cards, side panel, all dropdowns)
- Birthday **and** date of death, shown together on cards and in the side panel
- Gender identity field, shown on the card instead of the raw M/F used internally for layout
- Description field supports Markdown (bold, italics, lists, links), rendered and sanitized on display
- Photo gallery per person with editable captions (including photos added previously)
- Side panel (docked, not an overlay) shows all of the above; resizable by dragging its edge, with the width remembered across visits
- Add/Edit person now uses the same docked panel style as the description panel, instead of a centered popup

## Editing Workflow
- Add/update edits apply immediately (no admin review needed); only **delete** requests require admin approval
- Delete, when approved, also cleans up: reciprocal links on other people (parents/children/spouses), bio/adoptive parent references, and all of that person's photos in Storage
- Removing or replacing a photo/avatar now actually deletes the old file from Storage (previously only unlinked it from the database, leaving orphaned files)
- Images are automatically compressed on upload (targeting roughly 100-250KB per photo) to conserve storage
- Spouse relationships can now be added *and removed* from the edit form (previously removal silently did nothing)
- Admin page lists only pending (delete) requests, with Approve/Reject actions; approved/rejected history remains visible in the Supabase table editor

## Mobile
- Fixed iOS Safari auto-zoom on input focus (undersized form fields were the trigger)
- Responsive header that stacks and shrinks on small screens instead of squishing/wrapping awkwardly
- Side panels become true full-screen overlays on mobile instead of a docked sidebar squeezing the tree

## Notable Bugs Fixed Along the Way
- Reciprocal relationship links (parent ↔ child, spouse ↔ spouse) are now always kept in sync on both sides; a repair function (`repair_reciprocal_rels`) exists to fix any that get out of sync from manual database edits
- "Ghost" cards (blank cards with no data) caused by dangling references to nonexistent people — added a scrub function and root-caused it to a since-fixed bug in the relationship system
- Storage was missing a DELETE permission policy, silently blocking photo/avatar removal
- Fixed a Postgres function-overload conflict that blocked all delete requests after an earlier schema update
- Recentering the tree now correctly accounts for the side panel's width when a card is clicked or a panel is opened/closed