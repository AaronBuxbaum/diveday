# FU-20260811-undo-hint-said-once — Teach the re-tap undo hint once, not on every settled row

- **Status:** Open
- **Raised:** 2026-08-11 — design-critic review of the check-in queue's move onto the roll-call
  row grammar (branch `claude/app-design-overhaul-n68zhb`)
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/check-in/page.tsx`,
  `src/app/shop/[shopSlug]/trips/[id]/manifest/_components/RollCallControls.tsx`,
  `docs/design/principles.md`

## What I noticed

Every settled row in the one-tap grammar prints its own "Tap again to undo." hint — the manifest's
roll call (`RollCallControls.tsx`, the `recordedHere` block) and now the counter check-in queue
(`page.tsx`, the settled row's `hint` slot). On a nine-diver boat fully checked in, the identical
sentence renders nine times at equal weight, which is exactly the shape principle 9 crosses out: a
fact shared by every row belongs to the group, not the rows. The hint is teaching a *grammar*, not
stating a per-row fact.

## Why it isn't already done

The hint repetition is the established roll-call grammar, shared by two surfaces — fixing it on
the counter alone would fork the grammar, which principle 11 warns against, and the manifest's
version has dive-domain review provenance (the deck must know a mis-tap on a divemaster is
reversible). Deciding where the hint moves (most-recently-settled row only? once under the group
header when any row is settled? a first-use-only affordance?) is a judgment call worth one focused
change across both surfaces, with a `dive-domain-expert` pass because the manifest is a safety
surface.

## Proposed change

Pick one placement and apply it to both surfaces in the same PR: the strongest candidate is
showing the hint only on the most recently settled row (the one the staffer just tapped, where a
mis-tap correction is live), letting older settled rows carry just their state. Not proposing
removing the hint entirely — re-tap is invisible without it the first time, and the deck must
never learn that a mis-tap is permanent.

## Prompt

```text
Read docs/design/principles.md §7 and §9, then the two surfaces that print the re-tap undo hint on
every settled row: src/app/shop/[shopSlug]/trips/[id]/manifest/_components/RollCallControls.tsx
(the recordedHere block) and src/app/shop/[shopSlug]/check-in/page.tsx (the settled row's hint
slot). Move the hint so the grammar is taught once rather than repeated per settled row — e.g.
only on the most recently settled row — applying the same rule to both surfaces so the grammar
never forks. Constraint: the manifest is a safety surface with dive-domain review provenance (a
deck crew must know a mis-tap is reversible), so get a dive-domain-expert review of the change.
Update the check-in and manifest e2e/visual coverage, run pnpm check, and review light+dark
screenshots. Delete docs/product/follow-ups/FU-20260811-undo-hint-said-once.md as part of the
change.
```
