# FU-20260820-dive-site-template-legacybaseline-still-reachable — Confirm dive-site `legacyBaseline` is still reachable, or retire it like its courses.ts twin

- **Status:** Open
- **Raised:** 2026-08-20 — auditing the repo for legacy/migration-only code (no PR; direct session work removing the analogous pattern from `src/db/courses.ts`)
- **Kind:** question
- **Effort:** S
- **Touches:** `src/db/dive-sites.ts`, `src/app/shop/[shopSlug]/dive-sites/[id]/page.tsx`, `src/i18n/locales/en-US/staff/diveSites.json`, `src/i18n/locales/es-ES/staff/diveSites.json`

## What I noticed

`getDiveSiteTemplateUpdate` (`src/db/dive-sites.ts:731-786`) returns `legacyBaseline: baseline === null`,
where `baseline` comes from looking up a `globalDiveSiteVersions` row matching the shop's
`site.sourceTemplateVersion` (lines 757-767, 775-777). The UI (`src/app/shop/[shopSlug]/dive-sites/[id]/page.tsx:350-352`,
`diveSites.json`'s `templateUpdates.legacyDescription`) tells staff: "This site started from an
older template without a saved field baseline."

This is the same shape as a pattern I just removed from `src/db/courses.ts`
(`courseTemplateUpdateFromCourse`'s `legacyTemplate` fallback and `legacyBaseline` field, now
`baselineUnavailable`): a flag named for a historical "before we tracked this" scenario. In the
courses.ts case I confirmed every writer of `sourceTemplateSlug` always pairs it with
`sourceTemplateSnapshot`, so `baseline` could never actually be null in reachable code — the
"legacy" framing was already dead, just not yet noticed.

I did **not** do the equivalent proof for dive-sites.ts. I checked the two writers I found
quickly — `pullDiveSiteTemplateUpdates` (~line 871, sets `sourceTemplateVersion: latest.version`
from a real queried row) and the template-update undo path (~line 920, restores a previously-real
value) — and neither looked like it could produce an orphaned version number. But I did not check
the "adopt a template" / create-site-from-catalog path (the writer around `src/db/dive-sites.ts:996`,
`sourceTemplateVersion: row.version.version`) closely enough to be sure, and I did not check
whether `globalDiveSiteVersions` rows are ever pruned or could be missing for any other reason.

## Why it isn't already done

I was mid-way through a scoped legacy-removal task (medical questionnaire, courses.ts, recap
helpers, a stale comment) and the user asked me to file a follow-up rather than keep pulling this
thread live. This one needs the same kind of tracing-every-writer proof I did for courses.ts before
touching product-facing copy or a field name on a safety-adjacent-but-not-safety-critical surface
(it's just a merge-preview UI, not a gate), so it's a distinct, boundable piece of work rather than
a two-line fix.

## Proposed change

1. Grep every writer of `dive_sites.source_template_version` (`sourceTemplateVersion` in
   `src/db/dive-sites.ts`, including the create-from-catalog path around line 996) and confirm each
   one always sets it alongside — or derived from — a real `globalDiveSiteVersions` row for that
   exact version number. Also check whether anything ever deletes rows from
   `globalDiveSiteVersions` (grep the whole tree; I'd expect none, since the doc comment at
   `dive-sites.ts:727-729` says "historical catalog rows are immutable").
2. If `baseline` can never be null in reachable code (matching the courses.ts finding): delete the
   `legacyBaseline` field and the `baseline === null` computation's role in gating UI text, rename
   or drop the `legacyDescription` copy key in both `en-US` and `es-ES` `staff/diveSites.json`
   (check whether it's byte-identical to a non-legacy sibling key the way courses.ts's
   `legacyKeepEditsDescription` was — if so, just delete it and always use the sibling), and update
   `src/app/shop/[shopSlug]/dive-sites/[id]/page.tsx:350-352` accordingly.
3. If there **is** a genuine reachable path to a null baseline (e.g., the catalog path doesn't
   guarantee a matching version row, or rows can be pruned): rename `legacyBaseline` to something
   accurate like `baselineUnavailable` (matching the courses.ts rename) and reword the copy away
   from "started from an older template" framing, since that's no longer the real cause — same
   move I made for courses.ts's `legacyDescription`.
4. Run `pnpm test src/db/dive-sites.test.ts` and any test file covering the edit page's template-update
   panel, plus `pnpm check:copy` / `pnpm check:locale` if i18n keys change.

Do **not** touch `certification_card` in `src/db/schema.ts` (~line 4811) as part of this — it's a
separate, already-documented deliberate tradeoff (Postgres can't cheaply drop enum values), not a
question.

## Prompt

```text
Read src/db/courses.ts's git history around the removal of `legacyTemplate`/`legacyBaseline`
(courseTemplateUpdateFromCourse) for the pattern this mirrors, then read
src/db/dive-sites.ts's getDiveSiteTemplateUpdate (~line 731) and every writer of
dive_sites.source_template_version, including the create-from-catalog path near line 996.

Determine: can `baseline` (the globalDiveSiteVersions lookup at ~line 757-767) ever actually be
null for a real row today, or is `legacyBaseline: baseline === null` dead code the same way
courses.ts's `legacyBaseline` was?

If it's dead: delete the field/branching the way courses.ts's baselineUnavailable rename did,
update src/app/shop/[shopSlug]/dive-sites/[id]/page.tsx and both staff/diveSites.json locale files
(en-US and es-ES) in the same change, and check whether legacyDescription's sibling
non-legacy key is now identical text (delete the duplicate if so, as happened with
legacyKeepEditsDescription in courses.json).

If it's genuinely reachable: rename legacyBaseline -> baselineUnavailable and reword the copy to
not claim "older template" as the cause.

Either way, run pnpm test src/db/dive-sites.test.ts, pnpm check:copy, pnpm check:locale, and
pnpm check before calling it done. Delete
docs/product/follow-ups/FU-20260820-dive-site-template-legacybaseline-still-reachable.md as part
of the change.
```
