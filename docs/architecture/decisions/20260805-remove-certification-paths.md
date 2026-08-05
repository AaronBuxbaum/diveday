# 20260805-remove-certification-paths — Delete certification paths; the catalog's own order is the progression

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

[20260730-schedule-builder-and-course-paths](20260730-schedule-builder-and-course-paths.md) shipped a
second, hand-maintained artefact beside the catalog: `course_paths` / `course_path_steps`, a builder
at `/shop/<slug>/courses/paths[/<pathSlug>]`, two diver-facing pages under `/s/<slug>/courses/paths`,
a "where this fits" trail on every course page, a "ready to go deeper?" nudge after a cert-blocked
booking, and two CSVs in the shop export.

Every course already carries the fact the paths encoded. `courses.minimum_certification_level` is the
agency's own rung — Open Water opens Advanced, Advanced opens Rescue, Rescue opens Divemaster — and
it is the field admission is actually decided on. A path was a shop retyping that ladder into a
second place where it could disagree with the first, and where a course added to the catalog silently
did not appear until somebody remembered to go and add it. A shop that never opened the builder got
nothing; a shop that did got a progression that drifted.

The product call (2026-08-05) is to remove it outright rather than keep guidance nobody maintains.

## Decision

**Certification paths are deleted in full, and the staff course roster is ordered by progression
instead.**

- Dropped: the `course_paths` and `course_path_steps` tables, `src/db/course-paths.ts`, both route
  trees (`/shop/<slug>/courses/paths/**`, `/s/<slug>/courses/paths/**`), `CoursePathTrail` on the
  public course page, the post-booking "go deeper" aside, `sanitizePathSteps`/`MAX_PATH_STEPS`, the
  `course_paths.csv` / `course_path_steps.csv` export files, `e2e/course-paths.spec.ts`, the two
  visual captures, and every `path*` key in both locale bundles.
- **Progression is now read, never stored.** `pagedCourses` orders by `minimum_certification_level`
  rank (null first — a taster or an entry course), then taster-before-certification within a rank,
  then title. It is a projection of data the catalog already holds, so it cannot drift from what the
  courses require, and a newly added course lands in its right place with no second edit.
- `paths` stays in `RESERVED_COURSE_SEGMENTS`. The word is retired, not freed: a course minted at
  that slug would start capturing the 308 that every printed link and bookmark to the old builder
  still resolves through.
- Guidance still never gates. Ordering changes only what staff are *shown* first; admission stays on
  each course's own `minimum_certification_level`, at booking time (`src/lib/trip-admission.ts`) and
  at boarding time (`src/lib/readiness.ts`), exactly as before.

This **partially supersedes** [20260730-schedule-builder-and-course-paths](20260730-schedule-builder-and-course-paths.md):
its certification-paths half only. The schedule-is-the-builder half stands unchanged.

## Alternatives considered

- **Keep the tables, drop only the UI** — leaves a schema nobody writes to and an export nobody can
  explain; dead columns are read as promises by the next agent.
- **Derive paths automatically from `minimum_certification_level` into the old shape** — the same
  ladder, still rendered as a second navigable concept with its own pages to maintain and screenshot.
- **Keep the public path pages, remove the builder** — a diver-facing page whose content no one can
  edit is worse than no page.
- **Soft-deprecate: hide the routes, keep the data for a release** — nothing consumes it, and the
  export CSVs would have to keep shipping empty files or change shape twice.

## Consequences

Easy: one fewer editorial surface for a shop to maintain, one fewer place the ladder can disagree
with itself, ~1,700 lines and two tables gone, and a roster that finally reads in the order a
counter conversation happens.

Hard / given up: the shop's *editorial* voice about progression. A shop that taught Rescue straight
after Open Water, or sold a "wreck diver" bundle that is not a certification ladder at all, said so
by ordering rungs and annotating them ("most divers wait a season before this one"). Derived order
cannot express either, and the per-rung note has no home. The post-booking "go deeper" nudge after a
cert-blocked booking is gone with it — a diver refused a seat now reads only the refusal.

Data loss is real and one-way: the migration drops both tables. Shops that built paths lose them,
and the two export CSVs disappear from the bundle (a shop wanting an archive must export **before**
this deploys). This is accepted because the feature is not in the pilot cohort's hands yet.

Escape hatch: if a design partner asks for a curated bundle that is *not* a certification ladder —
"wreck diver", "photography season" — that is a **course-bundle** feature (a saleable set with one
price), not this one, and it should be built as that rather than by restoring these tables. Reviving
paths as-built would cost the two tables, the builder, and the two public pages again; the ordering
here would remain as the default a shop overrides.
