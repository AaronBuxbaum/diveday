# FU-20260815-the-homepage-spreadsheet-door-is-unpinned-and-lands-high — Pin the homepage's spreadsheet link in `e2e/`, and land it on the columns it promises

- **Status:** Open
- **Raised:** 2026-08-15 — restoring the homepage's direct door to `/switching/spreadsheet` (branch `worktree-bridge-cse`), acting on a `conversion-reviewer` pass
- **Kind:** half-done
- **Effort:** S
- **Touches:** `e2e/marketing.spec.ts`, `src/app/switching/_components/guide.tsx`, `src/app/switching/spreadsheet/page.tsx`, `src/app/page.tsx`, `src/lib/funnel.ts`

## What I noticed

The homepage's records band now carries a direct link to `/switching/spreadsheet` again, in the
"Coming in" column under the import-preview mockup, reading "Your spreadsheet, column by column →"
(`marketing.home.spreadsheetLink`, `src/app/page.tsx`). Two things about it were left undone, both
outside the paths that change owned.

**1. Nothing pins it.** `e2e/marketing.spec.ts` asserts the band's two column headings and pins the
spreadsheet guide's reachability *from the `/switching` hub* (the "the spreadsheet guide brings a
no-system shop across for free" test, which starts at `/switching`), but no test asserts a link from
`/` to `/switching/spreadsheet`. That is exactly how the door was lost on 2026-08-13: a redesign
merged it away and nothing failed. It has now been restored by hand once; a second redesign would
remove it the same silent way.

**2. It lands two to three screens above what it promises.** `/switching/spreadsheet` opens with its
hero, then the four-item "jobs a list can't hold" wedge, then the mid-page CTA, and only then phase
one — "Does your sheet have these columns?", the section the link's words point at, and the one that
carries the starter CSV. A reader who clicked "column by column" arrives at an argument about what
their spreadsheet cannot do. That argument is the page's wedge and a good one, but it is not what
they were promised, and the skeptical reader reads the gap as bait.

## Why it isn't already done

Path ownership. The session that restored the link owned `src/app/page.tsx`, `src/lib/funnel.ts`,
the two `diver.json` bundles and `docs/product/marketing.md`; `e2e/**` and
`src/app/switching/**` were explicitly another agent's in a concurrent run. Both fixes are small, and
neither is safe to race.

## Proposed change

**The assertion.** In the homepage test in `e2e/marketing.spec.ts`, assert a link whose `href` is
`/switching/spreadsheet?from=home-records-arriving` — the query string included, since the tag is
what makes the door measurable and dropping it is as silent a regression as dropping the link.

**The landing.** `MovePhase` in `src/app/switching/_components/guide.tsx` renders no `id`. Give it an
optional one, set `id="columns"` on the spreadsheet guide's columns phase, and point the homepage
link at `#columns`. Note `switchingHref` returns `${destination}?from=${source}`, so a hash has to
follow the query — either widen the helper to take one or build the string at the call site; the
registry entry `home-records-arriving` does not change either way.

**Not** proposed: rewording the link away from the columns to match the current landing. The column
table is the most persuasive thing on that page for a reader who has just looked at an import
preview, and it is the reason the door is worth having — moving the reader to it is the fix, not
promising them less.

## Prompt

```text
Read src/app/page.tsx (the portability band's "Coming in" column, the link built with
switchingHref("/switching/spreadsheet", "home-records-arriving")), the paragraphs on the records
band in docs/product/marketing.md, e2e/marketing.spec.ts (the homepage test, and the existing
"the spreadsheet guide brings a no-system shop across for free" test), and
src/app/switching/_components/guide.tsx (MovePhase) with src/app/switching/spreadsheet/page.tsx.

Two things to finish about the homepage's direct link to /switching/spreadsheet:

1. Pin it. The homepage test asserts nothing about that link, which is how the same door was
   silently deleted in a 2026-08-13 redesign. Assert the href including its ?from=
   home-records-arriving tag — an untagged door is a door we cannot measure, which was the whole
   reason it came back.
2. Land it where its words point. The link says "Your spreadsheet, column by column" but arrives at
   the top of a page whose columns section is the third block down. Give MovePhase an optional id,
   set one on the spreadsheet guide's columns phase, and append the hash to the link. switchingHref
   builds `${destination}?from=${source}`, so the hash goes after the query — widen the helper or
   build it at the call site, and keep the funnel tag either way.

Do NOT reword the link to promise less than the column table: that table is why the door exists.

Done means: pnpm check green, pnpm e2e e2e/marketing.spec.ts --reporter=line green, and a click
from / landing on the columns section with the tag intact. Delete
docs/product/follow-ups/FU-20260815-the-homepage-spreadsheet-door-is-unpinned-and-lands-high.md as
part of the change.
```
