# H-20261014-package-dive-is-a: What is one "dive" in a dive package: a tank or a trip?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**What is one "dive" in a dive package: a tank or a trip?** A package sold "5 dives" and a two-tank boat spent two of them, and nothing a diver read said so. Raised by the fourth UX review (2026-10-14), section 5, decision 2.

## Minimum outcome to record

The choice, and where it is said.

## Outcome

**Decided 2026-10-14 (Product owner: Aaron Buxbaum, in the project thread, "Do recommended decisions for each", taking the recommendation):** A package "dive" is one tank, said on the card and in the booking's money block; the demo's prices make the card a deal.

- Built by layer r4-1 (fourth review item 9): the packages card says "One dive is one tank, so a two-tank trip uses two"; `/ready`'s Pay step says "Uses 2 of your 5 package dives, one per tank" (`countDivesSpentOnBooking`); the demo prices are $200 for five and $375 for ten. Recorded in [20260822-a-package-is-entitlements-not-money](../../architecture/decisions/20260822-a-package-is-entitlements-not-money.md).

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
