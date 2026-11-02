# H-20261013-incident-report-retention: How long is an incident report kept?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**How long does DiveDay keep an incident report?** The report (ADR [20261012-incident-reports](../../architecture/decisions/20261012-incident-reports.md)) shipped with a seven-year window from the incident, measured like the money ledger, while roll call, the record of who was on the boat, is kept for ever. A seven-year window can delete a report naming a minor, whose limitation period can run from their eighteenth birthday, and a report with an EMS, hospital or chamber handover, the kind a claim is most likely to reach for. The options:

- **(a) Keep every report for ever**, like roll call.
- **(b) Keep seven years**, as shipped.

## Minimum outcome to record

Which option.

## Outcome

**Decided 2026-10-13 (Product owner: Aaron Buxbaum, in the project thread):** (b). The seven-year window is kept. Unbounded retention was built and considered the same day (PR #2529), then reversed: "I like the prior retention policy."

- `RETENTION_DAYS.incident_reports` (2555 days, `src/lib/retention.ts`) and its prune arm in `src/db/retention.ts` stay as ADR [20261012-incident-reports](../../architecture/decisions/20261012-incident-reports.md) set them; the report's people and addenda go with it by cascade.
- **Erasure is unchanged** ([H-20261013-incident-report-erasure](H-20261013-incident-report-erasure.md)): `anonymizeDiver` removes a named diver's identity from a kept report at once, and the seven-year window ends what name matching misses.
- The privacy page says it in `privacy.keep.safety`.

## Unblocks / follow-up

None. A per-report legal hold for an open claim is H-20261013-incident-report-erasure's question, not this one.

Part of the [human decision log](README.md#decision-register).
