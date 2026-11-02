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

Saving that snapshot stays explicit, but reaching it does not have to be: opening the live manifest
also registers the service worker and primes the offline shell in the background, before any snapshot
exists. If the network fails on a later reload of that same live manifest page, the worker's
navigation handler — scoped to that one route by trip id, nothing broader — redirects to the cached
offline shell instead of surfacing the browser's own offline error. With no snapshot saved yet, the
shell just says so plainly; it never fabricates a roster. This closes the gap where a captain who
never tapped "Save now" had no page at all to land on once signal dropped.

**Amended 2026-10-23: a network that stops answering counts as failed.** Dock Wi-Fi can show full
bars and carry nothing, and there a request neither answers nor fails. Every navigation fallback in
the worker (this live-manifest route, the counter, `/`, the offline shell and the diver's `/ready/`
copy) now gives the network four seconds, then serves the saved copy and aborts the request. With
nothing saved on the device it keeps waiting for the network instead.

- **One deadline, not two.** The worker's redirect to the offline shell names why it was made
  (`?fallback=slow` or `?fallback=failed`), and the worker serves that shell from its cache at once,
  so a dead link puts the saved roll call on screen in four seconds, not eight.
- **A copy served for silence never says it is live.** A slow server is not an offline device: the
  phone still reads "online" and a copy saved minutes ago reads "fresh". So a shell opened by that
  redirect says DiveDay did not answer and when the copy was saved, shows no "Online" and no
  freshness wording, and asks the live manifest again every five seconds (it cannot wait for the
  browser's `online` event, which never fires for a device that never went offline). Each ask gets
  three seconds, under the worker's four, so a server that answers too slowly for the worker never
  counts as answering. Once one is answered, and nothing on the phone is still waiting to sync, the
  copy offers an "Open live manifest" button. It never leaves on its own: a swap mid-count would move
  rows under a thumb and drop a typed note. The saved list keeps the reason on each trip's link, so a
  trip reached through it says the same.
- **Every sync of queued events gives up after ten seconds**, whoever calls it: the page, and the
  worker's Background Sync and push flushes, which go through the same `syncOfflineManifest`
  ([20260804-manifest-web-push](20260804-manifest-web-push.md), amended the same day). The events
  stay pending and the next pass resends the same `clientEventId`s. The offline view runs one sync at
  a time and folds every tap made meanwhile into one more, and a tap frees its row as soon as it is
  on the phone rather than when the sync ends.
- **A resend may overlap the request it replaced**, which can still be running on the server. Each
  writer (roll call, crew roll call, the pre-departure check) asks whether the id is already recorded
  before any work and again under the trip or seat lock, where the first request's commit shows; a
  collision on the `(shop_id, client_event_id)` unique index that neither question saw is answered
  as a duplicate too. So a POST given up on that landed is a duplicate on retry, never a second row,
  a 500, or a correction refused as superseded by its own first copy (`roll-call.postgres.test.ts`,
  `pre-departure-check.postgres.test.ts`). An id already recorded for another subject (another
  seat, crew member or checklist line) is refused as `client_event_conflict`, never answered as a
  duplicate: only a device bug sends one, and a duplicate would mark a tap applied that nothing
  recorded. The pre-departure check's trip lock waits at most five seconds, as the other writers' do.

> Superseded by [20260726-manifest-offline-copy-automation](20260726-manifest-offline-copy-automation.md):
> the snapshot now saves and refreshes itself automatically; "Save now" no longer exists, and a captain
> gets the offline copy without tapping anything.

Every snapshot displays its saved time and one of three freshness states: current (up to 15
minutes), aging (up to four hours), or stale. Stale snapshots remain usable because a boat may be
offline for a full operating day, but only a diver recorded as ready in that snapshot may be marked
boarded. Not-boarded remains available for every diver. Device copies expire at the earlier of 14
days after saving or seven days after the trip ends, and staff can delete them immediately.

> Superseded by [20260726-manifest-offline-copy-automation](20260726-manifest-offline-copy-automation.md):
> there is no staff-delete button — expiry is the only way a copy goes away. The retention window itself
> (14 days after saving, or 7 days after the trip ends, whichever is earlier) is unchanged.

Offline roll-call changes are encrypted in the same device record and remain visibly pending until
reconnection. Each change has a client UUID, snapshot saved time, device occurrence time, and
offline source marker. The server applies changes idempotently, re-checks tenant, staff, booking,
trip, and current readiness, and rejects an older device event when a newer server event exists.
Rejected events stay visible as conflicts; they never silently overwrite the live manifest.

> Extended by [20260726-shopwide-offline-manifest-priming](20260726-shopwide-offline-manifest-priming.md):
> the offline shell now lists every saved trip (not just the one last opened), the root path (`/`)
> falls back to that list the same way the live-manifest route already falls back to its own shell, and
> priming/saving runs for every trip in a 48-hour window from any staff page — not only a trip's own
> live manifest. The single-trip fallback and the never-cache-an-authenticated-response boundary below
> are unchanged.

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

## Amendment, 2026-10-23: medical alert words on a device copy (H-20261023-medical-alert-for-the)

The threat boundary above accepts that encryption cannot protect an unlocked device. That was
decided for a copy every staffer may read. A diver's **medical alert for the crew** has a narrower
audience (the owner, a manager, crew a manager put on the departure), so its words follow stricter
rules than the rest of the copy (H-20261023-medical-alert-for-the, amendment of 2026-10-23):

- No server payload carries the words: not the manifest page's offline payload, not
  `/api/offline-manifests/upcoming`, not the service worker's refresh. Every copy carries the fact of
  an alert.
- The words reach a copy only on an explicit save by a permitted reader on that one departure:
  `POST /api/offline-manifests/[tripId]/medical-alerts` records `medical_alert_saved_offline` per
  diver, and `saveOfflineMedicalAlerts` writes the words and `medicalAlertsSavedBy` (who, when) into
  the same encrypted record. `saveOfflineManifest` drops any words a payload carries and keeps
  saved words through later background saves for divers the board still flags, but only while
  `/upcoming`'s `mayHoldMedicalAlertWords` answers true for that departure (the live reader check,
  security review 2, L3); a missing or false answer drops them.
- `wipeOfflineMedicalAlerts` takes the words off every copy, keeping the rest (queued events
  included): on sign-out (`forgetThisDevice`, which the sign-in page also runs) and whenever an
  `/upcoming` answer names a different person than the one who saved them. A body that names nobody
  wipes them all.
- Both sign-out doors await the wipe (up to two seconds) before they navigate. **A session that ends
  without the sign-in page loading leaves the saved words on the device**: a closed browser, or a
  session that expires while the tablet sits on `/offline-manifest` (which needs no session), runs
  no wipe, and anyone holding the unlocked device can read the words there until the copy expires
  or the next sign-in on it (security review 2, L4).
- A crew member removed from the departure after saving loses the words at the next background
  refresh while the device is online. A device that is offline keeps them until sign-out, another
  person's sign-in, or the copy's expiry. That is accepted: the boat may already be at sea, and the
  read was recorded when the words were handed out.

Optional and additive: no `OFFLINE_MANIFEST_RECORD_VERSION` bump.
