# 20260726-shopwide-offline-manifest-priming — List every saved manifest at one shell, prime the whole board automatically

- **Status:** Accepted
- **Date:** 2026-07-26
- **Extends:** [20260718-offline-manifest-snapshots](20260718-offline-manifest-snapshots.md) and
  [20260726-manifest-offline-copy-automation](20260726-manifest-offline-copy-automation.md). Both stay
  in force as-is — the encrypted per-trip record shape, freshness tiers, retention window, idempotent
  roll-call reconciliation, and the never-cache-an-authenticated-response boundary are unchanged. This
  record only widens *when* a trip's snapshot gets saved and *what a captain sees* when they land on
  the offline shell with no specific trip in mind.

## Context

Both prior records assumed a captain opens one trip's live manifest, which is what saves that trip's
device copy and what primes the service worker/offline shell in the background. That leaves two gaps
in practice: a captain who lands on `dive.day` cold (a bookmark, typing the domain, a home-screen PWA
icon) with no signal has nothing to look at even though other trips' copies may already be saved on
the device, and a copy only exists at all for a trip whose live manifest someone happened to open —
today's schedule board doesn't page through every departure, so a same-day trip nobody clicked into
has no offline safety net.

## Decision

**A list, not just a single roster.** The offline shell (`/offline-manifest`) grows a list-first view:
with no `?trip=` in the URL it enumerates every snapshot on this device (title, departure time,
freshness pill, diver count), soonest-departure-first so the next boat leaving is always on top, each
linking to its own `?trip=<id>` detail — the existing single-trip roll-call view, unchanged. With
nothing saved yet, it says so plainly, same as today. A record kept alive past its own retention window
only because it still holds an unsynced roll-call event (`loadOfflineManifest`'s existing rule) is
labeled distinctly as expired rather than showing the same freshness pill an ordinary, still-usable
stale copy gets — the two read identically otherwise, and only one of them can still take a new roll
call. Reconnecting on this list view reconciles every listed trip that has a pending event, not only
whichever one a captain happens to open next, so a change recorded offline for a trip nobody revisits
individually doesn't sit pending indefinitely.

**The root path falls back to that list, not the browser's offline error.** `manifest-sw.js` gains a
navigation handler for `/` (root only — the marketing home page, exactly the two characters typed for
"dive.day"): network-first, and only on a fetch failure does it redirect to the offline shell. Online,
`/` is untouched — still the marketing page. This mirrors the existing per-trip live-manifest fallback
(20260718) at one additional, narrowly-scoped route rather than a generic "any failed navigation" catch
-all, which would swallow failures on pages (settings, booking) that have no business showing a
manifest.

**Every trip in a 48-hour rolling window auto-saves, not just the one page open.** A new client
component (`OfflineManifestAutoSave`) mounts in the staff shop layout — present on *every* `/shop/**`
page a signed-in staff member visits, not only the manifest page — and fetches
`GET /api/offline-manifests/upcoming` (staff-session-gated, tenant-scoped to the caller's shop) on
mount, on `online`/visibility triggers, and on the same 5-minute interval as the existing single-trip
auto-save (20260726). That endpoint returns the serialized manifest payload for every `scheduled` trip
that starts within the next 48 hours *or is already underway* (departed, not yet ended) — the window is
a lower bound on `endsAt`, not `startsAt`, specifically so a trip mid-charter still gets its after-dive-
checkpoint copy auto-saved instead of needing someone to have opened its live manifest first, and the
upper bound is applied in the database query itself rather than filtered after fetching every future
trip. The component calls the existing `saveOfflineManifest` for each one, unchanged in shape or
encryption from the single-trip path. Priming the service worker (`primeOfflineManifestShell()`) also
moves here, so visiting *any* shop page — not specifically a trip's manifest — registers the worker and
caches the shell. Mounting itself is gated to a signed-in staff member viewing *their own* shop (several
`/shop/[shopSlug]` pages, like the public schedule, are unauthenticated per `isPublicShopRoute`, and are
reachable by a signed-out visitor, a diver account, or staff signed into a different shop entirely);
without that gate the component would still mount and poll a 401 every five minutes for anyone else who
lands on those pages, or — for staff of a different shop — save their own shop's roster in the
background while the visible page belongs to someone else's.

**A single first-ever save must not corrupt every later one.** `saveOfflineManifest` for several
different trips can now run concurrently the first time a device has never held any snapshot at all
(nothing existed before this to trigger more than one trip's save at once). The device's per-record
encryption key is generated lazily on first use; without serializing that lazy generation, two
concurrent first-time saves could each observe "no key yet," each generate and persist a *different*
key, and leave every record but the last one permanently undecryptable under whichever key survived.
Key generation is now guarded by its own lock (separate from the existing per-trip lock), so only the
first caller ever generates one and every other caller reads back what it wrote.

**48 hours, chosen deliberately over "all upcoming" or "today only".** All upcoming trips indefinitely
would cache emergency-contact and medical-readiness data for departures a shop books weeks out, the
largest privacy footprint for the least operational benefit — a captain does not need next month's
roster on their phone today. "Today's trips only, primed from opening the schedule board" was
considered and rejected: it still requires a staffer to have opened the schedule that specific day
before signal drops, which is the exact gap this record closes. 48 hours covers "today and tomorrow" in
every timezone without the board needing to be open at any particular moment, and matches the existing
`trip_reminder_24h`/`trip_reminder_7d` cadence's shortest window as a familiar precedent for what
"upcoming" means operationally here.

**What "automatic" cannot mean.** There is no cross-browser background execution model this can lean
on — no Periodic Background Sync on iOS Safari (the primary boat/dock device), and the one-off
Background Sync API is Chrome-only and still requires a foreground registration first. "Automatic"
here means *no manual per-trip action required whenever the app has any page open with signal* —
extending the existing timer/visibility/reconnect triggers to the whole 48-hour board instead of one
trip — not "saves while the browser or tab is fully closed." A shop where no staff member opens any
`/shop/**` page within 48 hours of a departure will not have that trip's copy refreshed, exactly as
today's single-trip design already depends on someone having the manifest open at some point.

**A device that changes shops gets its previous shop's copies purged, not just outgrown.** The
encrypted IndexedDB store (`src/lib/offline-manifest-store.ts`) has never been shop-scoped — it is
keyed purely by trip id, per browser origin, with no notion of which shop saved a given record. Before
this change that was a narrow gap (reaching another shop's cached roster required already knowing its
trip's UUID); the list view turns that into a zero-knowledge, zero-auth browse of every record on the
device, and shop-wide auto-save means far more of a shop's board ends up cached without anyone having
opened it. A shared or reassigned device (a freelance captain working two shops, a boat tablet resold or
handed to a different operator) could otherwise accumulate one shop's medical/emergency-contact data
indefinitely alongside another's. `GET /api/offline-manifests/upcoming` always returns the caller's
server-verified shop identity (never a client-supplied value), even with zero trips in the window;
`OfflineManifestAutoSave` uses it to call a new `purgeOfflineManifestsExceptShop(shopSlug)`, deleting
every device record whose saved shop differs, every time the endpoint is reached. Since reaching this
endpoint requires an authenticated session and signing in requires a network connection, the first
online page load after a different shop's staff signs in on a device is exactly the moment the previous
shop's leftover records stop being readable — closing the realistic device-handoff window rather than
only slowing its growth. This does not change the pre-existing, already-accepted risk that anyone with
unlocked access to *this shop's own* saved copies can read them (20260718's threat boundary), only who
else's data can still be there. The purge fails closed: if it errors, the round aborts before saving the
new shop's trips, so a failure never leaves both shops' rosters readable side by side — the next trigger
(interval, focus, reconnect) tries the whole round again. One deliberate exception: a record still
holding an unsynced roll-call event is never deleted by this purge, even for a shop that no longer
matches — that event cannot reconcile under a different shop's session (the server would check it
against the wrong tenant and reject or misattribute it), so purging it would destroy the only copy of
that safety evidence outright. It stays — visible until the original shop's own session next runs a
purge and finds it resolved, or it clears via the ordinary retention rule — the same trade-off 20260718
already accepts for a single shop's own expired-but-pending records, extended here across the tenant
boundary rather than overridden by it.

**The list orders upcoming trips ahead of retained past ones, not by raw departure time alone.** A trip
kept past its own end date by the 7-day post-trip retention window (20260718) has an earlier `startsAt`
than anything still ahead of it, so a plain ascending sort would put an old, already-departed trip at
the top of the list once a shop's board has run a few operating days — the opposite of "the next boat
leaving is always on top." `listOfflineManifests` partitions into not-yet-ended trips (sorted soonest
first) ahead of already-ended ones (also sorted soonest-first among themselves), rather than a single
sort across both.

**Known residual gap: a cancelled trip's already-saved copy stays listed and boardable until it expires
on its own.** The window endpoint stops returning a cancelled trip going forward (it only ever selects
`scheduled` trips), but nothing tells the device to actively remove a copy it already saved before the
cancellation — the client only ever upserts what a response contains, it never deletes on a trip's
absence from one. The server-side safety net this relies on is real, not assumed: `recordRollCall`
re-checks the trip is still `scheduled` before accepting any event, offline-sourced ones included, so a
roll-call action recorded on-device against a since-cancelled trip's stale copy is rejected on
reconciliation exactly like any other stale-manifest mismatch (readiness that changed, a diver removed)
— it never silently overwrites live history. The residual cost is operational, not a safety-invariant
break: a captain can act on a cancelled trip's copy believing it succeeded, offline, until reconnecting
surfaces the rejection. Building an active invalidation signal (the device telling the server which
trip ids it holds, the server telling it which are stale) is real new protocol surface deserving its own
design, not a rider here; revisit if cancellations close enough to departure to matter in practice turn
out to be common enough for this friction to be worth closing.

## Alternatives considered

- **Register the auto-save fetch from the marketing home page (`/`) instead of the shop layout** —
  rejected: `/` is public and unauthenticated (ADR's public-route allowlist), so it can never safely
  request tenant-scoped roster data. Priming from the authenticated shop layout is the only place that
  can call the new endpoint at all.
- **A generic offline-fallback for any unmatched navigation** — rejected for the same reason
  20260718 scoped its fallback to one route pattern: a captain hitting a genuine dead page (a typo'd
  URL, a page that requires network) should see that, not be redirected into a manifest list that has
  nothing to do with what they were trying to open. Root is added as a second explicit pattern, not a
  wildcard.
- **Require a `?shop=` slug on the offline shell instead of purging leftover records** — rejected: a
  shop slug is not a secret (it's in every staff-facing URL), so requiring it as a display filter would
  add friction without adding a real access boundary, and it does nothing about data already sitting in
  IndexedDB for a shop no longer in use on this device. Purging at the point a new shop authenticates
  removes the data itself rather than just hiding it behind a guessable parameter.
- **Do nothing — treat this as the same "unlocked device" risk 20260718 already accepted** — rejected;
  20260718's accepted risk was one staffer's own device holding their own shop's data, discoverable only
  by whoever already knew a trip's UUID. Shop-wide auto-save plus an enumerable list changes both the
  volume (a full 48-hour board instead of one clicked trip) and the discoverability (a list, not a UUID
  guess) enough that it is a materially different exposure, not a restatement of the same one.
- **All upcoming trips, uncapped** — rejected above; revisit only if a shop reports the 48-hour window
  missing a trip they needed offline, which would be evidence the window itself (not the uncapped
  alternative) needs widening.
- **A dedicated "download the board" button** — rejected; the whole thrust of 20260726 was removing
  manual steps from a safety surface, and a button reintroduces exactly the "captain who forgot to tap
  it" gap both prior records exist to close.

## Consequences

More trips' emergency-contact and readiness data end up cached on a device than before — every trip
in the rolling window, whether or not a staffer looked at it — a deliberate, bounded widening of the
threat/failure boundary already accepted in 20260718 (encryption reduces exposure from copied storage,
not from an unlocked device or a same-origin script compromise). The retention window, freshness
tiers, and lack of a delete button are unchanged, so a trip that departs and clears its post-trip
retention window still ages out the same way. The new endpoint reads more of the schedule per call than
any per-trip manifest fetch has before; if a shop's near-term board ever grows large enough for this to
be a real cost, cap or paginate it then — the 48-hour window itself already bounds it in the common
case. Revisit the window after field tests the same way 20260718 anticipated for its own thresholds.
The device store now purges on shop mismatch (above), so a device that changes shops stops holding the
previous shop's data as soon as the new shop's staff is online once — but a device that stays offline
throughout a handoff, or one where the new shop's staff never opens a DiveDay page, keeps the old
data until its own retention window lapses, same as any other accepted-storage-eviction gap in this
design.
