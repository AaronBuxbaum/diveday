# H-20261014-seat-is-the-word: Which one word does a diver buy: "seat" or "spot"?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Which one word does a diver buy: "seat" or "spot"?** Staff said "seat" everywhere, enforced by a guard, while the diver side mixed "seat" and "spot", sometimes on one screen. Raised by the fourth UX review (2026-10-14), section 5, decision 1.

## Minimum outcome to record

The choice, and where it is said.

## Outcome

**Decided 2026-10-14 (Product owner: Aaron Buxbaum, in the project thread, "Do recommended decisions for each", taking the recommendation):** "Seat" is the one word for what a diver buys, staff and diver alike; one guard reads both bundles.

- Built by layer r4-1 (fourth review item 7): every capacity "spot" in `diver.json` reads "seat" in both locales, the button counts the party ("Book this seat", "Book 3 seats"), and `scripts/check-seat-word.mjs` reads `diver.json` beside the staff bundles. Its allowlist keeps idioms that are not the thing bought (a marine-life "spot", "on the spot").

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
