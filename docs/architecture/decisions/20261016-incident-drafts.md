# 20261016-incident-drafts — Reuse an incident draft only when it is the same incident

- **Status:** Accepted (2026-10-16)
- **Date:** 2026-10-16

## Context

Amends [20261012-incident-reports](20261012-incident-reports.md) ("one report per incident"). The
safety sheet of 2026-10-15 (items 2 and 3) made "Report an incident" reopen the writer's open draft
and added "Start a missing diver report" to a manifest row marked not back aboard. Both domain
reviews of 2026-10-16 found the reuse too wide: a missing diver was folded into the writer's
injury draft, a writer with one open draft could never start a second report, and two crew tapping
for the same missing diver made two reports.

## Decision

- **"Report an incident" reuses only an untouched draft**: the writer's own unfiled draft on that
  departure with every answer null and nobody named. Anything else is a different incident, so a
  new draft is inserted. Somebody else's draft is never handed over.
- **"Start a missing diver report" is one report per missing person.** It reuses an unfiled draft
  of kind Missing diver on that departure that already names that seat (or that crew member),
  whoever started it. Its writer, an owner or a manager is given it; anyone else is told "Already
  started by {name}", with none of its contents and no second draft. Otherwise it inserts a new
  draft of kind Missing diver, timed at the earliest standing "not back aboard" mark, naming the
  person as affected. It never fills in the writer's other draft.
- **Missing crew get the same button**, read from the crew roll call, the staffer named as
  affected.
- Both starts are race-safe by a transaction-scoped advisory lock: on (departure, writer) for the
  first, on (departure, missing person) for the second.

## Alternatives considered

- **Reuse any open draft by the writer** — merged unrelated incidents; the cause of this record.
- **Let each crew member hold their own missing-diver draft** — two accounts of one disappearance,
  neither complete, both in the insurer's list.
- **Show the second crew member the first's draft** — widens who reads a report beyond its writer,
  owners and managers.

## Consequences

A writer can now hold several unfiled drafts on one departure, so an abandoned one needs a way
out; the departure log and Today list each unfiled draft until it is filed. A second crew member
learns that a report exists and who started it, which is the one fact they need to stop writing
a duplicate. Revisit if shops ask for a shared, co-written report.
