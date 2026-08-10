# FU-20260810-still-to-call-chip-recognition — Decide whether the still-to-call chips need faces (and crew)

- **Status:** Open
- **Raised:** 2026-08-10 — dive-domain review of the manifest simplification on `claude/app-design-overhaul-nx3437`
- **Kind:** question
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/trips/[id]/manifest/_components/SummaryPanel.tsx`, `src/components/MissingDiversGrid.tsx`

## What I noticed

The live manifest's "Still to board" face grid became name chips under the checkpoint panel.
The jump-to-row behaviour is better, but the grid's initials-avatar also served *recognition* —
matching an uncalled name to a body on a crowded dock where half the boat are walk-ups the crew
met twenty minutes ago. The chips are names only. Separately, the chips are divers-only: crew
still-to-call shows up just as the muted "crew members still to call" count, never as names,
even though crew are the people most reliably in the water.

## Why it isn't already done

Both are judgement calls the review flagged as acceptable-as-shipped, and each has a real
counter-argument: an initials circle in a chip may be noise that adds no recognition beyond the
name (there are no photos), and a two-to-four-person crew list is short enough that names in the
muted line may be enough. Worth a deliberate decision with the chips in real use rather than a
tail-end guess; the offline manifest still carries the full face grid meanwhile.

## Proposed change

If faces earn their keep: render the `MissingDiversGrid`-style initials circle inside each chip
(same blocked/rental accents dropped — the chip's word set stays as is). If crew presence earns
its keep: append crew chips (marked "(crew)" like the buddy panel does) once every diver is
settled, or always — decide against the muted-line ranking in `SummaryPanel.tsx`. If neither
survives scrutiny, delete this entry and note the decision in the component comment.

## Prompt

```text
Read src/app/shop/[shopSlug]/trips/[id]/manifest/_components/SummaryPanel.tsx (the still-to-call
jump chips), src/components/MissingDiversGrid.tsx (the initials-avatar the offline view still
uses), and docs/design/principles.md (§9 — say a shared fact once, and badges mark the
exception). Decide two things and implement what survives: (1) whether each chip gains an
initials circle for dock recognition, (2) whether crew who are still to call appear as chips
rather than only the muted count line. Either way, record the reasoning in the component
comment. Keep chips rendering only mid-roll-call, keep the blocked word on blocked chips, and
keep every anchor target working. Update the chips test in e2e/manifest.spec.ts if behaviour
changes, screenshot light+dark, and run pnpm e2e:run manifest.spec.ts --reporter=line plus
pnpm check. Delete docs/product/follow-ups/FU-20260810-still-to-call-chip-recognition.md as part
of the change.
```
