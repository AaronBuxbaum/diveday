# E2E and visual: a capture only covers the state it captures

Part of the **e2e-and-visual** skill ([SKILL.md](SKILL.md)). Read it when deciding what states of a surface need their own capture.

## A capture only covers the state it captures

A surface having a baseline is not the same as your change having one. Check that the captured
*state* actually renders the thing you changed, and treat "no diff appeared" as a question rather
than an answer.

The shop-currency change (ADR 20260731-shop-currency) rewrote how the diver payments row formats an
amount. `diver-profile` was already captured, the suite went green, and it proved nothing: none of
the three captured divers has a single order, so that section had only ever been photographed empty.
The orders list and order detail — the densest money screens in the product — had no capture at all.
Three surfaces' worth of blind spot, behind a passing check.

So when a change lands on a surface that renders rows, money, badges, or any other state-dependent
content:

- Confirm against the seed which fixture the capture actually lands on, rather than assuming a
  populated page. `pnpm test` with a throwaway probe against `seededShopContext({ history: true })`
  settles it in a minute — note that `history` defaults to **false** in tests and **true** in the
  e2e/dev seed, so a test-db probe with the default finds an empty world.
- Prefer adding a capture in the populated state to repointing an existing one; the existing
  capture is usually the baseline for some *other* state, and moving it trades one blind spot for
  another.
- If a change you expected to move pixels moves none, find out why before shipping. Say so in the
  PR if it stays unexplained — a silent pass is not evidence.

## A safety screen is seen filled, and the PR says so

The departure log's "boat's papers and safety kit" section read "No record … was kept" in the demo
for as long as both seeds deleted boat-safety snapshots and wrote none (issue #3650), so every
capture and every review of it saw the empty state. The seeded dawn boat
(`src/db/seed-boat-safety-snapshot.ts`) now has a snapshot: its log is the filled capture for that
section.

A PR that changes the departure log, manifest, readiness, waiver or medical screens fills in the
template's `## Seen filled in` section with the filled state it saw (a seeded departure, a signed
waiver, a flagged medical) and the capture, or writes "no filled state because <reason>"
(`scripts/check-pr-body.mjs`). If the seed has no filled state for the screen you changed, adding
one is part of the change.
