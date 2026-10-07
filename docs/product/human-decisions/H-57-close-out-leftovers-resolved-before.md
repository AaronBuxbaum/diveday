# H-57: How should close-out leftovers be resolved before the day is closed?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

How should close-out leftovers be resolved before the day is closed? (Issue #762.)

## Minimum outcome to record

One durable choice per current leftover, with an accountable actor, immediate persistence, and a reversible correction that does not rewrite the close-out trail.

## Unblocks / follow-up

**Decided 2026-08-22 (Aaron Buxbaum):** carry each leftover forward once by default; staff may dismiss a row independently; save the choice immediately and offer Undo; closing the day no longer owns those decisions, and the append-only close-out snapshot remains the record of what was outstanding. **Superseded 2026-10-05 (Aaron Buxbaum):** the "Close the day" act, its record and the leftovers list were removed; the evening is the settled stations and the takings.

Part of the [human decision log](README.md#decision-register).
