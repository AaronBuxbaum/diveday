# 20260907-the-counter-survives-offline — Give arrival its own append-only trail, its own offline queue, and no way to say "aboard"

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

The manifest survives a lost signal; the counter does not. A crew at the rail has an encrypted copy
of the whole 48-hour board on the device and can take a head count with the radio off (ADRs
20260718-offline-manifest-snapshots, 20260726-manifest-offline-copy-automation,
20260726-shopwide-offline-manifest-priming). The desk twenty metres away, working the same
departure on the same morning, has a server-rendered page and a Server Action: with no signal it
does nothing at all. Marina wifi drops on both sides of the same wall.

Assessment item N-53 (`docs/product/assessments/improvement-ideas-20260907.md`, verdict **Build
now**) asks for check-in to work with no signal, with the reconciliation rules roll call already
has, and states the one safety constraint in a single line: *an arrival is never promoted to aboard
by the queue.*

Two facts about the existing code shape the answer. First, `bookings.status` is the only record of
an arrival — a projection with no history, no idempotency key and no timestamp — and an offline
queue needs all three to answer "has this tap already been applied", "is this copy older than what
stands now", and "is the arrival this undo names still the one standing". Second, arrival and
boarding are already two deliberately separate questions in this product (`checkedIn` versus
`rollCall` on a manifest diver), and the counter's own refusal grammar already differs from the
rail's: a diver readiness blocks is offered no check-in control at all.

## Decision

**1. Arrival gets an append-only trail: `booking_arrival_events`.** One row per tap, `arrived` or
`cleared`, with `source` (live/offline), a device `client_event_id` unique per shop,
`offline_snapshot_saved_at`, `occurred_at` and a `seq` tiebreak — the same columns and the same
read-back ordering as `roll_call_events` and `pre_departure_check_events`. `bookings.status` stays
the projection every existing reader looks at; both are written in one transaction by
`checkInBooking` / `undoCheckInBooking`.

**Every tap writes a row, live ones included.** A live check-in that left no row would read as
"nothing has been said" to a device syncing an hour-old retraction, and the retraction would win.

**2. One writer for both doors.** The sync route dispatches a queued arrival to the same two
functions the live counter calls, with `source: "offline"` and the three queue fields. So an
offline arrival takes the identical live-staff gate, trip and booking checks, and — the one that
matters — the same **live readiness re-read**, hours after the tap. A diver whose card expired or
whose refund landed while the tablet was out of signal is refused on reconciliation, exactly as
they would have been at the desk.

**3. The reconciliation rules are roll call's, not a second set.** Dedup on `client_event_id`; the
shared `offlineEventOutOfBounds` staleness bound, now hoisted to `src/lib/offline-events.ts` and
imported by all three writers rather than written out three times; newest-wins, strict (`>`), so a
device's own batch sharing one frozen-clock millisecond still applies in queue order; and a
retraction is a **compare-and-set** naming the arrival it undoes (ADR
20260815-an-offline-retraction-names-its-target, reproduced here). That last one is what stops a
tablet's honest undo, stamped at tap time and therefore later than everything before it, from
taking back a desk that checked the diver in five minutes ago because they were standing there. An
undo naming nothing keeps the newest-wins-only path, for the same dry-bag reason roll call does.

**4. The queue cannot say "aboard", structurally rather than by a check.** `ArrivalStatus` is
`"arrived" | "cleared"` and there is no checkpoint on an arrival event; the queue is a third array
on the envelope, never merged into roll call's; the sync route's arrival branch reaches
`checkInBooking`/`undoCheckInBooking`, which touch `bookings.status` and `booking_arrival_events`
and cannot reach `roll_call_events` at all; and the device's reader is a separate function over a
separate array. There is no body a device can send, well-formed or not, that promotes an arrival
into a boarding. A person is aboard when somebody at the rail says so.

**5. The surface is the offline shell, not a new page.** `/offline-manifest?trip=<id>` grows an "At
the counter" section above the checkpoint switcher, beside the pre-departure checklist and for the
same reason: arriving happens once, before the boat leaves, not once per dive. It is a separate
list from the roll call rather than a second control on those rows — a row answering both questions
is the first step toward a queue answering the second. A diver readiness refuses gets no control
and shows what is in the way, which is the live counter's own grammar. The service worker gains one
navigation fallback, `/shop/*/check-in` to the shell carrying `?trip=`, mirroring the live-manifest
one and scoped to the counter alone: the walk-in flow beneath that path seats a diver and needs a
server, so a roster it cannot act on would be a worse answer than the browser's own.

**Each row says the act in words.** A name beside a circle is what every roll-call row on this page
also is, and the one mistake this surface must not invite is boarding somebody by reaching for the
wrong list — so the control carries the live counter's own two words, *Check in* and *Checked in*,
rather than putting the state in a screen-reader label alone (domain review, 2026-09-07).

**A tap the server refused stops standing on the device.** `latestOfflineArrival` skips a rejected
event and reads back to what is underneath it. The one reason an arrival is refused is that
readiness stopped clearing the diver after the tap, and a row still reading *Checked in* would say
somebody is through a counter that refused them. Both directions are safe here: a refused arrival
falls back to the saved copy's answer, and a refused undo leaves the arrival it failed to take back
standing — both of which are what DiveDay last said. Roll call's own reader spends a rejection far
more carefully (`explicitResultAt`) because there a rejected correction can silence a missing-diver
alarm; nothing recorded here is that.

**6. The snapshot carries one new field: `divers[].checkedIn`, a boolean.** No name, no timestamp —
the allow-list exists to keep what sits on a deckhand's personal phone for a fortnight down to what
somebody reads, and a desk row needs neither. Optional and additive, so **no
`OFFLINE_MANIFEST_RECORD_VERSION` bump**: a bump is a purge of every roll call a captain has queued
and not synced, and its absence here reads as "nobody has checked them in", which puts nobody on a
boat.

**7. One count for all three queues.** `pendingOfflineEventCount` / `rejectedOfflineEventCount`
replace the per-array filters that decided whether an expired copy is kept, whether the cross-shop
purge may delete it, and whether the worker's background flush has work. A queue one of them could
not see is evidence the other two throw away. `loadOfflineManifest` also normalises a stored
envelope's missing arrays, because there is no deploy that reaches a phone in a dry bag.

## Alternatives considered

- **Widen `trip_desk_events`** — it already has an `arrival` kind, but it is the crew's catch-up
  strip, deliberately not an authority, and its 30-day window would delete the history the
  compare-and-set reads.
- **Columns on `bookings` (`arrival_client_event_id`, `arrival_recorded_at`)** — a projection that
  remembers only the newest tap, so a re-delivered older event is not deduplicated and there is no
  trail for a departure log to print.
- **A second control on the roll-call row** — one row answering "arrived?" and "aboard?" is exactly
  the conflation the item's safety line forbids, and it puts a desk question on a rail surface.
- **A new `/offline-counter` route** — a second cached shell, a second purge path and a second
  identity check, for a list of the same divers the shell already holds.
- **Offer a check-in on a diver the saved copy says is blocked** — a tap the server refuses the
  moment it lands, under copy promising otherwise; the live counter shows the blocker instead, and
  so does this.
- **Let the queue mark somebody boarded when it applies an arrival** — never considered seriously,
  and named here so it stays refused: nothing about a desk tap is evidence anyone got on a boat.

## Consequences

The counter works with no signal on the surface the crew already reach for, and the arrival that
comes back is reconciled by the rules a head count is reconciled by. The trail under it is what a
departure log can print about who was at the desk and when, which `bookings.status` never could.

It commits us to writing an arrival row on every live check-in, and to keeping `bookings.status`
and the trail written in one transaction. The table is append-only and unpruned, the same posture
as its two siblings: an undo is a `cleared` row rather than a delete, and erasure reaches it
through the live join to `people` rather than through a window.

A queued arrival can still be refused for a reason a staffer only learns on reconnection — the
diver was not ready, or somebody else spoke more recently. That is the same trade the offline roll
call already makes, and the refusal is visible in the shell's pending/rejected counts, which now
see all three queues.

**A queued arrival for a departure that has already sailed is applied, not refused**, because
`checkInBooking` asks only whether the trip is still `scheduled` — the same question it asks a
staffer standing at the desk, whose own queue carries a look-back window. Checking somebody in
after the boat left is meaningless rather than dangerous: it closes an arrival queue and says
nothing about who is aboard. Refusing it would mean a second time gate here that the live counter
does not have, and would discard an act a staffer really made.

**Escape hatch.** Removing the offline half is the arrival array, its sync branch, its section and
the worker's second navigation rule; the table and the live rows stay and cost nothing. Removing
the table as well means going back to a projection with no idempotency, which is to say giving up
the offline counter — so the trigger to revisit is not "is the table worth it" but "does the desk
still lose signal". Revisit the surface decision (5) if shops report the counter's list and the
roll call being confused for one another on a phone; the two would then need separate doors off the
shell, which is a routing change rather than a data one.
