# H-97: Should Boat mode be dark in the sun?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Should Boat mode be dark in the sun?** The Logbook redesign drew Boat mode as Night Dive, navy with white ink, in both schemes, as a look; nothing tested it on a deck, and #2033 named the risk.

## Minimum outcome to record

Light or dark Boat mode by day.

## Outcome

**Decided 2026-10-06 (Aaron Buxbaum, on the decision card):** “It's way easier to read a light background in the sun than a dark background.” Boat mode is light by day (white ground, navy ink, navy actions labeled in safety yellow) and keeps the Night Dive navy when the device is in its dark scheme. Recorded as an amendment to [ADR 20261001-logbook](../../architecture/decisions/20261001-logbook.md) decision 6; every pair in both palettes is held to 6:1 by `src/lib/boat-palette.test.ts`.

## Unblocks / follow-up

V-02's sunlight section still checks it on a real deck.

Part of the [human decision log](README.md#decision-register).
