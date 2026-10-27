# 20261027-boarding-certification-evidence — Boarding certification evidence

- **Status:** Accepted (2026-10-27)
- **Date:** 2026-10-27

## Context

The departure log mixed a historical release with certification cards read today. Card reviews can
be overwritten, so their prior state cannot be reconstructed reliably. The owner chose to label
historical evidence unavailable, show current cards separately, and capture future boardings.

## Decision

A live departure boarding captures the shop's current card facts in the same database statement
that writes its roll-call event. An empty array is evidence that no cards were captured; null means
the evidence is unavailable. Historical and offline boardings have no such capture: a later sync
cannot know what the device saw. A correction uses only the standing departure mark's capture.
Identity-held seats show no card evidence. Erasure removes a diver's capture and a reviewer's name;
a person merge repoints the reviewer identity while preserving the name recorded at the time.

The log prints current cards separately and does not treat them as historical facts. Integrity code
version 3 seals the boarding capture (including unavailability), but not current cards. Versions 1
and 2 keep their prior recipes and cannot seal a log containing a boarding capture. A captured card
set records the database facts when boarding was written; it does not assert what an earlier
readiness calculation saw or determine safety.

## Alternatives considered

- Reconstruct prior reviews from today's rows: overwritten values make this unreliable.
- Capture on offline sync: that records later server state, not the earlier boarding.
- Seal current cards: later edits would change the code for an unchanged departure.

## Consequences

Old and offline records remain visibly incomplete. Captures duplicate sensitive card identifiers,
so they participate in export, erasure, retention and tenant scoping. Revisit offline capture if a
proven device-side evidence record can preserve the observed facts and its provenance.
