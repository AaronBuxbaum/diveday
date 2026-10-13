# H-112: How long is an incident report kept?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**How long does DiveDay keep an incident report?** The report (ADR [20261012-incident-reports](../../architecture/decisions/20261012-incident-reports.md)) shipped with a seven-year window from the incident, measured like the money ledger, while roll call, the record of who was on the boat, is kept for ever. A seven-year window deleted reports naming a minor, whose limitation period can run from their eighteenth birthday, and reports with an EMS, hospital or chamber handover, the ones a claim is most likely to reach for. The options:

- **(a) Keep every report for ever**, like roll call.
- **(b) Keep seven years, but never prune a report that names a minor or records an EMS, hospital or chamber handover.**

## Minimum outcome to record

Which option.

## Outcome

**Decided 2026-10-13 (Product owner: Aaron Buxbaum, in the project thread):** (a). Incident reports are kept for ever.

- `incident_reports`, `incident_report_people` and `incident_report_addenda` are in `UNBOUNDED_BY_DECISION` (`src/lib/retention.ts`), argued beside roll call. `RETENTION_DAYS` has no window for them and `src/db/retention.ts` no arm, so no prune pass deletes one.
- **Erasure is unchanged** ([H-111](H-111-incident-report-erasure.md)): `anonymizeDiver` still removes a named diver's identity from a kept report, at once.

Recorded as an amendment on [20261012-incident-reports](../../architecture/decisions/20261012-incident-reports.md) and in the kept-for-ever list of [20260803-append-only-retention](../../architecture/decisions/20260803-append-only-retention.md); the glossary's **Incident report** entry states it.

## Unblocks / follow-up

None. A per-report legal hold for an open claim is H-111's question, not this one.

Part of the [human decision log](README.md#decision-register).
