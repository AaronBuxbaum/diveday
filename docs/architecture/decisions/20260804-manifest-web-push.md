# 20260804-manifest-web-push — Add Web Push as a third manifest-refresh trigger, for phones that are asleep

- **Status:** Proposed
- **Date:** 2026-08-04

## Context

[20260726-manifest-push-refresh](20260726-manifest-push-refresh.md) gave the manifest two refresh
triggers: an SSE stream (primary) and a 5-minute interval plus reconnect/visibility-return listeners
(fallback). [20260804-manifest-push-transport](20260804-manifest-push-transport.md) then costed the
transport options and, in withdrawing the tab-visibility gate, named the case neither trigger covers:

> A captain walks to the boat with the phone pocketed and the page hidden. Roll-call changes land on
> shore. Then the boat leaves the bay and the signal dies.

Both existing triggers need a live page. When the OS suspends or freezes the tab — which is what a
locked phone in a pocket does — the SSE stream cannot deliver into a frozen handler and the interval
does not fire. That is not a bug to engineer around: it is the platform reclaiming resources, and no
choice of held-connection transport (SSE, WebSockets, API Gateway) changes it. **Web Push is the
platform's answer to exactly this**, because the push service wakes the service worker rather than
requiring a page.

It is also, incidentally, the cheapest transport considered: there is no persistent connection at all,
so the connection-hours that dominate 20260804-manifest-push-transport's cost analysis go to zero and
the server side becomes one HTTPS POST per actual change. That record compared ways to *hold a
connection* and did not consider not holding one; this record fills that gap.

## Decision

**Add Web Push as a third, opt-in refresh trigger. It is additive — SSE and the interval stay exactly
as they are**, and every guarantee in 20260726 continues to hold for devices that do not or cannot
subscribe.

1. **Opt-in, per trip.** A staff member on a trip's manifest can turn on "notify this device". The
   subscription is scoped to that one trip and expires with it, mirroring the SSE endpoint's per-trip
   scope (`/api/trips/[id]/manifest-events`) and keeping tenant isolation simple. Rows live in
   `push_subscriptions`, carrying `shop_id` and `trip_id`, and every read is scoped by both.
2. **Every push shows a notification, so pushes are made rare.** Chrome and Edge reject a subscription
   unless `userVisibleOnly: true`, so a silent data-sync push is not available to us. Two throttles
   keep the channel usable:
   - **Coalescing.** At most one push per subscription per 60 seconds, enforced in SQL via
     `last_pushed_at` rather than in process memory (which does not survive a serverless invocation).
     A burst of roll-call writes collapses into one notification.
   - **Only around departure.** A subscription is only pushed while its trip is within the departure
     window. `trip_starts_at` is denormalized onto the row at subscribe time, so the send path needs no
     join and a subscription for next week's trip is simply never selected.
3. **The service worker notifies; it does not write the encrypted store.** On `push` it shows the
   notification and `postMessage`s any open client, which refreshes through the existing
   `saveOfflineManifest` path. On `notificationclick` it focuses or opens the manifest.
4. **Fan-out hangs off `publishManifestEvent`**, the one seam all eight of its call sites already go
   through, so no call site re-implements the side effect. It is best-effort and never throws: a push
   failure must not fail a roll-call write.
5. **VAPID keys are environment secrets** (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).
   The public key is genuinely public and reaches the client; the private key never leaves the server.

### Why the worker does not write the store

This is the sharpest constraint and the least obvious, so it is recorded rather than left to be
rediscovered.

`src/lib/offline-manifest-store.ts` encrypts every snapshot under a **non-extractable AES-GCM
`CryptoKey` held in IndexedDB**. A service worker shares the origin, so it *could* fetch that key and
use it — the mechanism is not the obstacle. The obstacle is that `public/manifest-sw.js` is a static
file outside the Next.js build and cannot import the store module. Writing snapshots from the worker
would mean **a second implementation of the envelope format, the AAD, the versioning and the locking**,
which must then stay in lockstep with the first. The file already carries one hand-maintained
duplicate for this reason (`SHELL_VERSION`, reconciled at runtime), and that is a comment; this would
be the encryption of a safety-critical record. The manifests invariant is "offline copies are
encrypted, explicit, freshness-labeled, expiring" — resting that on two implementations that can drift
is a worse failure mode than the gap it closes.

So the division is deliberate:

| Device state | What happens |
| --- | --- |
| Page open and visible | SSE already covers it; push adds nothing |
| Page open, tab hidden, device awake | Worker `postMessage`s the client → **silent refresh**, no user action |
| Device locked or page evicted | Notification only → the captain taps → refresh happens through the normal path |

The third row is weaker than a silent background write, and honestly so: it puts a human in the loop.
For a safety surface at the moment of departure that is defensible, arguably preferable, and it is the
only behaviour available on iOS at all.

## Known gaps, from review

A `security-reviewer` and a `dive-domain-expert` pass both ran against the first implementation. What
they found and what is fixed is recorded here rather than in a PR thread, because the unfixed items
are design decisions a later implementer needs.

**Fixed in this change.** Per-send timeout and bounded fan-out concurrency, plus per-person and
per-trip row caps — without them any staff account could insert unbounded rows and turn every
"Boarded" tap into thousands of un-timed outbound requests, which is a self-inflicted denial of
service on the one write this record promises never to block. Endpoint allowlist re-checked at send
time, not only at subscribe time. `shop_id` added to the delete-by-id and locale queries.
`DIVEDAY_DISABLE_EXTERNAL_HTTP` honoured, so the e2e fleet cannot make live pushes with a committed
fixture keypair. `renotify: true` — with a stable tag and `renotify: false` only the day's *first*
change would alert and every later one would be silent, which inverted the feature. Same-origin guard
on `notificationclick`'s `openWindow`. No notification when a visible client already refreshed, which
is the ADR's own "silent refresh" row and stops the device doing roll call from buzzing at itself.

**Open, and deliberately not fixed here.** Each is a real finding, not a nit:

1. **The opt-in's on/off state is origin-wide, not per-trip.** `pushManager.getSubscription()` is one
   subscription per registration, but the server model is one row per trip. A captain running two
   departures sees "on" for the second trip when no row exists, and turning it off there kills the
   first. The toggle has to read server state.
2. **Not every shore-side change pushes.** The fan-out hangs off `publishManifestEvent`, which fires
   for roll call, notes and buddy teams — not for a walk-up seated, a cancellation, a waiver signed at
   the counter, or a crew swap. Those are exactly the changes that land while a captain walks to the
   boat, so the channel is silent on the events it exists for.
3. **`trip_starts_at` is a frozen copy.** `moveTrip` only refuses once roll-call evidence exists, so a
   trip with subscriptions and no head count can move and leave the window computed off a stale time —
   the feature silently off on the day the schedule changed.
4. **Multi-day trips get one day of window**, since it is measured from `startsAt` rather than the
   nearest schedule day.
5. **"Roll call changed" is wrong for four of the eight call sites** — buddy-team edits and note fixes
   say the same thing as a boarding change, which is a materially more alarming sentence at a dock.
6. **No revocation on staff removal or crew change, and no retention arm.** The schema comment
   promises a leaver's devices can be dropped and this record promises pruning; neither exists, and
   these rows are device credentials.
7. **The copy over-promises.** "so this phone carries the latest" invites the negative inference — *no
   ping, nothing to carry* — which is false for every reason above. The honest sentence, already in
   20260804-manifest-push-transport, is that a ping is a heads-up and only a deliberate refresh before
   departure makes a device current. It belongs in the product, not only in an ADR.
8. **No severity tiering, and the seam cannot support it yet.** `publishManifestEvent(db, shopId,
   tripId)` carries no information about *what* changed, so a diver recorded not-back-aboard arrives
   with the same words and the same buzz as a typo fix. Tiering needs that plumbing first.

Item 7 is the one to weigh before this ships to a real boat: until it is addressed, this feature is a
convenience that can be mistaken for a safety control.

## Alternatives considered

- **Re-implement the encrypted store in the service worker** — closes the locked-phone gap fully, at
  the price of two implementations of a safety-critical encrypted format. Rejected above. If it is ever
  wanted, the honest path is making the worker a build-time module so it can import the real one, not
  hand-copying the crypto.
- **Silent (data-only) push** — not available: Chrome and Edge require `userVisibleOnly: true`.
- **Periodic Background Sync** — lets the worker refresh with no server push at all, but is
  Chromium-only, needs an installed PWA plus site engagement, and the browser chooses the cadence. A
  possible bonus on Android later; it cannot be the mechanism.
- **Replace SSE with push** — tempting on cost (push has no connection-hours), but push is opt-in,
  permission-gated, unavailable on iOS outside an installed web app, and best-effort in latency. It
  cannot carry the primary path. Additive is the only safe shape, and it leaves
  20260804-manifest-push-transport's measure-then-decide plan intact.
- **Push on every roll-call write** — ~100 notifications/day/shop. A channel a captain mutes protects
  nobody, so coalescing is part of the feature, not a refinement of it.
- **Push only "significant" transitions** (a diver becomes blocked, a checkpoint completes) — fewer
  notifications, but the offline copy then goes unrefreshed through everything we chose not to push,
  which defeats the purpose. Coalescing throttles *rate* without dropping *currency*.
- **Shop-wide subscription for the day** — one opt-in covers a captain running two trips, but pushes
  about departures they may not be on and needs day-scoped expiry. Per-trip expiry falls out of the
  trip itself.

## Consequences

The pocket case is covered for the first time, on every platform that supports Web Push, without
touching the two existing triggers — so a device that never subscribes behaves exactly as it does
today. Notification permission is requested only behind a deliberate tap, never on page load.

**iOS requires the web app to be added to the Home Screen** for Web Push to work at all. For a
dedicated boat device that is a reasonable one-time setup step, and arguably wanted anyway for the
offline manifest; for a captain using Safari in a tab, this feature simply does not exist and the
existing triggers are what they get. This is worth saying in the opt-in copy rather than letting a
control silently do nothing.

What this commits us to: a new runtime dependency (`web-push`), VAPID keys as deployment secrets, a
table whose rows are per-device credentials, and a fan-out path that must stay best-effort. Expired and
rejected subscriptions have to be pruned — the push service reports gone endpoints as 404/410, and
those are deleted on sight.

**Escape hatch.** Because it is additive and opt-in, removal is: drop the fan-out call inside
`publishManifestEvent`, remove the opt-in control, drop the table. Nothing else depends on it, and the
manifest keeps refreshing exactly as it did before. That is also what makes it safe to ship before
20260804-manifest-push-transport's measurement lands — it does not foreclose any option in that record,
and if push turns out to carry more of the load than expected, it strengthens the case for eventually
holding fewer connections.
