# FU-20260813-homepage-breadth-band-needs-a-picture — Decide whether the homepage's four-card breadth band earns its place, once the funnel pairs have numbers

- **Status:** Waiting
- **Waiting on:** real traffic through the page-level funnel pairs `home-hero` and `home-closing`
  (`src/lib/funnel.ts`). To check: read those pairs following
  [docs/engineering/capability-telemetry-runbook.md](../../../engineering/capability-telemetry-runbook.md).
  Until they carry numbers there is nothing to decide — the predecessor door, `home-mid`, retired
  without ever accumulating a single pair, which is exactly how this entry got here.
- **Raised:** 2026-08-13 — the landing-page redesign (branch `claude/design-landing-page`)
- **Kind:** question
- **Effort:** M
- **Touches:** `src/app/page.tsx`, `src/components/MarketingSections.tsx`, `docs/product/marketing.md`, `src/i18n/locales/en-US/diver.json`, `src/i18n/locales/es-ES/diver.json`

## What I noticed

After the 2026-08-13 redesign every band on `/` shows a reader something: the hero shows the
captain's roll-call screen, the two daily-moment rows show the diver's schedule and the front
desk's readiness list, the records diptych shows the import preview beside the export inventory.
One band does not. Between the moments and the records, `FeatureGroupsGrid` renders four uniform
text cards — "Welcome divers well", "Get ready before the dock", "Run the dive day", "Keep the shop
in motion" — each an eyebrow, a title, and a sentence, under the statement "Instead of a
whiteboard, a clipboard, and three apps that don't talk to each other."

It is the only place on the highest-traffic page on the site that asks a reader to take a claim on
trust, and it sits at the exact midpoint, where a scanning reader either keeps going or leaves.

## Why it isn't already done

Two reasons, and neither is taste.

First, the band is doing a job the pictures cannot: breadth in one glance, then a hand-off to
`/product`. Four screens would say "DiveDay has four screens"; four assertions say "DiveDay covers
the whole day." Replacing it with imagery would cost the breadth, which is the one thing a buyer
comparing feature pages is looking for at that moment.

Second — and this is the part only a human with the analytics can close — the page had a
`home-mid` demo door under these cards until 2026-08-13, and it retired without ever accumulating a
`demo_entered`/`trial_started` pair, because no real traffic ran through it. So there is still no
evidence about whether readers stall at this midpoint. Deciding the middle of the highest-traffic
page on taste, against a measurement that will exist shortly, is the wrong trade — the same call
`docs/product/marketing.md` recorded on 2026-08-12 and again in the 2026-08-13 redesign.

## Proposed change

Wait for the page-level pairs (`home-hero`, `home-closing` — see `src/lib/funnel.ts` and
[docs/engineering/capability-telemetry-runbook.md](../../../engineering/capability-telemetry-runbook.md))
to carry real numbers, then read them:

- **If `/` converts well:** change nothing, and delete this file. The band is not the problem.
- **If `/` converts poorly and `/product` click-through from this band is low:** the cards are not
  earning the scroll. The change is a visual *beside* the four cards, not instead of them — a
  single wide screen under the statement with the four cards as its caption row, so breadth and
  proof arrive together. `marketingMockups` in `src/components/MarketingSections.tsx` already holds
  the two candidates that are not already used on this page.

Explicitly **not** proposed: replacing the four cards with four mockups (that is the breadth cost
above, paid in full), or re-adding a mid-page demo door. `home-mid` is retired and must not be
reused for a new door — new traffic in the retired tag's bucket makes neither readable.

## Prompt

```text
Read docs/product/marketing.md (the "Product visuals" section, especially the paragraph beginning
"The homepage's four-card breadth band is deliberately still four assertions") and src/app/page.tsx
(the breadth band renders FeatureGroupsGrid, whose four cards each show one summary paragraph --
its featuresPerGroup/columns props were removed on 2026-08-14 when the checklist density lost its
last caller). Then pull the
demo_entered / trial_started counts for the `home-hero` and `home-closing` funnel sources — the
runbook is docs/engineering/capability-telemetry-runbook.md and the tags are registered in
src/lib/funnel.ts.

The question: does the homepage's four-card breadth band, the only band on / that shows the reader
nothing, need a visual? The constraint that makes this non-obvious is that the cards exist to give
breadth in one glance and hand the reader to /product — four screenshots would show four screens
and lose exactly that, so the answer is never "swap cards for mockups". If the numbers say the
midpoint is losing readers, add one wide mockup ABOVE or BESIDE the four cards and keep all four.
Do not add a mid-page demo CTA: the page deliberately has exactly two demo doors (hero and close)
and the `home-mid` tag is retired, not reusable.

Done means: either the band is unchanged and this file is deleted with the reasoning appended to
docs/product/marketing.md, or the band gains one visual, the visual spec captures it
(e2e/visual.spec.ts, the `landing` capture already covers the page), any new copy lands in BOTH
src/i18n/locales/en-US/diver.json and src/i18n/locales/es-ES/diver.json, and
docs/product/marketing.md records what the numbers said.

Run: pnpm check, then pnpm e2e:build && E2E_WORKERS=1 pnpm e2e:run e2e/marketing.spec.ts
--reporter=line, and read the landing PNGs in e2e/screenshots/ in light and dark at 390 and 1280.
Delete docs/product/follow-ups/waiting/FU-20260813-homepage-breadth-band-needs-a-picture.md as part of the
change.
```
