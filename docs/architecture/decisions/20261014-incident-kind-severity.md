# 20261014-incident-kind-severity — An incident report files with a kind and a severity

- **Status:** Accepted (2026-10-14)
- **Date:** 2026-10-14

## Context

Amends [20261012-incident-reports](20261012-incident-reports.md). Approved in batch 6 (item 7). A
shop sorting its reports, and an insurer reading one, first asks what sort of thing happened and
how bad it was. The narrative answers both, but not in a shape a list can show.

## Decision

- **Two closed enums on the report:** `incident_reports.kind` (`injury`, `near_miss`,
  `equipment`, `missing_diver`, `fatality`, `other`) and `incident_reports.severity` (`minor`,
  `moderate`, `serious`). `injury` reads "Injury or illness": decompression sickness, a
  seasick faint and a cut hand are the same kind of report. A death is its own kind, never
  "injury, serious": an insurer, a coastguard and a training agency each ask for it first, and
  a list has to be able to find it (dive-domain review 2026-10-14). Both stay null on a draft until chosen, like every other answer, and **filing needs
  both** (`incidentFilingGaps`, checked in the filing transaction).
- **The database's filed check is unchanged**, so a report filed before this stays valid without
  a guessed backfill of its kind.
- **Shown** on the report and its draft form, and on the Reports **Safety** tab (the kind in
  words, the severity as a badge: minor neutral, moderate warning, serious danger). Exported as two
  columns of `incident_reports.csv`.
- **Still a record, not a gate.** Readiness, roll call, booking and close-out never read either
  value, and "serious" alerts nobody. A severity is the writer's judgment, not a medical
  classification.

## Alternatives considered

- **Free tags** — no list can sort or count on them.
- **A severity inferred from the answers** (oxygen, EMS, handover) — it would call oxygen given as
  a precaution serious and a missing diver found in five minutes minor; the crew know better.

## Consequences

A report filed before 2026-10-14 keeps no kind or severity: its record says "not written" and the
Safety tab shows it without a badge. An addendum can say what it was; the fields stay empty.
