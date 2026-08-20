# FU-20260820-internal-archive-vocabulary — Rename the internal archive vocabulary to match the word on screen

- **Status:** Open
- **Raised:** 2026-08-20 — the delete-vocabulary migration for ADR 20260820-every-delete-is-soft, which changed the copy but stopped at the code
- **Kind:** cleanup
- **Effort:** M
- **Touches:** `src/db/readiness.ts`, `src/db/nitrox.ts`, `src/db/schema.ts`, `src/db/waivers.ts`, `src/app/shop/[shopSlug]/divers/[personId]/actions.ts`

## What I noticed

The screen now says Delete and Restore everywhere, and `scripts/check-soft-delete.mjs` keeps it
that way. The code underneath still says archive: `archiveCertification` and `restoreCertification`
in `src/db/readiness.ts`, `archiveSpecialtyCertification` beside it, `archiveNitroxCertification` in
`src/db/nitrox.ts`, roughly forty comments and test names across `src/db`, and one column —
`waiver_templates.archived_at` — which is a second spelling of `deleted_at` that the rule explicitly
says should not exist.

Nobody reads any of it, which is exactly why the gate stops at the message bundles. It still matters
because it is *how the copy drifted in the first place*: an author writing a new button reads the
function they are calling and reaches for its word. The vocabulary came back twice on its own before
2026-08-20 and this is the surface it comes back from.

## Why it isn't already done

Outside the scope I was given, which was the rule, the copy, and the gate. It is also two changes
with very different weights sharing one name: the function and comment renames are mechanical and
safe, while `waiver_templates.archived_at` is a schema change needing a migration, a destructive-
migration acknowledgement, and an audit of the four `isNull(waiverTemplates.archivedAt)` readers in
`src/db/waivers.ts` plus the export header in `src/db/export.ts`. Bundling them hides the second one
inside the diff of the first.

## Proposed change

Two commits, in this order, or two sessions.

First, the mechanical half: rename `archiveCertification` → `deleteCertification`,
`archiveSpecialtyCertification` → `deleteSpecialtyCertification`, `archiveNitroxCertification` →
`deleteNitroxCertification`, and sweep the comments and test names in `src/db` that say archive about
a `deleted_at` write. `restoreCertification` and friends already read correctly and stay.

Second, the column: `waiver_templates.archived_at` → `deleted_at`, with a migration and its
`-- diveday:allow-destructive` line, updating the four readers in `src/db/waivers.ts`, the export
header and row in `src/db/export.ts`, and the fixtures in `src/db/seat-diver.test.ts` and
`src/db/import.test.ts` that set it.

Do **not** widen `scripts/check-soft-delete.mjs` to cover `src/` as part of this. The gate guards
what a person reads; a rule that also polices internal identifiers would refuse
`PUBLIC_REVIEW_ARCHIVE_PAGE_SIZE`, which is a genuine archive and not a delete at all.

## Prompt

```text
Rename the internal archive vocabulary left behind by ADR
docs/architecture/decisions/20260820-every-delete-is-soft.md, which renamed the user-facing copy but
deliberately stopped at the code.

Read first: docs/architecture/decisions/20260820-every-delete-is-soft.md and
scripts/check-soft-delete.mjs (which explains why the gate stops at the message bundles).

Do this in two commits. Commit one, mechanical: in src/db/readiness.ts and src/db/nitrox.ts rename
archiveCertification, archiveSpecialtyCertification and archiveNitroxCertification to
deleteCertification, deleteSpecialtyCertification and deleteNitroxCertification, update their call
sites (src/app/shop/[shopSlug]/divers/[personId]/actions.ts and the tests), and sweep the comments
and test names under src/db that say "archive" about a deleted_at write. Leave
PUBLIC_REVIEW_ARCHIVE_PAGE_SIZE and the public review archive alone — that is a genuine archive.

Commit two, the schema: rename waiver_templates.archived_at to deleted_at. Read the schema-change
skill first. This needs a migration carrying a -- diveday:allow-destructive line, and it must update
the four isNull(waiverTemplates.archivedAt) readers in src/db/waivers.ts, the archived_at export
header and row in src/db/export.ts, and the fixtures in src/db/seat-diver.test.ts and
src/db/import.test.ts.

Do not widen scripts/check-soft-delete.mjs to cover src/ — its scope is deliberate.

Done when: pnpm check is green after each commit. Delete
docs/product/follow-ups/FU-20260820-internal-archive-vocabulary.md as part of the change.
```
