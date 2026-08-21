# FU-20260821-settled-roll-call-controls-dont-say-undo-to-a-screen-reader — Give the settled roll-call toggle an accessible name that says it can be taken back

- **Status:** Open
- **Raised:** 2026-08-21 — the Guests/Manifest recomposition (branch claude/trip-page-design-db4fb2), design review finding
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton.tsx`, `src/components/OfflineManifestView.tsx`, `src/i18n/locales/en-US/staff/manifest.json`, `src/i18n/locales/es-ES/staff/manifest.json`, `e2e/manifest.spec.ts`, `e2e/boat-loop.spec.ts`, `e2e/buddy-pairs.spec.ts`, `e2e/visual.spec.ts`

## What I noticed

Design principle 7 justifies dropping the "tap again to undo" caption under a settled roll-call
control partly on the claim that "its accessible name already says 'Undo'" — but it does not: a
settled control's accessible name is exactly its visible label, "Boarded ☑️" / "Not boarded ☑️" /
"Aboard ☑️" (`RollCallButton.tsx` renders `label` with no `aria-label`). A sighted crew member
reads the done-check as a re-tappable state; a screen-reader user hears a past-tense claim with no
hint it is a toggle. This is a mutating control on a safety surface, where the principles say an
a11y gap that costs the sighted user nothing is a defect, not a trade.

## Why it isn't already done

The accessible names are load-bearing in many places at once: `e2e/manifest.spec.ts`,
`e2e/boat-loop.spec.ts`, `e2e/buddy-pairs.spec.ts`, `e2e/visual.spec.ts`, and the offline suite all
locate these buttons by role and exact-or-substring name ("Boarded ☑️", "Aboard ☑️"), and the
offline manifest (`OfflineManifestView.tsx`) renders its own copies of the same controls that must
change in the same breath. Adding an `aria-label` changes the accessible name, so every matcher and
both locale bundles move together — a small change with a wide blast radius, wrong to smuggle into
a layout commit.

## Proposed change

When the control is in its settled/cleared state, add an `aria-label` built from a new message key
("Boarded — tap to undo", Spanish equivalent) while the visible label stays "Boarded ☑️"; same for
"Not boarded ☑️" and the crew pair, and the same treatment in `OfflineManifestView`. The
danger-state "Not back aboard" keeps its visible undo sentence and needs no label change. Update
the e2e matchers to the new accessible names (or match on visible text via `getByText` where the
spec's point is the label). Not proposing: any visible copy change — the review already settled
that the settled control carries no caption.

## Prompt

```text
Read src/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton.tsx and the settled-state label
logic in manifest/_components/RollCallControls.tsx, plus the offline copies in
src/components/OfflineManifestView.tsx (search for "☑️"). Give every settled roll-call toggle an
aria-label that appends an undo hint to the state ("Boarded — tap to undo"), from new keys in both
src/i18n/locales/en-US/staff/manifest.json and es-ES, keeping visible labels unchanged. The
"Not back aboard" danger state keeps its visible undo sentence and gets no aria-label. Update every
e2e and unit matcher that locates these buttons by accessible name (grep "Boarded ☑️", "Aboard ☑️"
across e2e/ and src/). Run pnpm check, then pnpm e2e e2e/manifest.spec.ts e2e/boat-loop.spec.ts
--reporter=line. Delete
docs/product/follow-ups/FU-20260821-settled-roll-call-controls-dont-say-undo-to-a-screen-reader.md
as part of the change.
```
