# FU-20260815-the-other-switching-doors-are-still-untagged — Send `/product` and `/about`'s switching links through `switchingHref` too

- **Status:** Open
- **Raised:** 2026-08-15 — restoring the homepage's direct door to `/switching/spreadsheet` (branch `worktree-bridge-cse`)
- **Kind:** cleanup
- **Effort:** S
- **Touches:** `src/app/product/page.tsx`, `src/app/about/page.tsx`, `src/lib/funnel.ts`, `docs/product/marketing.md`

## What I noticed

The homepage's two switching links now build their hrefs through `switchingHref()`
(`src/lib/funnel.ts`), so a reader arriving at `/switching` or `/switching/spreadsheet` from the
records band carries `?from=home-records` or `?from=home-records-arriving` on the page view.

The other marketing pages still link there with bare paths:

- `src/app/product/page.tsx:553` — `href="/switching/spreadsheet"` in the closing band.
- `src/app/about/page.tsx:293` — `href="/switching"`.

So `/switching/spreadsheet` is about to have one measurable inbound door and one invisible one, and
the number that settles "does the spreadsheet audience need a direct door" — the question that put
the homepage link there — will be read against a denominator that quietly omits `/product`, the page
a reader lands on *after* the homepage convinced them. The nav and footer links to `/switching` are
deliberately different (they are chrome on every page and would need their own position tags to mean
anything), which is why this entry names only the two in-page ones.

## Why it isn't already done

Path ownership. The session that added `switchingHref` owned `src/app/page.tsx` and the funnel
registry only; `product/page.tsx` and `about/page.tsx` were another agent's in a concurrent run, and
editing them would have raced that work for a one-line attribution win.

## Proposed change

Add two tags to `FIXED_SOURCES` in `src/lib/funnel.ts` following the position convention already
documented there — `product-close` is taken in spirit by `product-mid`/`product`, so name them for
where they sit (something like `product-closing-switching` and `about-switching`, or reuse the
page's own unsuffixed tag if the page has only one switching door) — and route both links through
`switchingHref()`. Then extend the "Not every tagged door is a conversion" paragraph in
`docs/product/marketing.md` to say all in-page switching doors are tagged.

**Not** proposed: tagging the nav and footer links. Those render on every marketing page, so one tag
across all of them would answer no question, and a per-page tag is a bigger decision about what
chrome attribution means — worth its own thinking, not a drive-by.

## Prompt

```text
Read src/lib/funnel.ts (the FIXED_SOURCES registry, the position-splitting comment, and
switchingHref), then src/app/product/page.tsx around line 553 and src/app/about/page.tsx around
line 293 — both link to the switching surface with a bare href while the homepage's two doors now
build theirs through switchingHref() and carry a ?from= tag on the page view.

Route those two in-page links through switchingHref(), adding a tag per position to FIXED_SOURCES
first (a misspelled or reused tag is the exact failure that file exists to prevent — read its
header comment before naming one). Do NOT tag the nav or footer switching links: they render on
every marketing page, so a single tag across them answers nothing, and per-page chrome attribution
is a separate decision.

Done means: no bare "/switching" or "/switching/spreadsheet" href left in src/app/product/page.tsx
or src/app/about/page.tsx, a case in src/lib/funnel.test.ts covering each new tag's round trip
through eventSource, and the "Not every tagged door is a conversion" paragraph in
docs/product/marketing.md updated to say every in-page switching door is tagged. Run pnpm check,
then pnpm e2e e2e/marketing.spec.ts --reporter=line — that spec asserts hrefs on these pages and a
tag changes them, so read its failures rather than assuming they are unrelated. Delete
docs/product/follow-ups/FU-20260815-the-other-switching-doors-are-still-untagged.md as part of the
change.
```
