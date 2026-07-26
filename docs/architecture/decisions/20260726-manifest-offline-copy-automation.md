# 20260726-manifest-offline-copy-automation — Save and refresh the offline manifest copy automatically

- **Status:** Accepted
- **Date:** 2026-07-26
- **Supersedes (in part):** [20260718-offline-manifest-snapshots](20260718-offline-manifest-snapshots.md)'s
  decision that saving the device snapshot "stays explicit" and its staff-delete affordance. The rest
  of that record — encrypted, versioned, freshness-labeled snapshots, the retention window (earlier of
  14 days after save or 7 days after trip end), idempotent roll-call events, server-side conflict
  rejection, and the offline-shell service worker — is unchanged.

## Context

20260718-offline-manifest-snapshots made saving the offline device copy a deliberate explicit action
("Save now") on the theory that offline mode should read as an inspectable safety tool rather than
invisible caching, and gave staff an explicit "Delete device copy" button. In practice this put three
controls in front of a captain (save-or-refresh, open offline copy, delete) for a task that should just
work: the live manifest payload already has everything needed to keep the device copy current, so
requiring a tap before the roster exists offline is friction, not safety. An explicit delete button is
also a foot-gun on a safety artifact — there is no legitimate reason for a captain to want the offline
roll-call copy gone before its data is no longer relevant, and the existing lazy expiry-on-read path
already reclaims it once it is.

## Decision

The manifest page now saves and refreshes the offline snapshot automatically: on mount (if online), on
`online` reconnect, on the page regaining visibility, and on a five-minute interval while open. The one
remaining explicit control is a "Refresh now" button, for a captain who wants to force a fresh snapshot
immediately (e.g. right before shoving off) rather than wait for the next automatic pass. Saving still
goes through the same encrypted, versioned, freshness-labeled `saveOfflineManifest` path as before —
automation changes *when* it's called, not what it stores or how it's secured.

The "Delete device copy" button is removed from both the live-manifest manager and the offline viewer.
Deletion stays lazy-on-read (`loadOfflineManifest` deletes an expired record the next time it's opened)
on the **same retention window as before** — earlier of 14 days after saving or 7 days after the trip
ends (`OFFLINE_MANIFEST_MAX_RETENTION_MS` / `OFFLINE_MANIFEST_POST_TRIP_RETENTION_MS`, unchanged) — a
shorter window was drafted and considered but the product owner chose to keep the original 7-day leg
rather than compress it. Expiry is now the only way a copy goes away; there is no button.

Removing the delete button changes the failure surface, so two gaps a `dive-domain-expert` review
raised are closed in this same change, not deferred:

- **A corrupt/undecryptable existing record used to be a dead end.** `saveOfflineManifest` reads the
  existing record first (to carry forward its queued events) before writing a new one; if that read
  throws — bad key, storage corruption, a version/AAD mismatch — the save aborted entirely, and with no
  delete button there was no way for a device stuck in that state to ever save again. It now treats a
  failed read of the existing record as "no existing record" and proceeds with the save, so an automatic
  or manual refresh self-heals past a corrupt local record instead of failing identically forever.
- **Lazy expiry used to delete unconditionally.** A record past its retention window was deleted the
  next time anything read it, with no check for roll-call events still marked `pending` (recorded
  offline, never confirmed reaching the server). `loadOfflineManifest` now keeps an expired record alive
  — serving it as stale rather than reporting it missing — as long as it still holds a pending event,
  and only deletes once every event is resolved (applied or rejected).

> Extended by [20260726-shopwide-offline-manifest-priming](20260726-shopwide-offline-manifest-priming.md):
> the same automatic save now runs for every trip in a 48-hour rolling window from the shop layout, not
> only the one trip whose live manifest is open. Nothing here — the snapshot shape, retention, or the
> single-trip page's own auto-save — changes.

Refreshing today is still polling (interval + focus + reconnect), not push. A later revisit could move
the "is the live manifest newer" signal to a push channel (SSE from a lightweight endpoint, or a
WebSocket gateway) so a device gets the update the moment roll call changes elsewhere, instead of
waiting up to five minutes. That is deliberately out of scope here: it is new server infrastructure (a
persistent-connection surface Vercel's request/response model doesn't give for free) and deserves its
own ADR and load-bearing failure-mode analysis, not a rider on a button-count cleanup.

## Alternatives considered

- **Keep explicit "Save now" as the only way to create the first snapshot** — rejected; it reintroduces
  the exact gap 20260718 already fixed for the *shell* (a captain who never tapped it had nothing to
  reload to) for the *data*, and there's no safety reason a live, already-loaded roster needs a tap to
  become the offline roster.
- **Drop the manual refresh button entirely** — rejected for now; a captain about to lose signal for a
  known window (heading to a dive site) has a real reason to want a snapshot *right now* rather than
  trust the next automatic tick, and the cost of keeping one clearly-labeled button is low.
- **Keep the delete button but move it behind confirmation** — rejected; confirmation dialogs don't fix
  the underlying problem, which is that no confirmed-safe reason to delete-before-expiry exists on this
  surface.
- **Shorten the post-trip retention window (e.g. to one day)** — drafted, then rejected by the product
  owner in favor of keeping the original 7-day leg; the delete button's removal doesn't itself require a
  shorter window, and 7 days gives more slack for conflict resolution and follow-up before a copy
  disappears.
- **Implement WebSocket/SSE push now** — rejected for this change; it's a new runtime dependency and
  infrastructure surface that needs its own ADR, and polling every five minutes plus focus/reconnect
  triggers is already a large improvement over a person remembering to tap refresh.

## Consequences

Fewer controls on a boat-mode surface staff read in bright sun with wet fingers: one manual button
(Refresh now) plus the link to the offline copy, down from three. Snapshots stay current without
depending on someone remembering to tap anything. The device copy can no longer be removed early by
mistake or on purpose; the only way it goes away sooner is clearing site data or browser storage
eviction, which was already true. Automatic saves mean more frequent `saveOfflineManifest` writes while
the page is open — each is a full encrypt-and-put, cheap relative to the payload size and no different
in kind from what "Refresh" already did. The self-heal-on-read-failure and keep-if-pending-events fixes
mean the surface is no longer *more* fragile for having lost its delete escape hatch — if anything the
save path is more resilient than before, since it previously had no defined behavior for a corrupt
existing record at all. Revisit polling cadence after boat field tests, same as 20260718 anticipated for
its own thresholds; and revisit push-based refresh (superseding the polling paragraph above) if staff
report the five-minute window is operationally too slow.
