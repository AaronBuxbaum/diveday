# FU-20260811-row-tone-vocabulary — Give the person-row state tones one shared home

- **Status:** Open
- **Raised:** 2026-08-11 — the check-in queue's move onto the roll-call row grammar (branch
  `claude/app-design-overhaul-n68zhb`)
- **Kind:** cleanup
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/trips/[id]/manifest/_components/RollCallControls.tsx`,
  `src/app/shop/[shopSlug]/check-in/page.tsx`

## What I noticed

Two surfaces now speak the same visual language for "a person's row wearing its state" — a
`border-l-4` left rule plus a tinted fill: the manifest's roll call (`ROLL_CALL_ROW_TONE` in
`RollCallControls.tsx`) and the counter check-in queue (inline classes in `check-in/page.tsx`:
`border-success bg-success/10` for a checked-in row, `border-danger bg-danger/5` for a blocked
one). The check-in classes are hand-written near-copies rather than reads of the shared constant,
so the two lists can drift — a future retune of the manifest's `blocked` fill would leave the
counter's blocked rows on the old value, and a staffer walking from the counter to the dock would
see the same word "Blocked" wearing two different reds.

## Why it isn't already done

`ROLL_CALL_ROW_TONE` lives in a manifest `_components` folder and carries roll-call-specific
states (`notBackAboard`, `notBoardedImplied`) plus glare-tuned fill strengths (`bg-success/20`)
that are deliberately louder than an indoor counter needs. Importing it as-is would either
over-tint the counter or invite a "counter variant" bolted onto a manifest file. Deciding where a
shared row-tone vocabulary should live (a `src/components/` module? a token-adjacent map?) and
which strengths are shared vs. per-surface deserved its own small change, not a rider on the
check-in redesign.

## Proposed change

Extract a small shared module — e.g. `src/components/row-tones.ts` — holding the person-row state
classes both surfaces read (`checkedIn`/`boarded` success, `blocked` danger, and the manifest's
extra states), parameterized or split by surface intensity where the manifest genuinely needs the
stronger fill. Point `RollCallControls.tsx` and `check-in/page.tsx` at it. Not proposing any
visual change — this is a same-pixels refactor so the vocabulary can't fork.

## Prompt

```text
Read src/app/shop/[shopSlug]/trips/[id]/manifest/_components/RollCallControls.tsx
(ROLL_CALL_ROW_TONE and its doc comment) and the row-state classes in
src/app/shop/[shopSlug]/check-in/page.tsx (the article's border-l-4 tone ternary). Extract one
shared module for these person-row state tones so the manifest and the counter cannot drift apart,
keeping each surface's current fill strengths exactly as they are (the manifest is deliberately
louder for deck glare). Constraint: pnpm check:architecture forbids src/components importing from
src/app, so the shared module must live where both pages can import it. Done when both surfaces
read the shared module, no screenshot changes (run the visual spec's check-in and manifest
scenarios and compare), and pnpm check is green. Delete
docs/product/follow-ups/FU-20260811-row-tone-vocabulary.md as part of the change.
```
