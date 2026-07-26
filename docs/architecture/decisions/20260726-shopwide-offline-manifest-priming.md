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
with no `?trip=` in the URL it enumerates every non-expired snapshot on this device (title, departure
time, freshness pill, diver count), soonest-departure-first so the next boat leaving is always on top,
each linking to its own
`?trip=<id>` detail — the existing single-trip roll-call view, unchanged. With nothing saved yet, it
says so plainly, same as today.

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
departing within the next 48 hours, and the component calls the existing `saveOfflineManifest` for each
one, unchanged in shape or encryption from the single-trip path. Priming the service worker
(`primeOfflineManifestShell()`) also moves here, so visiting *any* shop page — not specifically a trip's
manifest — registers the worker and caches the shell.

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
