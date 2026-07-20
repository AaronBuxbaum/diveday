# 20260720-course-single-visibility-state — One visibility switch for a course, not two

- **Status:** Accepted
- **Date:** 2026-07-20
- **Supersedes:** the `is_published` / `is_active` split from
  [20260720-course-page-media](20260720-course-page-media.md), reaffirmed in
  [20260720-course-page-simplification](20260720-course-page-simplification.md)

## Context

The media ADR deliberately kept `is_published` (the public page) separate from `is_active` (the
session picker): a shop teaches a course it never markets, or drafts a page before publishing.
In practice this produced two near-identical toggles — Hide/Show on the roster and Hide/Publish
page on the editor — and two badges ("Hidden" next to "Draft"/"Live") that read as two different
concerns a staff member has to reconcile, for a distinction no shop asked for. The plain question
a course row answers is "can a diver see this," and it only needs one answer.

## Decision

- Drop `courses.is_published`. `is_active` is now the only visibility state: it gates both the
  session picker and the public course page (`courses/page.tsx`'s eye toggle;
  `courses/[slug]/page.tsx`'s `notFound()` check).
- The roster keeps its eye icon as the one control, now showing the *current* state rather than
  the action (open eye = visible, closed eye = hidden). The course editor gets an equivalent
  Hide/Show button for convenience; both write the same column through `setCourseVisibility`.
- `isCoursePublishable` is removed along with `setCoursePublished` and `listPublishedCourses`. A
  course with no page content still renders — an incomplete page is an in-progress course, not a
  state gated behind a completeness check no other course property enforces.

## Alternatives considered

- **Keep both, collapse the display to one badge** (whichever state is "worse") — still two
  columns in the schema and two things to keep in sync in staff members' heads; no simpler to
  reason about than actually having one.
- **Keep `is_published` but default it to `is_active` and drop the second control** — leaves dead
  schema and a column that can never diverge from the one it mirrors; simpler to remove it.

## Consequences

- One migration drops `courses.is_published`. A course that was taught but never explicitly
  published now renders from `is_active` alone; every seeded course already ships active, so this
  changes no visible seeded state.
- `isCoursePublishable`, `setCoursePublished`, and `listPublishedCourses` are gone; nothing else
  in the app referenced them beyond the removed UI.
- Revisit if a shop asks to teach a course privately (a closed group) while keeping its marketing
  page dark — that is exactly the "taught but not marketed" case this record gives up, and would
  need a new, narrower flag rather than reviving this one.
