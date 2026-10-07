# H-91: What does the staff app restart on?

- **Status:** Chosen
- **Human owner:** Product owner

## Decision or approval needed

**What does the staff app restart on?** The owner's 2026-10-01 brief: the app is ugly (too many controls, obscure features) and confusing (stripped down too far); evaluate the design top-down and give several new ideas, keeping the features and the code underneath, and re-evaluate the theming entirely. Answered in the [DiveDay Redesign Directions](https://claude.ai/artifact/1piVavXUwbFwvLvix4mphn) write-up: seven findings (17 of 21 destinations had no button; the trip page ran 5,758px; Today was sentences; decoration pushed the work below the fold; no shared page shape; five systems in a month; five doors to seat a diver), a keep/merge/cut inventory, and four directions (A · Logbook, B · Dockside, C · Front Desk, D · Chart). Recommended: A's noun navigation and page shape, B's departure stepper, C's "Needs you" list on Today, the Logbook theme with Night Dive as Boat mode, the cut list as marked, diver pages rethemed only.

## Minimum outcome to record

Direction, cut list, theme, and whether diver pages are redesigned now. **Decided 2026-10-01 (Aaron Buxbaum, in session): "do the recommended moves"** — all four recommendations. Recorded as ADR [20261001-logbook](../../architecture/decisions/20261001-logbook.md), which supersedes 20260919-one-idea (H-88).

## Unblocks / follow-up

The build is one stack in the ADR's order; the pixel audit stops once its open fixes land.

Part of the [human decision log](README.md#decision-register).
