# FU-20260813-orientation-line-needs-a-baseline — Capture the busy-day orientation line in the visual suite

- **Status:** Open
- **Raised:** 2026-08-13 — the Today calm-landing redesign (branch `claude/design-today-calm-landing`)
- **Kind:** improvement
- **Effort:** M
- **Touches:** `e2e/visual.spec.ts`, `scripts/route-coverage.json`, `src/app/shop/[shopSlug]/_components/today/RoleOrientationCard.tsx`

## What I noticed

The role orientation on Today now has two forms: the full tinted card when the page has no work to
show, and a single muted line (`RoleOrientationLine`) when a queue row or a boat on today's board
means the work must lead. The card form appears in the existing `today-empty` and
`today-first-bookable` baselines, but the line form has no visual baseline at all — a regression in
its layout (the dismiss button wrapping under the sentence on a phone, say) would ship unseen.

## Why it isn't already done

Reaching this state requires a **real** (non-demo) shop whose owner has not dismissed orientation *and*
which has work to show. The demo shop suppresses orientation entirely, and the two fresh-shop
captures deliberately have no bookings, so no state in the current visual suite renders the line.
Constructing it means onboarding a fresh shop, scheduling a departure, and seating at least one
diver with an open blocker — a multi-step flow like `today-first-bookable`'s but longer, and each
per-scheme shop needs its own deterministic slug. That spec work deserved its own focused session
rather than a rushed appendix to the redesign; the line's DOM shape is meanwhile covered by
`RoleOrientationCard.test.tsx`.

## Proposed change

Extend the `today-first-bookable` visual test (it already onboards a shop and creates a departure):
after the existing capture, seat a walk-in diver on the new trip via `/shop/<slug>/bookings/new` so
the queue gains a waiver row, return to `/shop/<slug>`, wait for the orientation line's link, and
`capture(page, "today-orientation-line", scheme)`. Register the new capture under `/shop/[shopSlug]`
in `scripts/route-coverage.json`. Do **not** add a separate onboarding flow per capture — reuse the
existing shop so the suite stays one sign-up per scheme.

## Prompt

```text
Read e2e/visual.spec.ts's "the first bookable moment renders true to the design" test and
src/app/shop/[shopSlug]/_components/today/RoleOrientationCard.tsx (both forms), plus the
hasWorkToShow arbitration in src/app/shop/[shopSlug]/page.tsx. Add a visual capture named
"today-orientation-line" showing RoleOrientationLine: extend the existing first-bookable flow by
seating one diver on the created trip (so Today has work to show and the orientation renders as a
line, not a card), navigate back to /shop/<slug>, wait for the line's tour link, and capture.
Constraint: the visual fleet's clock is frozen (E2E_FROZEN_CLOCK) and slugs render on screen, so
keep the existing deterministic slug and date the booking off the frozen clock. Register the capture
under "/shop/[shopSlug]" in scripts/route-coverage.json. Done when
E2E_WORKERS=1 npx playwright test e2e/visual.spec.ts -g "first bookable" --reporter=line passes and
the new PNGs show the one-line orientation above the departure board. Run pnpm check. Delete
docs/product/follow-ups/FU-20260813-orientation-line-needs-a-baseline.md as part of the change.
```
