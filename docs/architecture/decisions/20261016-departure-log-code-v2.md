# 20261016-departure-log-code-v2 — The departure log's integrity code, version 2

- **Status:** Accepted (2026-10-16)
- **Date:** 2026-10-16

## Context

The departure log prints a SHA-256 integrity code over its facts; regenerating it from unchanged
records must reproduce the code. The safety sheet of 2026-10-15 added incident reports and late
seat changes, so the recipe gained a version. The 2026-10-16 reviews found that the code sealed
when and for whom the log was made (the page builds it as it is read, so no two copies matched),
that time-dependent evidence moved with the print date, and that version 1 could seal a log
missing the new facts. Precedent: [20260802-diver-data-erasure](20260802-diver-data-erasure.md).

## Decision

- **Version 1** is the recipe of every log printed before this change ships: header (with when
  and for whom), roster, crew, timeline without seat lines, dives, checklist.
- **Version 1 is refused for a log holding what version 2 added**: a seat or crew line from when
  the boat was due out, an incident report, or a timeline line later than its own `generatedAt`
  (which closes a backdated `generatedAt`). There is no cutover date.
- **Version 2** adds the seat and crew lines, the incident-report list and `hashVersion: 2`, and
  **leaves out `generatedAt` and `generatedByName`**, which are printed but not sealed. Row ids,
  `currentRatings` and report ids stay out.
- **Time-dependent evidence is stated as of when the boat was due out**: which waiver governs,
  and whether it has lapsed.
- **"Due out"** is the scheduled start, or the first departure roll-call mark if earlier.
- **A roster line is printed only when it names its subject by record**: `subject_person_id`, or
  the seat's `booking_id`, so erasure reaches it from whoever holds the seat now. An erased line
  is printed naming nobody.

## Alternatives considered

- **Seal the generation time and store each printed copy.** A document store and a verification
  page; the owner's "check a printed code" page is a follow-up.
- **Bump to version 3.** Version 2 has not shipped.
- **Let version 1 answer for any log.** It would seal a document missing its late seat changes.
- **Refuse version 1 from a fixed date.** The main branch prints version 1 until this ships, so a
  date refuses genuine printouts, and a backdated `generatedAt` walks past it.

## Consequences

Two copies of one log, printed by different people on different days, carry the same code while
the records are unchanged. The printed time and name are provenance, not evidence. A version-1
printout reproduces unless the departure has since gained a late seat or crew line or a report
(refused), or a waiver lapsed between due-out and that printing (the old log stated it as of the
printing). DiveDay is pre-pilot (H-20260815-no-legacy), so no such printout exists outside a demo.
