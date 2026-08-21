# FU-20260821-no-seeded-diver-brings-their-own-kit — Give Blue Mantis one diver who owns their gear

- **Status:** Open
- **Raised:** 2026-08-21 — building the prep page's by-diver grouping (`claude/prep-group-by-item-8f3c2d`)
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/db/seed-rental-fit.ts`, `e2e/gear-fit-and-age.spec.ts`, `e2e/visual.spec.ts`, `src/lib/dive-prep.ts`

## What I noticed

Every rental fit the demo shop seeds sets `rentsBcd`, `rentsRegulator`, `rentsWetsuit`,
`rentsMaskFins` and `rentsWeights` to `true` — see the object literal at the bottom of
`src/db/seed-rental-fit.ts`. The only variation is `ownsRegulator`, which turns one of the five
off. So **no diver in `blue-mantis` brings their own kit**, and two real states of the prep page
have never appeared on a screen or in a visual baseline:

- The `own_kit` row of the new by-diver grouping (`PrepDiverLine.state`, `src/lib/dive-prep.ts`),
  which renders `shared.rentalFit.ownKit` — "Own kit" — with a piece count of 0. It is unit-tested
  (`src/lib/dive-prep.test.ts`, "gives a diver with nothing to pull a row") and nothing else.
- The rental-kit section's own-kit empty state, `trips.prep.rentalKitEmptyOwnKitHeading` /
  `nothingToPullOwnKit` ("No gear to pull" / "every diver on this trip brings their own kit"),
  which needs a departure where *nobody* rents anything.

The first is the one that costs something today: the by-diver grouping's e2e assertion had to fall
back to "some row links to a diver record" because there was no own-kit row to point at, and the
`prep-by-diver` visual baseline shows only `rents` and `not_recorded` rows.

A diver who owns a full kit and books a boat is not an edge case — it is most of a shop's repeat
business — so the demo is currently describing a shop whose every customer rents everything.

## Why it isn't already done

Outside the scope I was given, and it is a seed change, which lands in every spec in the suite at
once: adding a diver with no rentals shifts the tank/piece counts and the "For" lists that several
existing prep and manifest assertions and four visual baselines read. That is a deliberate,
reviewable change of its own rather than a drive-by inside a UI PR, and `src/db/seed-rental-fit.ts`
is exactly the kind of shared seed file two branches collide in.

## Proposed change

In `src/db/seed-rental-fit.ts`, add one entry to the `fits` table for a customer index already
booked on today's reef departure, with every `rents*` flag false and no sizes — the shape the
existing `ownsRegulator` flag hints at, widened to the whole kit. The `fits` tuple currently has no
way to express that, so it needs one more optional field (`ownsEverything?: boolean`, or an
explicit `rents` set) rather than a null-size row, since null sizes mean "not asked", which is a
different state and already seeded.

Then:

- Tighten the by-diver e2e in `e2e/gear-fit-and-age.spec.ts` ("flips between the rack and the
  roster") to assert `Own kit` on that diver's row instead of the current generic
  `a[href*="/divers/"]` check.
- Re-baseline `prep`, `prep-by-diver`, `prep-assignments` and `manifest`; explain the count changes
  in the PR the way the visual-triage skill asks.

**Not** proposed: seeding a whole departure where nobody rents anything just to photograph the
own-kit empty state. That state is one `EmptyState` with two strings and no interactive parts; a
second demo departure with an unusual roster costs the demo more than the baseline is worth.

## Prompt

```text
In the DiveDay repo, give the seeded blue-mantis shop one diver who brings their own kit.

Read first: src/db/seed-rental-fit.ts (the `fits` table and the object literal it maps to),
src/lib/dive-prep.ts (`PrepDiverLine.state` — `own_kit` vs `not_recorded`), and
e2e/gear-fit-and-age.spec.ts's "the prep list's two groupings" describe.

The constraint that makes this non-obvious: every seeded fit sets every `rents*` flag true, and
`fits` has no field that can turn them all off — an entry with null sizes means "nobody asked",
which is a different state that is already seeded and already rendered differently. So the tuple
needs a new optional field, not a null-size row. Pick a customer index that is already booked on
"Two-Tank Reef — Molasses & French" so the row shows up on that departure's prep page.

Done when: the prep page's by-diver grouping (?group=diver) shows that diver with "Own kit" and a
piece count of 0; the e2e above asserts "Own kit" on that row rather than the current generic
diver-link check; every prep/manifest unit and e2e assertion that reads tank counts or "For" lists
still passes; and the PR explains the moved pixels for the prep, prep-by-diver, prep-assignments
and manifest visual baselines (see the visual-triage skill).

Run: pnpm check, pnpm e2e e2e/gear-fit-and-age.spec.ts --reporter=line, and a filtered visual run.
Delete docs/product/follow-ups/FU-20260821-no-seeded-diver-brings-their-own-kit.md as part of the
change.
```
