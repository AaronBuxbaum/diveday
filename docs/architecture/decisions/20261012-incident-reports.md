# 20261012-incident-reports — Keep an incident report on the departure, filed once and amended by addenda

- **Status:** Accepted (2026-10-12)
- **Date:** 2026-10-12

## Context

After something goes wrong on a dive day an insurer asks for the shop's own account. The departure log ([20260804-incident-export-owner-gate](20260804-incident-export-owner-gate.md))
prints recorded facts and judges nothing; it has no place for that narrative. Approved 2026-10-12
(batch 4, E2). The report holds personal and medical data, so its
access, export, retention and erasure are decided here.

## Decision

- **One report per incident, on a departure** (`incident_reports.trip_id`). People involved are
  `incident_report_people` rows: a diver by booking, a staffer by person, or an outsider by a
  free-text name, each tagged `affected`, `witness` or `responder`.
- **Fields:** when (an instant, entered in the shop's zone), where (a dive site or free text), what
  happened, first aid, oxygen and its minutes, emergency services called, the handover (EMS,
  hospital, chamber, the person themselves, or other, with detail and time), and follow-up. The
  yes/no answers stay null until answered, so "no" is never assumed.
- **Lifecycle:** a draft can be edited by its author or an owner or manager. Filing needs the time,
  what happened and the three yes/no answers, and is refused without them. A filed report is never
  updated; later facts are `incident_report_addenda` rows, dated and attributed. Filing and each
  addendum write an activity line naming the actor only.
- **Access:** owners and managers read every report. A staffer on the departure's crew may start
  one and reads only reports they started. Every read and write checks live roles. Nothing is
  diver-facing.
- **A record, not a gate.** No readiness, roll-call, booking or close-out path reads these tables.
- **Export:** three files in the shop bundle, beside `waiver_records.csv`. The diver's own bundle
  leaves them out (H-109).
- **Retention:** 7 years from the incident (`RETENTION_DAYS.incident_reports`, 2555 days); people
  and addenda go with the report by cascade.
- **Erasure:** `anonymizeDiver` keeps the report. The diver's links survive with the erased name,
  an outsider row with their name is redacted, and every word-boundary match of their name in the
  narrative fields and addenda becomes `[redacted]`. A filed report changes only through this.
  The trade-off is H-109.
- **Safety tab:** an owner/manager tab beside Reports reads the month's existing records and
  lists its reports.

## Alternatives considered

- **Free-text notes on the departure** — no filing moment, and no shape an insurer can rely on.
- **Edit a filed report in place** — an account changed after the fact is worth less as evidence.
- **Delete the report on erasure** — loses the shop's liability record for the other people in it.
- **Owner-only like the departure log** — the crew who were there write the first account.

## Consequences

The report survives a diver's erasure with their identity removed. Name matching misses a nickname
or a first name alone; H-109 states that residual. Revisit if counsel asks for a different
retention period or full redaction on erasure.
