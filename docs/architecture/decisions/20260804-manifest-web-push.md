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

**Also fixed, in the follow-up pass.** Six of the eight findings below are now closed:

1. **The opt-in's on/off state is per-trip.** It reads the server rather than
   `pushManager.getSubscription()`, which is one subscription per registration and so said "on" for a
   trip with no row. Enabling a second departure reuses the browser subscription and adds a row;
   disabling one only tears that subscription down once no other trip still needs it.
2. **`trip_starts_at` is gone.** The window is computed from the live trip row at send time
   (`src/lib/push-window.ts`), so a departure that moves takes its window with it. The column and its
   index were dropped rather than kept as a stale-looking authority.
3. **Multi-day trips are covered for their whole run.** The window closes on the later of the trip's
   own end and its last scheduled day, not on a fixed offset from the start.
4. **"Manifest updated"** replaces "Roll call changed", which was a materially more alarming sentence
   than a buddy-team or note edit warrants — and those publish through the same seam.
5. **Revocation and retention exist.** `removeStaffMember` deletes the leaver's rows in its own
   transaction (the `people` row survives a removal, so the cascade never fired), and
   `push_subscriptions` has a 30-day arm in `RETENTION_DAYS` — the shortest window there, because
   these rows are device credentials with no later value.
6. **The copy no longer over-promises.** "A ping is a heads-up, not a guarantee — check the saved copy
   is fresh before you leave the dock" replaces "so this phone carries the latest", and the
   notification says what to *do* ("Open the manifest to save the current list to this phone") rather
   than asserting the phone is current. An e2e assertion pins the heads-up sentence, because it is the
   sentence that stops silence being read as "nothing changed".

**Both remaining findings are now decided** (product owner, 2026-08-04).

### Which writes announce a manifest change — trip-scoped writers, not person-scoped

Before this, the eight publishers were all things a captain does **on the manifest page itself**
(`recordRollCall`, `recordCrewRollCall`, `recordCrewAttestation`, `updateLatestRollCallNote`, and the
four buddy-team writers). So push told a captain about their own edits and nothing else — silent on
precisely the shore-side changes it exists to carry.

The criterion chosen is **whether the writer already knows its trip**, because that is what separates
a one-line change from a fan-out:

| Added | Why |
| --- | --- |
| `seatDiver` | A walk-in seated at the counter — the archetypal change that lands while a captain walks to the boat |
| `cancelBooking` | A diver leaves the roster |
| `setTripCrew` | Who is crewing is on the manifest |
| `callTripBlowout` | The departure is cancelled — the largest manifest change there is |

**Certification writers are deliberately excluded.** `createCertification`, `reviewCertification`,
`archiveCertification` and the specialty equivalents are *person*-scoped: one write changes readiness
on every future trip that diver is booked on, so publishing means a lookup fanning out to N trips,
with its own bounding. It is also the wrong urgency — a card gets verified days before a boat, not
minutes. Waiver signing sits in the same category for now; it is per-booking and so derivable, and is
the first candidate if this is revisited.

Two invariants the implementation holds, both asserted by tests: a publish happens **after** its
transaction commits, never inside it (this fans out to a third-party push service, and holding a
transaction open across that turns a slow provider into a lock-wait on `bookings`); and a **refused**
write publishes nothing, so a miss cannot spend the coalescing budget or wake a phone.

### Severity tiering — will not do

`publishManifestEvent(db, shopId, tripId)` carries no information about *what* changed, so tiering
would mean threading a kind through twelve call sites, a payload field, and per-tier copy in every
locale. That cost is not the reason to decline it.

The reason is that **the one genuinely urgent case is one this channel cannot serve.** Of everything
that publishes, only a diver recorded *not back aboard* after a dive is an emergency — and the people
who can act on it are on the boat, standing next to whoever recorded it. A push arriving on a phone on
shore is not the intervention, and a tier that implied otherwise would be worse than no tier: it would
dress a notification up as a response.

Recorded as decided rather than deferred, so it is not re-opened later as unfinished work.

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
