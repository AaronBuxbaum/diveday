# 20260720-course-page-simplification — One course page, not a list plus a catalog

- **Status:** Accepted
- **Date:** 2026-07-20

## Context

[20260720-course-page-media](20260720-course-page-media.md) shipped course pages, but the surfaces
around them accreted. The course **list** doubled as an editor: a free-form description box, four
pricing cells, a "Save" button, a "Page" button, and a "Hide/Show" button per row. A separate
**course-page catalog** let a shop import DiveDay templates — yet every shop is already seeded with all
agency courses, pre-filled with that same template copy, so import only ever produced a duplicate or
a no-op. Photos could be pasted as URLs or uploaded. Minimum age sat in shop-editable content even
though it is an agency admission fact, exactly like the certification gate beside it. And a "What to
take next" cross-sell asked every shop to curate a teaching ladder by hand.

The list was where courses fell out of alignment, and the catalog was a second way to do a thing the
seed already did.

## Decision

- **The course page is the one place a course is edited.** The list is now a plain roster: title,
  agency, a status badge, an **Edit** button (opens the page), and an eye / eye-with-slash toggle for
  scheduling visibility (`is_active`) — the word "Hide"/"Show" replaced by the icon. Pricing moved
  onto the course page, next to the copy it prices. The description box is gone; the `description`
  column stays only as a metadata fallback.
- **No import, no template catalog.** `global_courses` / `global_course_versions` and the
  `courses.source_template_id` / `source_template_version` columns are dropped. Each course is
  pre-filled with the default page copy at creation — the default *is* the starting point. The
  `COURSE_TEMPLATES` fixture still supplies that copy at seed time; it is no longer a queryable
  catalog.
- **Photos are uploads only.** The "Hero photo link" and "Gallery links" textareas are removed. The
  editor uploads files (hero replaces, gallery appends) and shows current photos with a remove
  checkbox. `splitCourseImageUrls` still validates and caps the stored list; it just no longer takes
  pasted input on this surface. (Dive-site image URL fields are unchanged — they have no upload path
  yet.)
- **Age and cert are the agency's, hardcoded.** `minimum_age` and `minimum_certification_level` are
  no longer editable; the page reads them and states them, and a content save never writes them.
- **"What to take next" is gone.** The `related_course_ids` column, its editor picker, and the
  public cross-sell section are removed.

## Alternatives considered

- **Keep the catalog but hide it when empty** — still two code paths to a course, still a duplicate
  waiting to happen. The seed already does what import did.
- **Keep pasted image URLs alongside upload** — the request was to rely on uploading; two entry
  points for the same field is the ambiguity we were asked to remove.
- **Move `minimum_age` to its own agency-owned column** — the [media ADR](20260720-course-page-media.md)
  named this as the correct end state but gated it on diver date-of-birth. Making the existing column
  read-only is the reversible step that stops shops editing an agency fact today.
- **Drop the `description` column too** — it still backs page metadata, so it stays; only its editor
  disappears.

## Consequences

- One migration drops two tables and three `courses` columns. Existing course rows keep their seeded
  page copy, prices, age, and cert gate untouched.
- The list is a roster, not a spreadsheet; the page is the single editor. A staffer looking for
  pricing now finds it beside the copy, not in a table two clicks away.
- `is_active` (scheduling) and `is_published` (public page) remain distinct; the list toggles the
  first with an eye icon, the page toggles the second with **Hide** / **Publish page**.
  _Superseded by [20260720-course-single-visibility-state](20260720-course-single-visibility-state.md):
  `is_published` is dropped; both the list's eye icon and the page's Hide/Show button now toggle
  the one `is_active` column._
- The route surface shrinks: `/shop/<slug>/courses/catalog` is gone. The auth-exempt public course
  page and the gated editor are unchanged.
