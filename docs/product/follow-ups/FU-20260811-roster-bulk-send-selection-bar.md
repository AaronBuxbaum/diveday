# FU-20260811-roster-bulk-send-selection-bar — Replace the roster's narrated bulk-send control with a selection bar

- **Status:** Open
- **Raised:** 2026-08-11 — the Guests/Overview recomposition (PR #452), design-critic review
- **Kind:** improvement
- **Effort:** M
- **Touches:** `src/app/shop/[shopSlug]/trips/[id]/_components/RosterSection.tsx`, `src/app/shop/[shopSlug]/trips/[id]/_components/RosterBulkWaiverSelection.tsx`, `src/i18n/locales/en-US/staff/trips.json`, `src/i18n/locales/es-ES/staff/trips.json`

## What I noticed

The Guests roster header shows "Tick divers, then [Send waivers to selected]" at rest, whenever
any diver is sendable. A control that needs a legend to explain its relationship to checkboxes
scattered down the list is detached from its objects (principle 10) — and at rest it's a dead
button plus an instruction sentence occupying the header of every roster with an unsent waiver.

## Why it isn't already done

The fix is client-state-driven (the control should appear when the first checkbox is ticked,
carrying the live count as its label), which means reworking `RosterBulkWaiverSelection`'s
render contract rather than a copy tweak — and the bulk-send flow is exercised by e2e specs that
would need the same rework in one change.

## Proposed change

At rest, render nothing in the roster header. When selection count > 0, surface one control —
"Send waivers (2)" — near the selection (the header is fine if it appears only then), the count
in the label replacing the `tickDiversThen` instruction sentence, which gets deleted from both
locales. Keep the existing `WaiverSendControl` confirm/pending machinery. Not proposing a
floating action bar pinned to the viewport — this page already has one primary action.

## Prompt

```text
Read docs/design/principles.md (#8, #10),
src/app/shop/[shopSlug]/trips/[id]/_components/RosterBulkWaiverSelection.tsx, and
RosterSection.tsx's header block. Change the bulk waiver send so nothing renders at rest: when
the shared selection state's count is 0, the header shows no bulk control and no "Tick divers,
then" sentence (delete trips.roster.tickDiversThen from en-US and es-ES); when the count is > 0,
render the existing BulkWaiverSendButton with the count in its label (new key, e.g. "Send
waivers ({count})"). The constraint: the selection state lives in a provider above the page so
it survives redirects — the header control must read the same state the checkboxes write. Update
the e2e spec that drives bulk send, run pnpm check and the affected e2e spec, and screenshot the
roster in both selected and unselected states, light+dark. Delete
docs/product/follow-ups/FU-20260811-roster-bulk-send-selection-bar.md as part of the change.
```
