# FU-20260821-the-a11y-booking-scan-pays-19s-for-setup — Stop building a trip through the UI just to have one to scan

- **Status:** Open
- **Raised:** 2026-08-21 — PR #585, fixing a red `main` after #583 merged
- **Kind:** cleanup
- **Effort:** M
- **Touches:** `e2e/a11y.spec.ts`, `src/db/seed-front-desk.ts`

## What I noticed

`e2e/a11y.spec.ts:90` ("the trip booking page and its confirmation have no automated a11y
violations") is the most expensive test in the file, and almost none of that cost is the thing it
exists to do. Measured on an idle worker:

| Phase | Time |
| --- | --- |
| Booking-page scan (settle + axe) | 1.65s |
| Confirmation scan (settle + axe) | 1.86s |
| **Everything else** | **~19s** |
| Total | 22.3s |

The ~19s is reaching the two states: opening `/shop/blue-mantis/schedule/board?add=full`, filling
six fields, submitting, waiting for the status banner, signing out, loading the public schedule,
clicking through to the trip, filling two more fields, and booking.

It was 11.2s when its budget was set to 30s. Two changes on 2026-08-20 roughly doubled it — the
schedule builder's add panel now waits on a lazy fetch of the shop's dive modes, and a booking now
redirects to `/ready` rather than re-rendering a `?booking=` branch in place (ADR
20260820-one-page-after-booking), which is a whole extra page load. Both are the product working as
intended.

None of that is why it went red on 2026-08-21 — that was a `networkidle` wait that never settled on
CI, removed in PR #585, and is written up separately as
`FU-20260821-ready-never-reaches-network-idle`. The setup cost is a standing problem, not that
incident.

## Why it isn't already done

PR #585 was un-redding `main`, and restructuring this test's setup was not the change to make under
that pressure — especially having already misdiagnosed the failure there twice as cost.

The 19s stands on its own, though. It is the largest single test cost in the suite, it doubled
without anyone noticing, and every future step added to booking or the schedule board will be paid
here again.

## Proposed change

Stop creating a trip through the staff UI. The test needs a bookable future departure with a price
on it; it does not need to have watched one being made — `schedule.spec.ts` already covers building
a departure, which is what that setup is really re-testing.

Either book a seeded `blue-mantis` departure the way `nitrox.spec.ts` and `certifications.spec.ts`
do, or seed a purpose-made priced departure for this scan. Check first that the chosen trip carries
a per-diver price, since the point is to scan the booking page with a price on it; if none does,
adding one to `src/db/seed-front-desk.ts` is the smaller change.

Keep both scans, keep the sign-out (a staff session adds a preview banner no diver sees, so the
scan has to run signed out), and keep them in one test — splitting them would duplicate whatever
setup remains rather than halve it. Once the setup is gone the budget should come back down; set it
from a fresh measurement, not from 120s.

**Not** proposed: narrowing what axe scans, disabling more rules, or splitting the test.

## Prompt

```text
Make e2e/a11y.spec.ts's "the trip booking page and its confirmation have no automated a11y
violations" test stop building a trip through the staff UI.

Read e2e/a11y.spec.ts around line 90 first — the comment above `test.setTimeout(120_000)` carries
the measurements and explains why the budget is where it is. Then read how e2e/nitrox.spec.ts and
e2e/certifications.spec.ts reach a bookable seeded departure on blue-mantis.

The constraint that makes this non-obvious: the scan must run on the SIGNED-OUT booking page (a
staff session adds a preview banner no diver ever sees), and the second scan must run on the
confirmation, which since ADR 20260820-one-page-after-booking is /ready rather than a branch of the
trip page. Both scans stay. Do not split the test — the cost is setup, so splitting duplicates it.
Do not narrow the axe scan or disable further rules.

The test fills "Price per diver" today, so whatever trip replaces the created one needs a per-diver
price; if no seeded blue-mantis departure has one, add it in src/db/seed-front-desk.ts rather than
keeping the UI creation.

Done when: the test reaches both scanned states without opening /shop/blue-mantis/schedule/board,
still asserts zero violations on both, and `test.setTimeout` is reset from a fresh measurement on an
idle worker (record the new number and the phase breakdown in the comment, replacing the current
one). Run `pnpm e2e e2e/a11y.spec.ts --reporter=line` — all tests in the file must pass — and
`pnpm check`. Delete docs/product/follow-ups/FU-20260821-the-a11y-booking-scan-pays-19s-for-setup.md
as part of the change.
```
