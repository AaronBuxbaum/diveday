# H-160: Is a site change ledgered on the diver's thread?

- **Status:** Implemented
- **Human owner:** Aaron Buxbaum

## Decision or approval needed

**The diver's "Planned sites" row lost its source chip in the 2026-10-24 visual review (B21), and a site change was not a change-ledger kind** (issue #3060). A crew that moved the day from Molasses Reef to Pickles Reef at 06:40 left the diver's page showing the new reef with no "What changed" line. The options were (a) leave it, the label carrying the provenance, or (b) ledger it.

## Decision

**Decided 2026-10-25 (Aaron Buxbaum, on the decision card in the visual review thread): ledger it.** Option (b).

## What ships

`trip_change_event_kind` gains `site_change`. Its snapshot is the day's run of sites as the diver reads them, by public name (`tripSitesSnapshot`, `src/lib/trip-change-events.ts`). The trip editor and a run's apply-to-every-date write it in the same transaction that changes the dives, only when the run reads differently, naming who made the change and when. The diver's "What changed" reads "Sites: Pickles Reef" over "Changed by the shop on …" in en-US and es-ES. The glossary's *Change ledger* and rule 5 of ADR 20260904-reef-all-the-way-down say the same.

## Unblocks / follow-up

Closes #3060.

Part of the [human decision log](README.md#decision-register).
