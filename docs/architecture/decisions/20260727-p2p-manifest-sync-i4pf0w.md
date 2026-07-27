# 20260727-p2p-manifest-sync-i4pf0w — Use QR-paired WebRTC data channels for offline phone-to-phone manifest sync

- **Status:** Proposed
- **Date:** 2026-07-27

## Context

Staff on the same boat each carry their own offline manifest snapshot (encrypted IndexedDB,
`src/lib/offline-manifest-store.ts`), but today a device only syncs to the server
(`POST /api/offline-manifests/sync`). Two phones that are both offline — the common case
offshore or at a marina with no signal — cannot see each other's roll-call taps until whichever
one reconnects first. ADR
[20260718-offline-manifest-snapshots](20260718-offline-manifest-snapshots.md) explicitly deferred
"cross-device snapshot transfer" pending this design.

DiveDay is a PWA with no native wrapper (`public/manifest-sw.js`, no Capacitor/React Native), which
rules out Web Bluetooth (unsupported in iOS Safari) and Web NFC (Android-only) as transports.

The existing offline event model is already merge-friendly: each roll-call change is an immutable
`OfflineRollCallEvent` (`src/lib/offline-manifests.ts`) keyed by `clientEventId`, and
`recordRollCall`/the sync route already apply events idempotently and reject a stale event when a
newer one exists per checkpoint. A peer-merge path can reuse that exact rule instead of inventing
new conflict semantics.

Manual export/import (hand off a signed JSON blob between devices) was considered as a cheaper
first step and rejected by product: it doesn't address the actual need, which is near-real-time
roll-call visibility across the boat crew during boarding and after each dive, not an occasional
manual file exchange.

## Decision

Build phone-to-phone sync as: **QR-paired WebRTC data channels**, feeding the same event-log merge
rule the server already enforces, with the server remaining the sole authority.

- **Transport** — `RTCDataChannel` (DTLS-encrypted in transit).
- **Pairing/rendezvous** — no signaling server is assumed reachable offline, so pairing is manual
  and local: one device renders a QR code encoding its SDP offer plus a short-lived (~2 minute)
  signed pairing token (shop id, trip id, staff person id, expiry). The peer scans it with the
  device camera, generates an SDP answer, and hands it back via a second QR. The pairing token
  scopes the connection to one shop and trip so a stale or mis-scanned QR can't join a foreign
  session.
- **Sync protocol** — once connected, each side sends its `OfflineRollCallEvent[]` for the shared
  trip, same shape as the existing sync endpoint's request body. The receiver unions events by
  `clientEventId` and applies the same "newest `occurredAt` wins per checkpoint, older is rejected"
  rule `recordRollCall` already enforces server-side, then merges the result into its own encrypted
  envelope through the existing `withManifestLock` path in `offline-manifest-store.ts`.
- **Server stays authoritative** — P2P only propagates the pending-event queue faster between
  devices before either regains connectivity. It does not change `recordRollCall`'s tenant/staff/
  booking/trip validation or the sync endpoint's idempotency. An event stays visibly `pending`
  regardless of whether it arrived locally or via a peer, until the server round trip actually
  applies or rejects it — no UI ever presents a peer-relayed event as boarding-confirmed on its own
  say-so.
- **New module** — pairing and `RTCDataChannel` plumbing live in a new
  `src/lib/offline-manifest-p2p.ts`, kept separate from `offline-manifest-store.ts` so the store
  stays unit-testable without a browser WebRTC stack. The merge rule itself is pure and belongs in
  `src/lib/offline-manifests.ts` alongside the existing reconciliation helpers, so it is testable
  without a real peer connection.

## Alternatives considered

- **Manual export/import** — rejected: doesn't solve near-real-time visibility, just adds a
  workflow nobody would reach for mid-boarding.
- **Web Bluetooth** — rejected: no iOS Safari support, and DiveDay has no native wrapper to fall
  back on.
- **Local Wi-Fi mDNS/Bonjour auto-discovery** — rejected: no browser API for it; still requires a
  rendezvous step, so it buys nothing over explicit QR pairing while adding real complexity.
- **Server-relayed WebRTC signaling** — rejected as the primary path: requires connectivity on at
  least one side at pairing time, which defeats the point for two fully-offline boat phones.
- **Server push between staff devices instead of P2P** — rejected: still requires both ends to
  reach the server, so it doesn't address the offline-boat case at all.

## Consequences

Closes the gap ADR 20260718 deferred: staff phones on the same boat can see each other's roll-call
taps without connectivity. Adds a new client-side dependency surface (WebRTC pairing, QR
render/scan) and a new safety-relevant merge path, so it needs a `dive-domain-expert` and
`security-reviewer` review before merge per AGENTS.md, plus explicit tests for: a QR scanned from
the wrong trip/shop, an expired pairing token, a connection dropped mid-transfer, and two devices
both pairing to a third at once.

Revisit if field testing shows QR pairing is impractical dockside (gloves, wet screens, glare) —
the escape hatch is falling back to server-relayed signaling once either device has a connectivity
window, at the cost of losing the fully-offline pairing property. If this needs to be pulled out
entirely, the blast radius is contained to `offline-manifest-p2p.ts` and its call sites in the
offline manifest UI; the event log and server reconciliation it builds on are unchanged and already
shipped.
