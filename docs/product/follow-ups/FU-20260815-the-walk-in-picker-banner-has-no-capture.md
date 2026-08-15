# FU-20260815-the-walk-in-picker-banner-has-no-capture — Photograph the walk-in boat picker's new refusal banner

- **Status:** Open
- **Raised:** 2026-08-15 — the change that closed FU-20260815-refusal-landings-that-say-nothing (branch `follow-ups/round-two`)
- **Kind:** half-done
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/check-in/walk-in/page.tsx`, `e2e/visual.spec.ts`, `e2e/check-in.spec.ts`, `scripts/route-coverage.json`

## What I noticed

The walk-in boat picker (`/shop/<slug>/check-in/walk-in`, step one of the counter path) now reads a
`?notice=` and renders a `ShopNotice` above the "Which boat?" panel. It is the landing for the one
walk-in refusal that happens before a boat is known — `walkin-invalid`, from
`SEAT_SURFACES["walk-in"].refusedPath` when the submission carried no `tripId` — and until this
change that refusal arrived at a page which read no notice at all, so the staffer was bounced back
to the picker with nothing said.

The banner itself has never been looked at. `e2e/visual.spec.ts` captures this route as
`check-in-walk-in`, and that capture is the calm state: no notice in the URL, no banner in the
frame. So the new `ShopNotice` — its tone, its spacing against the back link above it and the panel
below it, in light and dark — is unphotographed, on a page three other agents are concurrently
migrating to `SectionCard`.

## Why it isn't already done

Path ownership. The session that added the banner was explicitly scoped out of `e2e/**` because
several agents were editing that tree at the same time, and adding a capture there would have raced
them. Nothing about the capture is hard; it just could not be written in that change.

Worth knowing before picking this up: the state is **not reachable by clicking**. Every form on the
picker's next step carries a `tripId`, so `walkin-invalid` with no departure only arrives from a
tampered or truncated submission. The capture therefore has to visit the URL with the query on it
rather than drive the UI to it — which is fine (several visual scenarios already do exactly that),
but it is why no existing spec stumbled into the banner on its way past.

## Proposed change

- One scenario in `e2e/visual.spec.ts`, `check-in-walk-in-notice`, visiting
  `/shop/<slug>/check-in/walk-in?notice=walkin-invalid` and waiting for the banner's own text before
  capturing (never a timeout — see `pnpm check:e2e-hygiene`).
- Add that capture name to the `/shop/[shopSlug]/check-in/walk-in` row in
  `scripts/route-coverage.json` (`node scripts/check-route-coverage.mjs --write` regenerates the
  mechanical half; the capture list is hand-maintained).
- Optionally one assertion in `e2e/check-in.spec.ts` that the banner renders the sentence rather
  than nothing — the functional half of the same fact.

Not proposed: seeding an invalid walk-in submission into the fixture to reach the state by clicking.
There is no such click, and manufacturing one would be testing a path the product does not have.

## Prompt

```text
Photograph the DiveDay walk-in boat picker's refusal banner, which shipped on 2026-08-15 with no
visual capture.

Read first: src/app/shop/[shopSlug]/check-in/walk-in/page.tsx (the NOTICE_KEYS map and the
ShopNotice under the back link), e2e/visual.spec.ts around the existing `check-in-walk-in` capture,
the `/shop/[shopSlug]/check-in/walk-in` row in scripts/route-coverage.json, and the e2e-and-visual
skill.

The constraint that makes this non-obvious: the banner is NOT reachable by clicking. It renders for
`?notice=walkin-invalid`, which only arrives from a walk-in submission that carried no departure at
all — every form in the UI carries one. So the scenario visits the URL with the query on it, the
way several existing visual scenarios do, rather than driving the UI to it. Do not seed an invalid
submission into the fixture to manufacture a click.

Wait for the banner's own rendered text before capturing. No waitForTimeout, no networkidle, no
retry loop — `pnpm check:e2e-hygiene` refuses all three, and the fix for a race is always waiting
for what the page itself renders.

Done when: a `check-in-walk-in-notice` capture exists in e2e/visual.spec.ts, it is listed on that
route's row in scripts/route-coverage.json, `pnpm check` is green, and
`pnpm e2e visual.spec.ts --reporter=line` passes locally. Account for the new baseline in the PR
description — a capture that did not exist before is an addition, not a diff to triage.

Delete docs/product/follow-ups/FU-20260815-the-walk-in-picker-banner-has-no-capture.md as part of
the change.
```
