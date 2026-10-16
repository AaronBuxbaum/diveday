# 20261016-departure-log-code-v2 — The departure log's integrity code, version 2

- **Status:** Accepted (2026-10-16)
- **Date:** 2026-10-16

## Context

The departure log prints a SHA-256 integrity code over its facts, and the footer promises that
regenerating it from unchanged records reproduces the code. The safety sheet of 2026-10-15 added
incident reports and late seat changes to the log, so their recipe changed and the code gained a
version. The claims-auditor review of 2026-10-16 found two faults. The code sealed when the log
was made and who made it, but the page builds the log as it is read, so no two copies ever
matched. And a version-1 code could be asked for a log made after the change, sealing a
document without its seat changes and reports. Precedent for a versioned seal:
[20260802-diver-data-erasure](20260802-diver-data-erasure.md) (waiver integrity v2).

## Decision

- **Version 1** is the recipe of every log printed before 2026-10-16. It covers the header
  (with when and for whom), the roster, the crew, the timeline without seat lines, the dives and
  the checklist. A fresh export asked for version 1 still reproduces an old printout's code.
- **Version 1 is refused from the cutover on**: `incidentExportContentHash` throws for a log whose
  `generatedAt` is at or after `INCIDENT_EXPORT_V2_CUTOVER`, 2026-10-16T00:00:00Z.
- **Version 2** is everything above plus:
  - the seat and crew lines from when the boat was due out;
  - the incident-report list;
  - `hashVersion: 2`, so no version-2 code passes for a version-1 one.

  It **leaves out `generatedAt` and `generatedByName`**. Both are still printed; neither is sealed.
  Row ids, `currentRatings` and report ids stay out, as before.
- **"Due out"** is the scheduled start, or the first departure roll-call mark if that came first.
- **A roster line is printed only when it names its subject by record**
  (`activity_events.subject_person_id`). A line erased at a person's request is printed as one that
  names nobody.

## Alternatives considered

- **Seal the generation time and store each printed copy** to verify against. That is a document
  store and a verification page. The owner's "check a printed code" page is a follow-up.
- **Bump to version 3 instead of changing version 2.** Version 2 has not shipped, and no printout
  carries it.
- **Let version 1 answer for any log.** It would seal a document missing its late seat changes,
  which is the fault this record exists to stop.

## Consequences

Two copies of one departure's log, printed by different people on different days, now carry the
same code while the records are unchanged. A printed time or name can be edited without changing
the code; those two lines are provenance, not evidence. A log printed between 2026-10-16 and this
change's release, if any, was sealed with version 2 including the generation time, and will not
reproduce. DiveDay is pre-pilot (H-49), so none exists outside a demo.
