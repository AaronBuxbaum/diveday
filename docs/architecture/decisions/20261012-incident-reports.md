# 20261012-incident-reports — Keep an incident report on the departure, filed once and amended by addenda

- **Status:** Accepted (2026-10-12)
- **Date:** 2026-10-12

## Context

After something goes wrong on a dive day an insurer asks for the shop's own account: when, where,
what happened, the first aid and oxygen given, whether emergency services came, and who took the
person over. The departure log ([20260804-incident-export-owner-gate](20260804-incident-export-owner-gate.md))
prints recorded facts and judges nothing; it has no place for that narrative. Aaron approved the
incident report on 2026-10-12 (batch 4, E2). The report holds personal and medical data, so its
access, export, retention and erasure are decided here.

## Decision

- **One report per incident, on a departure** (`incident_reports.trip_id`). People involved are
  `incident_report_people` rows: a diver by booking, a staffer by person, or an outsider by a
  free-text name, each tagged `affected`, `witness` or `responder`.
- **Fields:** when (stored as an instant, entered and shown in the shop's zone), where (one of the
  shop's dive sites or free text), what happened, first aid given, oxygen given and for how many
  minutes, whether emergency services were called, the handover (EMS, hospital, chamber, the
  person themselves, or other, with a free-text detail and a time), and follow-up notes. The three
  yes/no answers stay null until answered, so "no" is never assumed.
- **Lifecycle:** a draft can be edited by its author or an owner or manager. Filing needs the time,
  what happened and the three yes/no answers, and is refused without them. A filed report is never
  updated; later facts are `incident_report_addenda` rows, dated and attributed. Filing and each
  addendum write an activity line (`incident_report_filed`, `incident_report_addendum_added`) that
  names the actor only.
- **Access:** owners and managers read every report. A staffer on the departure's crew may start
  one and reads only reports they started. Each read and write checks the live roles, as every
  other gate does. Nothing is diver-facing.
- **A record, not a gate.** No readiness, roll-call, booking or close-out path reads these tables.
- **Export:** three files in the shop bundle, beside `waiver_records.csv`. The diver's own bundle
  leaves them out (H-109).
- **Retention:** 7 years from the incident (`RETENTION_DAYS.incident_reports`, 2555 days); people
  and addenda go with the report by cascade.
- **Erasure:** `anonymizeDiver` keeps the report. The diver's links survive with the erased name,
  an outsider row with their name is redacted, and every word-boundary match of their name in the
  narrative fields and addenda becomes `[redacted]`. A filed report changes only through this.
  The trade-off is H-109.
- **Safety tab:** an owner/manager tab beside Reports reads existing records for the month and
  lists the reports filed. It adds no tracking of its own.

## Alternatives considered

- **Free-text notes on the departure** — no filing moment, and no shape an insurer can rely on.
- **Edit a filed report in place** — an account changed after the fact is worth less as evidence.
- **Delete the report on erasure** — loses the shop's liability record for the other people in it.
- **Owner-only like the departure log** — the crew who were there write the first account.

## Consequences

The report is portable and survives a diver's erasure with that diver's identity removed. Name
matching misses a nickname or a first name alone; the narrative is the shop's own words, so the
residual is stated in H-109 rather than closed by a broader sweep. Revisit if counsel asks for a
different retention period or for full redaction on erasure: both are one window or one sweep.
