# 20261015-incident-draft-discard-and-hold — An owner may delete an unfiled incident draft, and hold a report past its window

- **Status:** Accepted (2026-10-15)
- **Date:** 2026-10-15

## Context

Amends [20261012-incident-reports](20261012-incident-reports.md). A draft started on the wrong
departure had no way out, and a report tied to an open claim would be pruned at seven years
([H-112](../../product/human-decisions/H-112-incident-report-retention.md) kept the window).
Aaron decided both on 2026-10-13 (issues #2391, #2530): an owner-only soft Delete of an unfiled
draft, and an owner-set hold that retention skips.

## Decision

- **Discard:** `discardIncidentDraft` sets `incident_reports.deleted_at`. Owner only: not the
  draft's author, not a manager. It refuses a filed report (the database refuses too:
  `incident_reports_only_a_draft_is_discarded`) and a held one. Every live read and write skips a
  discarded row; the seven-year prune still takes it. The departure's trail says who, never what.
- **Hold:** `setIncidentLegalHold` sets or clears `incident_reports.legal_hold_at`, owner only.
  The prune arm skips a held report; a held report cannot be discarded
  (`incident_reports_a_held_report_is_kept`). The page offers it on a filed report.

## Alternatives considered

- **Hard delete of the draft** — breaks "every delete is soft" and leaves no trace of who.
- **Owner or manager may discard** — the issue's triage brief; Aaron's comment says owner only.
- **A hold date (`held_until`)** — a second date to forget; a flag an owner releases is simpler.

## Consequences

A discarded draft's words stay in the table until its window ends. Revisit if counsel wants a
discarded draft erased at once.
