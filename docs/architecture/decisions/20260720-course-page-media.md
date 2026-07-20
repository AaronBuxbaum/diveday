# 20260720-course-page-media — Course pages are typed sections, published per shop

- **Status:** Accepted
- **Date:** 2026-07-20

## Context

A course was a pricing row: title, agency, a one-line blurb, two prices, and a cert gate. Shops
sell courses from a real page — hero photography, a day-by-day plan, what the fee includes, an
FAQ, and a way to book. Competitors ship this; we could not depict any of it.

Two questions had to be settled together. How structured is the content — a page builder, or named
fields? And where do the photos live, given that 20260719-card-photo-only deliberately removed
free-form image URLs from the certification forms?

## Decision

- **Typed sections, not a block builder.** `courses` gains named columns and `jsonb` arrays for the
  page (`summary`, `overview`, `schedule_days`, `includes`, `excludes`, `faqs`, `image_urls`, the
  spec chips). Shapes and their textarea parsers live in `src/lib/courses.ts`. Repeatable sections
  are edited as blank-line-separated blocks in a `<textarea>` — the same server-rendered shape
  `dive_sites.landmarks` already uses, and no client-side reordering UI.
- **`is_published` is separate from `is_active`.** `is_active` gates the session picker;
  `is_published` gates the public page. A shop teaches courses it does not market, and drafts a page
  for a course it already schedules.
  _Superseded by [20260720-course-single-visibility-state](20260720-course-single-visibility-state.md):
  `is_published` is dropped and `is_active` is now the only visibility state, gating both surfaces._
- **Scuba publishes versioned templates; shops import copies.** `global_courses` /
  `global_course_versions` mirror the dive-site catalog exactly. An import is a one-way copy: a later
  template version never rewrites a shop's edits, and — importantly — never relaxes the cert gate
  under a course a shop is already teaching.
  _Superseded by [20260720-course-page-simplification](20260720-course-page-simplification.md): the
  import step and the `global_courses` tables were removed. Every course is now pre-filled with the
  default page copy at creation — the default is the starting point, no catalog to import from._
- **Course media reuses the storage seam with its own key prefix.** `storeCourseImage` sits beside
  `storeCardImage` in `src/lib/storage/`, sharing validation (≤5 MB, JPG/PNG/WebP/HEIC) and writing
  under `courses/` rather than `cards/`.
- **Course pages may carry image URLs; cards still may not.** 20260719-card-photo-only stands for
  certification evidence. Marketing photos are not evidence: a template ships bundled art as a
  root-relative path, and a shop that already hosts its photography should not have to re-upload it.
  `splitCourseImageUrls` therefore accepts a `/path` or an HTTP(S) link and rejects everything else.

## Alternatives considered

- **A free-form block builder** (ordered rich-text / image / accordion blocks) — maximum flexibility,
  but it needs client-side drag-and-drop, a block schema to version, and a renderer for arbitrary
  nesting. Typed sections cover the reference shops' pages and let the schedule and FAQ be reused
  in briefings later; revisit if shops ask for layouts we cannot name.
- **One markdown body plus spec chips** — cheapest, but the day plan and FAQ stop being data, so
  nothing else in the app can ever read them.
- **A separate `course_pages` table** — a strict 1:1 with `courses` bought only tidiness, at the
  cost of a join on every read and a second row to keep alive.
- **Reusing `dive_sites`' `splitMediaUrls`** — it requires absolute URLs, which would have forced
  bundled template art to invent an origin.

## Known gaps this surfaced (not fixed here)

A `dive-domain-expert` review of the shipped template copy found two modelling gaps worth naming
rather than quietly working around:

- **No `adventure_diver` rung.** PADI's own Rescue Diver floor is Adventure Diver with the
  Underwater Navigation Adventure Dive; `CERTIFICATION_LEVEL_LABELS` (`src/lib/readiness.ts`) jumps
  Open Water → Advanced Open Water, so the gate is forced one level up. The template copy now says
  plainly that this is *our* setting, not the agency's, so a diver holding a valid Adventure Diver
  card is invited to talk to the shop instead of being told they are ineligible. Adding the rung is
  a readiness-ladder change with its own migration.
- **Minimum age is published but unenforced.** It is as much an agency admission gate as the cert
  level, yet it lives in shop-editable content and nothing checks it — there is no date of birth in
  the schema at all. The editor now says so in as many words. Moving `minimum_age` to a
  template-owned column beside `minimum_certification_level`, and checking it at booking, needs
  diver date-of-birth first.

## Consequences

- A shop can publish a credible course page on day one from the default page copy every course
  ships with, and every field it edits is a field the rest of the app can read later (session
  briefings, confirmations). (The import step this originally described was later removed — see
  [20260720-course-page-simplification](20260720-course-page-simplification.md).)
- The public route surface grows: `/shop/<slug>/courses/<course>` is auth-exempt while the staff
  catalog above it is not. The exemption matches exactly one segment and refuses reserved segments
  (`RESERVED_COURSE_SEGMENTS`), so a course can never be slugged into shadowing a staff page.
- Publishing is gated on `isCoursePublishable` — a subhead plus a schedule or prose — because an
  empty page reads as a broken shop rather than as a draft.
  _Superseded by [20260720-course-single-visibility-state](20260720-course-single-visibility-state.md):
  there is no publish gate any more — a course renders whenever it is not hidden._
- Two upload namespaces now share one seam; a provider swap still touches one file.
