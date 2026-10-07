# H-49: Do we carry legacy code and legacy data forward?

- **Status:** Chosen
- **Human owner:** Product owner

## Decision or approval needed

**Do we carry legacy code and legacy data forward?** Raised 2026-08-15, working the follow-up register down: three separate entries proposed *preserving* something nobody uses. `roll_call_crew_attestations` is retired (H-46, ADR [20260804-crew-roll-call-is-per-person](../../architecture/decisions/20260804-crew-roll-call-is-per-person.md)) and its writer has no production caller at all - only tests - yet a follow-up proposed spending a migration on a `seq` column so its historical rows would sort deterministically. A second proposed a 70-day lifecycle drain so pre-split database dumps could age out rather than be abandoned. The generic question is whether an agent finding dead-but-populated machinery should preserve it, migrate it, or delete it.

## Minimum outcome to record

A stated policy, so agents stop designing compatibility paths, drains and backfills for data that has never had a user, and stop reading the absence of such a path as an oversight.

## Unblocks / follow-up

**Decided 2026-08-15 (Aaron Buxbaum): delete it. There are no current users, no data worth retaining, and no legacy code to keep.** A table nothing writes gets dropped, not carried; a code path that exists only to tolerate old rows gets deleted, not documented; a drain that exists only to age out abandoned objects gets removed rather than waited out. Do **not** write reconciliation, backfill, dual-read or version-tolerance code for pre-pilot data. This **extends H-47** from "a reset is an acceptable recovery" to "do not build the thing a reset would replace". Two limits it does **not** touch, for the same reason H-47 did not: the **destructive-migration guard** (ADR [20260806-destructive-migration-guard](../../architecture/decisions/20260806-destructive-migration-guard.md)) and the expand/contract rule stand unchanged - they exist to keep the *previous release* alive while a migration runs inside the production build, which is a deploy-time problem that having no users does not solve; a destructive migration still carries its `-- diveday:allow-destructive` line, and "pre-pilot, no users, H-49" is now a sufficient *why* on it. Nor does it touch H-02's retention windows or the erasure path, which are promises about data we *will* hold. Expires the moment the first pilot shop has real divers in the system - Aaron will say so - and whoever onboards that shop owns retiring this row.

Part of the [human decision log](README.md#decision-register).
