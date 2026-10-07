# H-62: Should Close-out remain its own destination once the home's evening reading (Clearwater slice 6d)…

- **Status:** Chosen
- **Human owner:** Product owner

## Decision or approval needed

Should Close-out remain its own destination once the home's evening reading (Clearwater slice 6d) carries its content — the per-departure head-count results, recap and log acts, leftovers, and the closing act? Part of a standing direction to reduce the number of surfaces while keeping each one's next action obvious.

## Minimum outcome to record

A yes/no on folding the `/shop/[shopSlug]/close-out` route into the home, so the design work either removes the destination or deliberately keeps two doors to one content.

## Unblocks / follow-up

**Decided fold it 2026-08-27 (Aaron Buxbaum, in session):** Close-out folds into the home's evening. One composition, not a mode switch: the day's spine settles station by station, and the closing block (leftovers with their own per-row Dismiss per H-57, then the one closing act) appears once the day's departures have ended. `/close-out` becomes a 308 to the home, the destination leaves the nav and dock, and `day_closeouts` and the log door are unchanged underneath. Designed in ADR [20260827-clearwater-surface-language](../../architecture/decisions/20260827-clearwater-surface-language.md) decision 4 and roadmap slice 6d; the concept-model table's Check-in fold remains a separate, still-open call. **Superseded 2026-10-05 (Aaron Buxbaum):** the "Close the day" act, its record and the leftovers list were removed; the evening is the settled stations and the takings.

Part of the [human decision log](README.md#decision-register).
