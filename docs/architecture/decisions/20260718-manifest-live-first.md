# 20260718-manifest-live-first — Keep the first boat manifest live, derived, and append-only

- **Status:** Superseded by 20260718-offline-manifest-snapshots
- **Date:** 2026-07-18

## Context

M6 turns bookings, readiness, crew, and gear into a safety-critical boat manifest. A second
editable roster would drift from the source systems and can make a blocked or booked diver vanish
at the worst moment. Offline use is a real dock requirement, but pretending that server-rendered
data is cached would create a more dangerous failure mode than an explicit live-only limitation.

## Decision

Derive the first manifest from every active booking plus the shared fail-closed readiness result,
current gear assignments, and crew assignments. Missing readiness is rendered as a typed blocker,
never omitted. Keep roll-call updates as append-only, tenant-scoped events with recorder and time;
only a currently ready diver may receive a `boarded` event. The user interface explicitly says it
is live and online, offers browser print/save-PDF from that same derived view, and does not claim
offline support.

## Alternatives considered

- **Editable manifest table** — duplicates booking data and makes accidental divergence likely.
- **Browser-local snapshot now** — adds stale-data and reconciliation policy before an explicit
  freshness model, conflict behavior, or field test exists.
- **Mutable current boarding flag only** — loses the audit history needed after an operational
  question or incident.

## Consequences

The initial feature remains small, testable in PGlite, and honest about its network requirement;
print/PDF uses the exact model staff see on screen. Offline capability requires a follow-up ADR
covering snapshot freshness, cache encryption/retention, reconciliation conflicts, and outdoor
field testing. If roll call later needs per-dive checkpoints, add a leg/dive identifier to the
append-only event model rather than overwriting the current events.

Superseded by
[20260718-offline-manifest-snapshots](20260718-offline-manifest-snapshots.md), which keeps the
derived and append-only invariants while adding explicit encrypted snapshots and reconciliation.
