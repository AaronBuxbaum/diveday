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
