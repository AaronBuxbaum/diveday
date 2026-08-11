# FU-20260811-overview-two-column-composition — Give the trip Overview a desktop composition shaped like its content

- **Status:** Open
- **Raised:** 2026-08-11 — the Guests/Overview recomposition (PR #452), design-critic review
- **Kind:** improvement
- **Effort:** M
- **Touches:** `src/app/shop/[shopSlug]/trips/[id]/page.tsx`, `src/app/shop/[shopSlug]/trips/[id]/loading.tsx`, `e2e/visual.spec.ts`

## What I noticed

On a 1280px viewport the trip Overview is a single ~800px column of eight stacked sections; the
right half of the screen is empty from "Details" to the footer. Even with the ops-first order
(details → requirements → crew before the recap material), the post-trip content pushes the page
to ~2,000px, and before a trip has departed the recap note and photo sections are future-tense
chrome at equal weight to live operations.

## Why it isn't already done

It's a real composition change (principle 11 asks for at least two sketched alternatives), it
moves the `loading.tsx` skeleton and every visual baseline for the route, and PR #452 was already
carrying the section reorder — two layout changes in one diff would make the visual triage
unreadable.

## Proposed change

At `lg`, a two-column composition: left column the operational spine (Details, Readiness
requirements, Crew), right column the day-of/after material (Crew prediction, Post-trip recap
note, Diver photos), Series and the lifecycle actions full-width below. Phone stays the current
single column. A cheaper variant if that proves too much churn: keep one column but collapse the
recap note + photos behind a labeled disclosure until the trip's end time has passed. Not
proposing tabs or a dashboard grid — the page's sections are few enough that a second nav level
would cost more than it buys.

## Prompt

```text
Read docs/design/principles.md (#10, #11) and src/app/shop/[shopSlug]/trips/[id]/page.tsx, then
sketch (in prose, in the PR description) two desktop compositions for the trip Overview: (a) a
lg:two-column split — operational spine (Details, Readiness requirements, Crew) left; day-of and
post-trip material (Crew prediction, Post-trip recap note, Diver photos) right; Series and
lifecycle full-width below — and (b) a single column where the post-trip material collapses
behind a labeled disclosure until the trip's end time passes. Build the one that survives the
remove-until-it-breaks test. Keep phone as a single column in the current order, reshape
loading.tsx to match the new layout so there is no shift, take light+dark screenshots at 390px
and 1280px, run pnpm check and pnpm e2e:run trips.spec.ts --reporter=line, and account for every
visual diff. Delete docs/product/follow-ups/FU-20260811-overview-two-column-composition.md as
part of the change.
```
