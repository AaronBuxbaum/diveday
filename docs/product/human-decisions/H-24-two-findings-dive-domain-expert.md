# H-24: Two findings the dive-domain-expert review raised against the specialty-card import (H-23) and which that…

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

Two findings the `dive-domain-expert` review raised against the specialty-card import (H-23) and which that change deliberately deferred: (1) the one-tap **Confirm card** asserted nothing — it stamped `reviewedAt` with no prompt and no claim, even though for an imported specialty card that tap is what opens a depth gate, and for an imported nitrox card what authorizes an enriched-air fill; and (2) `normalizeLevel` read anything containing "advanced" as Advanced Open Water, so **TDI Advanced Nitrox** — a decompression-adjacent gas certification — imported as a *verified* AOW card two rungs above Open Water, with nothing holding it (a ladder card clears its gate on status alone).

## Minimum outcome to record

**Decided 2026-07-25: fix both.** Confirming an *imported* specialty or nitrox card now requires an explicit card-sighting attestation ("I've seen this diver's card, or checked the number with the issuing agency"), recorded in the card's review note; a card the shop captured itself is unaffected, and there is deliberately no bulk confirm. A technical or overhead-environment rating (trimix, CCR, cave, deco, tec, Advanced Nitrox…) imports as **nothing**, named in the preview as a technical rating that wasn't imported — the owner's instruction was "fix both, or just show that it didn't import and why".

## Unblocks / follow-up

**Revised 2026-08-14 (Aaron Buxbaum): drop the attestation, both confirms are one tap.** Presented with the asymmetry the attestation had left behind — an imported *level* card, which opens depth on every gated boat, confirmed on a bare tap while the Deep specialty beside it asked — the owner chose to level down rather than up, for consistency and counter speed. The **gate is unchanged**: an imported card still clears nothing until a staffer confirms it, per card, with no bulk confirm. What is gone is the second statement of why, and with it the trail's ability to tell "someone saw the card" from "someone tapped". Taken against the standing `dive-domain-expert` recommendation in this row, and without a re-review. The technical-rating half of this row is untouched and still binding. See [20260814-one-tap-imported-card-confirm](../../architecture/decisions/20260814-one-tap-imported-card-confirm.md).

Part of the [human decision log](README.md#decision-register).
