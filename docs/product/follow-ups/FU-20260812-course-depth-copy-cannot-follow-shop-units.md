# FU-20260812-course-depth-copy-cannot-follow-shop-units — Decide whether a shop's course prose should follow its own depth unit

- **Status:** Open
- **Raised:** 2026-08-12 — branch `claude/diving-app-ui-copy-fixes-zc6wg6`, from the report "we still
  have some copy that uses meters even when you switch to feet (eg. No deeper than 12 meters)"
- **Kind:** question
- **Effort:** M
- **Touches:** `src/db/course-templates.ts`, `src/lib/courses.ts`, `src/db/courses.ts`,
  `src/app/shop/[shopSlug]/courses/[slug]/edit/page.tsx`

## What I noticed

A shop set to feet was reading "No deeper than 12 meters" on its own Discover Scuba page. That
sentence is a `courses.faqs` value, seeded from `src/db/course-templates.ts` — free prose in the
shop's row, not a stored number — so `depthInUnit`/`depthText` (`src/lib/depth-units.ts`) never see
it and the shop's `depth_unit` cannot reach it. The same is true of roughly thirty depth mentions
across the templates: overviews, day-by-day plans, includes lists, FAQ answers.

I fixed the symptom by writing every one as the pair the agencies themselves publish — "12 meters
(40 feet)", using the same numbers as `DepthCeiling` in `src/lib/depth-ceiling.ts`. That is honest
and unit-neutral, and it matches how PADI and SSI print these limits. What it is not is
*responsive*: a Florida shop still reads a metric-first sentence with its own unit in parentheses,
and a shop that edits the page can put any unit it likes back in.

The parenthetical also lengthens copy that is already dense — the Deep Diver day plan now reads
"Dive 3: to 30–40 meters (100–130 feet), with a safety cylinder staged on the line".

## Why it isn't already done

Making this prose follow `shops.depth_unit` needs a product decision I should not make alone, and
whichever way it goes it is a bigger change than the report asked for:

1. **Leave it as pairs** (what ships now). Zero machinery, always true, reads like the agency
   manuals. Costs a parenthetical in every depth sentence and ignores the shop's setting.
2. **Template the numbers.** Give `CourseTemplate` content ICU placeholders (`{depth18}`) resolved
   through `depthText` at render. Correct and responsive, but it makes template content a message
   format rather than prose, and a shop that edits the page either loses the placeholder or has to
   learn the syntax — the whole point of this content is that it is text a human rewrites.
3. **Seed in the shop's unit.** Pick the wording once, at seed/import time, from the shop's
   `depth_unit`. Simple and leaves ordinary editable prose behind — but it fixes the wording at
   creation, so a shop that later switches units is back where it started, and it doubles the
   template content.

My recommendation is (3) *plus* keeping the pairs as the fallback wording, because a shop switching
units is rare and a shop editing this prose is not. But it is a content-model call.

## Proposed change

Under (3): add a `depthUnit` argument to whatever materializes a template into a `courses` row
(today only `seedCatalog` in `src/db/seed-catalog.ts`), and hold each depth-bearing string in the
template as a small `{ meters: string; feet: string }` pair chosen at insert. Do **not** reach for
per-render conversion of stored prose — parsing numbers back out of a shop-edited sentence is the
obvious wrong turn here, and it would rewrite words the shop typed.

Under (1), close this file and add a line to `src/db/course-templates.ts`'s doc comment saying the
pair form is deliberate and final.

## Prompt

```text
Read docs/product/follow-ups/FU-20260812-course-depth-copy-cannot-follow-shop-units.md, then
src/db/course-templates.ts (its doc comment explains why depths are written as
"18 meters (60 feet)" pairs), src/lib/depth-units.ts, and src/db/seed-catalog.ts.

The question: a shop whose depth_unit is "feet" reads metric-first prose on its own course pages,
because that prose is free text in the shop's own courses row and nothing can convert it. Decide
between the three options in the follow-up and implement the one you pick. If the answer is
"leave it as pairs", the change is a doc comment stating that and deleting this file.

Constraint that makes this non-obvious: this content is meant to be rewritten by shops, so any
solution that turns it into a template language has to survive a human editing it. Never parse
depths back out of shop-edited prose.

Done when: the chosen option ships with tests, `pnpm check` is green, and
docs/product/follow-ups/FU-20260812-course-depth-copy-cannot-follow-shop-units.md is deleted.
```
