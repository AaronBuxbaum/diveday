# 20261112-roll-call-observes-evidence — Resolve roll-call conflicts from observed evidence

- **Status:** Proposed
- **Date:** 2026-11-12

## Context

[Issue #4418](https://github.com/AaronBuxbaum/diveday/issues/4418) reproduces fast-clock aboard evidence hiding missing evidence and slow-clock missing evidence being refused. Network offsets also fail: an accurately timed aboard request can arrive after a missing report. Aaron authorized automatic compatible merges and explicit reconciliation for actual conflicts. A sticky alarm would violate [offline correction](20260815-offline-can-unsay-a-missing-diver.md).

## Decision

Statements have stable identity and the frontier observed at tap, including queued local statements. Client and server UUIDs use separate namespaces. Receipt, capture clocks and retries never establish observation. Observed corrections supersede validated causal ancestors. Compatible concurrent statements merge automatically. Opposing evidence persists until a deliberate crew reconciliation names it; ordinary taps cannot reconcile an existing conflict. Stale reconciliation cannot erase unseen evidence.

The shared projection separates risk status from conflict. After-dive missing evidence remains visible. Opposing dock evidence cannot grant an ashore exemption. Conflict independently holds completeness and homecoming open. Original status, note and recorder remain immutable. `capture_context` retains supplied device time, selected day and undo target; `occurred_at` remains the first stored instant, possibly capped. Neither clock establishes chronology; an aboard reporter is never attributed missing. Snapshots retain validated ancestry so lost acknowledgements cannot create spurious conflicts. Sync refreshes the full signed roster before settling queued IDs; a failed refresh preserves pending evidence.

Absent context proves no observation. Snapshot authorization ignores device clocks. Compatible legacy evidence merges; opposed opaque evidence visibly requires ordering-unknown reconciliation. Validated retained retractions remove precisely their named target. Scope includes tenant, subject, checkpoint and explicit meeting day. Retained multi-day evidence with no trusted day stays in an unknown-day bucket: missing remains visible until named reconciliation, while unknown-day positive evidence cannot establish today's attendance. Multi-day offline copies display an explicit calendar-day choice, captured at tap independently of device clocks.

Materialize projections transactionally before INSERT, then refresh affected scopes under the trip lock. Required original-status/frontier columns have no defaults. Generate schema changes normally. Supported generated-empty custom DML initializes conservative retained projections and derived namespaces without rewriting originals, transactionally and repeatably. Untargeted withdrawals keep exemptions awaiting, preserve genuine missing and unwithdrawn plan-floor evidence; compatible observed confirmation settles uncertainty without conflict reconciliation.

Rename the legacy SQL status column to fence old readers/writers. Snapshot and sync require the causal protocol capability; refusal preserves encrypted queues. Do not bump their record version or purge ambiguous evidence. Fully disconnected old cached code cannot be remotely upgraded: cutover requires crew to upgrade connected clients before relying on current roll call. No rolling compatibility claim covers those caches.

## Alternatives considered

Timestamp ordering, network offsets and receive-time observation invent chronology. Always preferring missing prevents correction. Discarding older evidence evades ambiguity. Additive conflict fields alone leave old readers unsafe.

## Consequences

Every operational reader must honor the same projection and independent conflict flag. Exports preserve raw attribution. Legacy ambiguities can require one explicit reconciliation. Field rehearsal must verify crew comprehension; preserve identities, original evidence and exact retractions.
