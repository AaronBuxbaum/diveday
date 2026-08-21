# FU-20260821-scan-the-reef-briefing-now-that-networkidle-is-gone — Bring the seeded reef briefing into the a11y scan

- **Status:** Open
- **Raised:** 2026-08-21 — the branch that closed FU-20260821-ready-never-reaches-network-idle and FU-20260821-the-a11y-booking-scan-pays-19s-for-setup
- **Kind:** improvement
- **Effort:** S
- **Touches:** `e2e/a11y.spec.ts`

## What I noticed

`e2e/a11y.spec.ts` carries an "Absent, and why" note saying the seeded reef trip's public briefing
(`/s/blue-mantis/trips/<id>` for a departure with a dive site) is the one diver surface the file
cannot scan. The reason it gives is that the page embeds a Google Maps iframe the context fixture
aborts, plus externally hosted site photos proxied through `/_next/image` that the sealed e2e fleet
can never fetch, "so the document never reaches the `networkidle` state the scan waits for and the
test hangs until its own timeout."

**That wait no longer exists.** PR #585 removed `waitForLoadState("networkidle")` from
`expectNoA11yViolations`; every caller gates on the surface's own heading instead. The stated
mechanism is therefore gone, and with it the reason the richest diver-facing page in the product is
unscanned — a dive plan, a site briefing, a field guide, a map and a booking form on one document.

Measured while closing the two follow-ups above, against a warm e2e server on macOS: opening
"Two-Tank Reef — Benwood & Elbow" from the public schedule and running the file's own axe
configuration on it reports **zero violations in 1.5s**, and at the default viewport the lazy map
iframe never even loads, so the page has no child frame at all.

## Why it isn't already done

Scope. The change that found this was cutting ~19s of setup out of one test and explaining a CI
hang; adding a scanned surface is a different job with a different failure mode, and the macOS
measurement is not a CI measurement. On a Linux runner the lazy iframe *does* load (that is exactly
what the trace of run 32441820119 shows happening on `/ready`), which is fine for axe but changes
what the page does while the test is on it. That deserves its own PR and its own green CI run rather
than riding along.

## Proposed change

In `e2e/a11y.spec.ts`, add a scan of the seeded reef briefing — a departure that carries a dive site,
so the document includes `DiveBriefingsSection`, `DiveSiteMap` and the field guide. Either extend
"the trip booking page and its confirmation" with a third scan or, better, give it its own test
beside the public-schedule one, since its cost is a navigation rather than shared setup.

Then delete the "Absent, and why" paragraph rather than editing it: with the page scanned there is
nothing absent to explain.

**Not** proposed: switching the *booking* scan onto the reef departure. That scan books a seat, and
the seeded reef charter's price and gate are load-bearing for other specs' "N spots left" text; the
Discover Scuba session it books today is the one seeded departure with a price, free seats, no
certification gate and no dive site.

## Prompt

```text
Bring the seeded reef trip's public briefing into e2e/a11y.spec.ts's automated a11y scans.

Read e2e/a11y.spec.ts first — the "Absent, and why" paragraph above the "signed-out surfaces"
describe block explains why it was left out, and the reason it gives (a `networkidle` wait that
never settled) was removed from `expectNoA11yViolations` in PR #585. Read that function's comment
too for what the scan does wait on now.

Add a scan of a seeded blue-mantis departure that has a dive site — "Two-Tank Reef — Benwood &
Elbow" or "Two-Tank Reef — Molasses & French" — reached the way a diver reaches it: /s/blue-mantis,
then the row's link (its accessible name is "<title> · N spots left", so do not match `exact`).
Wait for the page's own <h1> before scanning, never a skeleton. Give it its own test rather than
bolting it onto the booking scan, and size `test.setTimeout` from a measurement.

The constraint that makes this non-obvious: the page embeds a Google Maps iframe that
e2e/fixtures.ts aborts, and externally hosted dive-site photos proxied through /_next/image that the
sealed fleet cannot fetch. Neither blocks axe, but do not add a `networkidle` wait back
(`pnpm check:e2e-hygiene` refuses it) and do not narrow the scan or disable rules to make it pass —
a violation here is a real defect to fix in src/app.

Done when: the scan is in the file, the "Absent, and why" paragraph is deleted rather than reworded,
`pnpm e2e e2e/a11y.spec.ts --reporter=line` passes for every test in the file, and `pnpm check` is
green. Delete
docs/product/follow-ups/FU-20260821-scan-the-reef-briefing-now-that-networkidle-is-gone.md as part
of the change.
```
