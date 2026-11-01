# 20261012-incident-reports — Keep an incident report on the departure, filed once and amended by addenda

- **Status:** Accepted (2026-10-12); amended by [20261014-incident-kind-severity](20261014-incident-kind-severity.md) and [20261016-incident-drafts](20261016-incident-drafts.md)
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
  happened, first aid, oxygen and its minutes, emergency services, the handover (none, EMS,
  hospital, chamber, themselves, other; with detail and time), and follow-up. Every answer stays
  null until given, so "no" and "nobody took over" are never assumed.
- **Lifecycle:** its author or an owner or manager edits the draft. Filing needs the time, the
  place, what happened, the three yes/no answers, and the handover once EMS or oxygen was
  involved; the database checks the same. A filed report is never updated; later facts are dated,
  attributed `incident_report_addenda`. Filing and each addendum log the actor only.
- **Access:** owners and managers read every report. The departure's crew may start one and read
  their own; staff ashore cannot start one, a manager does. Every read and write checks live
  roles. Nothing is diver-facing.
- **A record, not a gate.** No readiness, roll-call, booking or close-out path reads these tables.
- **Export:** three files in the shop bundle, beside `waiver_records.csv`. The diver's own bundle
  leaves them out (H-111).
- **Retention:** 7 years from the incident (2555 days); people and addenda cascade.
- **Erasure:** `anonymizeDiver` keeps the report. The diver's links survive with the erased name
  and an outsider row with their name is redacted. The narrative fields and addenda are staff
  prose and stay verbatim (owner, 2026-11-01; H-111). A filed report changes only through the
  outsider row.
- **Safety page:** an owner/manager destination at `/safety` reads the month's records and lists
  its reports.

## Alternatives considered

- **Free-text notes on the departure** — no filing moment, and no shape an insurer can rely on.
- **Edit a filed report in place** — an account changed after the fact is worth less as evidence.
- **Delete the report on erasure** — loses the shop's liability record for the other people in it.
- **Owner-only like the departure log** — the crew who were there write the first account.

## Consequences

The report survives a diver's erasure with their record unlinked; words staff wrote stay (H-111). Revisit if counsel asks for a different
retention period or full redaction on erasure.
