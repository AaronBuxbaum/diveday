# 20260816-course-template-updates — Review source revisions before updating a shop course

- **Status:** Accepted
- **Date:** 2026-08-16
- **Supersedes:** the “no `courses.source_template_*` columns” sentence in
  [20260720-course-page-simplification](20260720-course-page-simplification.md). It does not
  restore a queryable course catalog or a second import surface.

## Context

`src/db/course-templates.ts` is still the code-owned source of DiveDay's starter course copy. The
2026-07 simplification correctly removed the duplicate global course catalog: shops should not
have two ways to create the same course, and a template must never rewrite a public page silently.
That decision left no honest way to receive a later correction, however. A shop that had edited its
copy had to compare the source by hand or start over, and a future template revision had no
provenance on the course row.

## Decision

- Keep templates in code. There is no global course table and no new catalog/import route.
- A seeded course records its source slug, source version, and a JSON snapshot of the
  template-owned fields at the time it began following that source. Courses without a valid
  snapshot are not guessed into a merge.
- The staff course editor shows a version diff when a newer source exists. **Apply updates, keep my
  edits** performs a three-way merge: fields still equal to the last snapshot take the new source
  value, while changed shop prose stays as-is.
- **Replace template-managed copy** is a separate, explicitly confirmed action. It replaces the
  listed template-owned fields, including shop edits to those fields.
- Prices, nitrox compatibility, visibility, the public slug, hero/gallery media, and all trip data
  are shop-owned and are never changed by either update action. Agency admission facts are
  template-owned and update with the source revision.
- The course picker on the schedule builder groups its active options by the course's agency,
  while preserving the existing progression order within each agency.

## Alternatives considered

- **Silently refresh every shop row when code changes** — would overwrite published shop copy and
  make a source correction an unreviewed customer-facing change.
- **Restore the global course catalog and import route** — recreates the duplicate creation path
  removed by the simplification ADR and adds a second catalog to maintain.
- **Compare only the current row with the latest template** — cannot tell a shop edit from an old
  source value, so it cannot safely preserve local changes.
- **Overwrite media with the latest bundled art** — a shop's uploaded photos and captions are
  customer-facing work, not source-controlled starter copy.

## Consequences

Template revisions are visible and actionable without being automatic. The snapshot adds a small
amount of JSON to each linked course and makes old unlinked rows deliberately conservative: they
need an explicit future relinking workflow rather than a title-based guess. A later source change
that should be offered per field instead of as a keep-or-replace choice would extend the diff UI and
merge mode, not reintroduce a global catalog.
