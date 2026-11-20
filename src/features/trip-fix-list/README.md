# trip-fix-list

This module owns the Trip page's fix list (ADR 20261117-trip-page-clock): which guests cannot board yet, which are worth a minute, and who is fine, each with the one remedy that fixes it.

## Owns

- `fix-list.ts`: the pure grouping, the remedy each reason calls for, and the order reasons are named in.
- `departure-fixes.ts`: which facts about the departure itself become a row, and in which phases (open orders: Filling and Getting ready, issue #4685).

## Does not own

Readiness itself (`src/lib/readiness.ts`), the reasons' words (the staff bundles), and the rows that draw the list (the Trip page's `_components`).

## Invariants

`blocking` is exactly the guests boarding readiness refuses; an advisory never blocks and a blocker never hides among advisories. Every item names one guest and carries all their reasons; a guest is on one line of the list. Every readiness blocker code and every advisory reason maps to a remedy.
