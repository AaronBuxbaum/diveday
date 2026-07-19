# 20260718-offline-manifest-snapshots — Use encrypted device snapshots and explicit roll-call reconciliation

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

Captains lose service at marinas and offshore, but roll call must still work before departure and
after every dive. The live-first manifest deliberately deferred offline use until freshness,
private-data retention, conflict handling, and failure behavior were explicit. A manifest contains
emergency contacts and safety evidence, so caching a rendered authenticated page or silently
pretending stale data is current is unacceptable.

## Decision

Keep the server manifest derived from current bookings and the shared fail-closed readiness result.
Offline use is an explicit device action: staff saves a versioned snapshot into IndexedDB, encrypted
with a non-exportable device-local AES-GCM key. A service worker caches only the data-free offline
shell and its same-origin static assets; it never caches an authenticated manifest response.

Every snapshot displays its saved time and one of three freshness states: current (up to 15
minutes), aging (up to four hours), or stale. Stale snapshots remain usable because a boat may be
offline for a full operating day, but only a diver recorded as ready in that snapshot may be marked
boarded. Not-boarded remains available for every diver. Device copies expire at the earlier of 14
days after saving or seven days after the trip ends, and staff can delete them immediately.

Offline roll-call changes are encrypted in the same device record and remain visibly pending until
reconnection. Each change has a client UUID, snapshot saved time, device occurrence time, and
offline source marker. The server applies changes idempotently, re-checks tenant, staff, booking,
trip, and current readiness, and rejects an older device event when a newer server event exists.
Rejected events stay visible as conflicts; they never silently overwrite the live manifest.

Threat/failure boundary:

- encryption reduces exposure from copied browser storage, but cannot protect an unlocked device
  or an active same-origin script compromise;
- clearing site data, private browsing eviction, browser quota pressure, or device loss can remove
  the snapshot, so print/PDF remains the independent fallback;
- offline readiness is evidence as saved, not a claim that no server-side fact changed;
- service-worker failure never changes the live manifest or server audit trail.

## Alternatives considered

- **Cache authenticated HTML** — risks persisting private manifest responses and couples safety data
  to framework cache behavior.
- **Unencrypted local storage** — easy to inspect and copy, with no acceptable private-data boundary.
- **Last write wins on reconnect** — a delayed device event could erase a newer dock-side decision.
- **Disable stale roll call** — makes after-dive head counts fail during the exact extended outage
  offline mode exists to handle.
- **Editable offline roster** — would create a second source of truth and let people disappear.

## Consequences

Offline mode remains an explicit, inspectable safety tool rather than invisible caching. It adds a
small browser storage module, an offline shell, a service worker, idempotency fields on roll-call
events, and conflict tests. The first release intentionally has no cross-device snapshot transfer or
background-sync dependency. Revisit the retention window and freshness thresholds after dock and
boat field tests; changing them is a policy update, while changing the encrypted record version
requires a migration or deliberate device-cache reset.
