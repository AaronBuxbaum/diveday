# 20260815-minimal-gear-register — Add an opt-in, presence-based gear register beneath rental fit, never replacing it

- **Status:** Accepted (2026-08-20)
- **Date:** 2026-08-15

**Accepted 2026-08-20** by product-owner instruction ("I want to build the Gear system…
having all the features a dive ship might care about"), which is the roadmap-§3 reversal this
record existed to put in front of him. Built the same day; the **2026-08-20 amendment** at the
bottom records where the build deliberately extended or corrected this record. Scope with
[20260815-outbound-integration-webhooks-and-zapier](20260815-outbound-integration-webhooks-and-zapier.md)
in mind — the register is designed to be that ADR's first genuinely new payload, not built in
isolation and retrofitted onto it later; that ADR's `gear_item.*` events remain gated on its own
acceptance.

## Context

M5 deleted item-level equipment inventory on purpose: *"DiveDay tracks sizes, not individual
items; assignments and service history were removed outright."* `rental_fit_profiles`'s own schema
comment still states the invariant directly — *"the shop tracks no equipment inventory... never a
reservation of a particular item."* A real DiveShop360-shop inquiry (2026-08-15) named exactly this
gap unprompted (what's out, when it's due back, avoiding double-booking), and
[competitive-analysis.md](../../product/assessments/competitive-analysis.md#what-blocks-the-purchase)
already calls the absence of item tracking a disqualifier for the classic gear-heavy shop.

Constraints a lower-context agent must not miss:

- **Not every shop needs this.** A boat-charter or course-only shop with no numbered rental fleet
  must see nothing new — explicit product-owner instruction this session, and the same posture the
  [boat-resource-model ADR](20260804-boat-resource-model.md) already established for boats
  ("single-boat shops... are never forced to manage a resource they don't have").
  `rental_fit_profiles` (sizes) is the universal, always-on layer; this register is strictly
  additive beneath it.
- **Double-booking is a real correctness problem, not just a UX gap** — the same class of bug
  AGENTS.md's transaction-concurrency rule and the real-Postgres CI job
  ([20260806-real-postgres-ci-job](20260806-real-postgres-ci-job.md)) already exist to catch for
  booking-capacity oversell. A gear reservation needs the same database-level guard, not an
  application-level check two staff members can race past.
- **A shop has exactly one waiver, versioned shop-wide, never per-title** (`waiver_templates`'s
  unique index and its CR-015 fix comment) — a printed "rental ticket" is not a second waiver, and
  this ADR does not propose one.
- Vision bounds this explicitly (this session's edit): gear rental only, never selling
  (retail/barcode inventory) or repairing (work orders) — both stay declined
  ([vision.md](../../product/vision.md#non-goals-for-now)).

## Decision

**A gear register is opt-in by presence, not a settings flag: a shop with zero `gear_items` rows
sees no new UI and its prep list is generated exactly as today. Adding the first item is what turns
it on.**

### Schema (expand-only)

```
gear_items
  id                uuid PK
  shop_id           uuid FK → shops, not null
  kind              RentableItemKind (reuse src/lib/rentals.ts's existing enum)
  label             text not null              -- the shop's own tag, e.g. "BCD #14"
  size              text                       -- optional; mirrors rental_fit_profiles' size fields
  status            gear_item_status not null default 'in_service'
                       ('in_service' | 'needs_service' | 'retired')
  service_note      text                       -- staff free text, set alongside 'needs_service'
  created_at        timestamptz not null default now()
  unique (shop_id, label)

gear_reservations
  id                uuid PK
  gear_item_id      uuid FK → gear_items, not null
  booking_id        uuid FK → bookings, not null
  reserved_from     date not null
  reserved_until    date not null
  returned_at       timestamptz                -- null while still out
  created_at        timestamptz not null default now()
  check (reserved_until >= reserved_from)
  -- the double-booking guard, enforced in the database, not just in application code:
  exclude using gist (
    gear_item_id with =,
    daterange(reserved_from, reserved_until, '[]') with &&
  ) where (returned_at is null)
```

### The pieces, mapped to what was actually asked for

- **Manage and track rental reservations** — `gear_items` + `gear_reservations`, above. A staff
  surface at `/shop/[shopSlug]/gear` lists items, their current reservation if any, and status.
  (The sketch here originally said "new feature module, per
  [20260730-feature-module-contracts](20260730-feature-module-contracts.md)" — superseded by the
  build amendment below: the shipped boundary is `src/lib/gear.ts` + `src/db/gear.ts`, no
  `src/features/gear`, because Today's gear rows live in `src/db/today.ts` and `src/db` may not
  import `src/features`.)
- **Payments** — no new payment machinery. A reservation attaches to the same
  `order_line_items` row (`kind: "rental"`) the booking already creates; the reservation is a
  *fulfillment* record, never a billing record. Nothing here touches Stripe.
- **Print rental tickets** — a printable per-booking view listing assigned units and sizes, same
  print pattern already used for the offline-manifest print view. Explicitly **not** a second
  waiver — signing stays the existing shop-wide waiver, unchanged. If a shop wants an
  equipment-specific liability addendum, that's a separate decision (a second template type,
  against the CR-015 invariant) and is out of scope here, not silently solved by inventing one.
- **What's out and when it's due back** — a Today-queue row for "due back today," reusing
  `src/lib/today.ts`'s existing assembly pattern, plus the `/gear` list's own filter.
- **Avoid double booking** — the `EXCLUDE USING gist` constraint above, enforced at the database
  layer. Ships with its own real-Postgres CI coverage racing two concurrent reservation attempts
  for the same unit, mirroring the existing `FOR UPDATE` seat-oversell test.
- **Service-due** — the `needs_service` status plus a staff note. Deliberately not a work-order
  object: no parts, no labor, no billing, no repair-ticket lifecycle — that stays declined
  ([vision.md](../../product/vision.md#non-goals-for-now)).

## Alternatives considered

- **A settings boolean to turn the register on** — rejected: a second source of truth (a populated
  item list with the flag off, or an empty list with it on) for no benefit over "the list is the
  truth."
- **Reservation scoped to the trip, not a date range** — rejected: a rental window can start before
  or run past a single trip (a multi-day course, an item picked up early), and "avoid double
  booking" needs a real range, not a trip-shaped proxy.
- **Application-level double-booking check only** — rejected for the same reason
  AGENTS.md's transaction-concurrency rule exists: a race between two staff assigning the same unit
  is exactly the bug class only a database constraint closes for good.
- **Extending `rental_fit_profiles` in place** rather than adding new tables — rejected; that
  table's own comment states it is "never a reservation of a particular item," and item-level
  checkout/return is a different lifecycle that would corrupt that invariant for shops that never
  opt in.

## Consequences

- **Easy:** a shop that never adds a gear item sees zero UI change and zero migration risk to its
  existing prep-list flow; billing is free (reuses existing rental order lines); the register is
  designed as the read-API's first new payload, not a second integration project.
- **Hard / new:** the exclusion-constraint migration and its concurrency test are genuinely new
  work; a staff gear-management route is a new feature module with its own i18n keys in every
  locale (en-US and es-ES together, per AGENTS.md).
- **Commits us to:** `rental_fit_profiles` (sizes) staying the universal always-on layer;
  `gear_items`/`gear_reservations` staying strictly optional and never required to answer "what
  size does this diver need."
- **Explicitly out of scope, flagged rather than solved:** a second, equipment-specific waiver
  template (blocked on the one-waiver-per-shop invariant); full work-order/repair tracking
  (already declined).
- **Escape hatch:** a shop that stops using the register can archive every item (`status: retired`)
  and falls back to sizes-only with no data loss — reservations simply stop being made. If nobody
  ever adopts it, the cost of leaving is two dormant tables.
- **On acceptance (not before):** move roadmap §3 from "open work" to "in progress," and add
  `gear_items.csv` / `gear_reservations.csv` to `src/lib/export.ts`'s manifest.

## 2026-08-20 amendment — what the build extended or corrected

Accepted and built in one stroke; five places the shipped shape deliberately differs from the
schema sketch above, each for a reason worth keeping:

- **A service *history*, not a flag.** `gear_item_status`'s `needs_service` + note survive as the
  "pulled off the wall" state, but the register's real service answer is a third table,
  `gear_service_events` — append-only care events (`service` | `hydro_test` | `visual_inspection`
  | `o2_clean` | `note`), each carrying the `next_due_on` deadline staff set for that clock. The
  newest event of a kind *is* that clock; nothing is denormalized onto the item row. This is what
  "what's due for service" actually means for a dive fleet: a tank runs two independent
  compliance clocks (US DOT hydro every five years, annual VIP) plus an O2-clean renewal, and a
  shop wants the printable history as proof of care. Still deliberately not a work order — no
  parts, no labor, no billing (`src/lib/gear.ts` holds the interval conventions; the form
  suggests, staff decide).
- **Two more kinds.** `gear_item_kind` is the prep list's eight (including `boots`, which the
  original sketch's "reuse `RentableItemKind`" would have dropped) plus `tank` — the most
  numerous, most compliance-bound unit a shop owns, absent from the rentable catalog because a
  fit never mentions gas — and `other` for the odd tagged thing (torch, SMB, camera tray).
- **`shop_id` on every table.** The sketch's `gear_reservations` had none; every domain table
  carries it (tenancy + the delete-path coverage tests force the decision anyway).
- **No feature module.** The sketch said `src/features/gear`; the shipped shape is
  `src/lib/gear.ts` + `src/db/gear.ts`, because the Today queue's gear rows live in
  `src/db/today.ts`, and `src/db` may not import `src/features` (the one-way layering
  `pnpm check:architecture` enforces). The surface is ordinary app routes at
  `/shop/[shopSlug]/gear`, like every other pillar's.
- **Reservations cascade from bookings and items** (`ON DELETE CASCADE`) rather than blocking
  them — a deleted booking frees its units, and pre-pilot (H-49) nothing mourns the row. A
  unit's own delete is offered only as the mistyped-row eraser, with an undo toast; the register's
  history-preserving exit stays `retired`.

Same-day review findings folded in before merge (dive-domain + security reviews, 2026-08-20):
a lapsed window splits on the handover stamp — a checked-out unit reads **overdue** (a phone
call) while a never-collected one reads **never picked up** and is closed by *release*, never a
fabricated return; the prep picker refuses to offer a unit that is physically out on a lapsed
window (it isn't on the wall) while a never-collected claim doesn't block; cancelling a booking
releases its un-collected units in the same transaction as the capability revoke; check-out is
conditional on the stamp being empty so a double-tap cannot rewrite when a unit left; the prep
picker words a unit's lapsed or looming bench clock in the option itself (informing at the
moment of the pick); and the assign action pins the booking to its trip so a stale tab cannot
bind another departure's booking to this one's window.

What shipped beyond the sketch's list, all inside its bounds: check-out/return stamps on the
reservation (`checked_out_at` / `returned_at`, so "reserved" and "out the door" stay
distinguishable and the returns panel has something to close), the prep page's assignment panel
(size-ranked suggestions from the diver's own fit; the window derived server-side from the trip),
three Today rows (`gear_overdue`, `gear_due_back`, `gear_service_due` — close-out leftovers come
free), `gear_service_events.csv` beside the two CSVs named above, and the seeded demo fleet.
The printable per-booking rental ticket named under "The pieces" was **not** built — the prep
page's assignment list prints with the packing list, and a per-booking ticket is filed as a
follow-up rather than silently dropped.


## Amendment 2026-08-20 — the print slip, and the second clock

Two pieces this ADR scoped and the first slice deliberately left out, both now
built at the product owner's direction.

**The per-booking rental slip** (`/shop/[shopSlug]/trips/[id]/prep/ticket/[bookingId]`).
Reached from the assignment row it is about, and only once that row has units on
it — a slip listing nothing is a wrong slip, not a short one. It says what the
diver has and when it is due back, and deliberately nothing else: no signature
line, because one shop-wide waiver is an invariant (CR-015) and a second
signed-looking slip is the fastest way to blur it; no money, because billing
lives on orders and a rental with no total beside one that has a total teaches a
staffer to look for one here. An e2e test asserts both absences on the slip
itself.

**Dual-clocked service intervals.** Manufacturers publish months *or* dives and
mean whichever comes first (ScubaPro: 24 months or 100 dives), and a rental
regulator in season reaches the dive number long before the date. A service
event may now carry `next_due_dives` beside `next_due_on`, and `gearServiceState`
reads the two together.

Three properties of that second clock are load-bearing:

- **It only escalates.** A unit under its dive count is not thereby fine — its
  date can still have passed — because "whichever comes first" is not "instead
  of".
- **The count is derived, never stored.** It sums the planned dives of the
  departures a unit came back from since its last service, so it cannot drift
  from the reservations it is read out of.
- **It is a floor, and every surface says so.** It counts the rentals the shop
  wrote down; a unit handed over on a handshake counts as zero. That is the
  right direction to be wrong in: a clock that runs slow tells a shop to service
  something they already did, where one that ran fast would quietly clear a
  regulator past its interval. Nothing gates on it — the register informs, as
  the original decision says.

A dive interval with no date beside it is **refused** rather than dropped: the
two are compared together, and a staffer who typed 100 and got silence would
have no way to tell it had not taken.

The open question this cannot answer is whether shops keep the register faithfully
enough for the count to mean anything. That is now §C3 of the first-call script,
and the answer changes how loudly this should be presented — or whether it earns
its place at all.


## Amendment 2026-08-21 — `retired` is gone; deleting a unit is the soft delete

Three things above are superseded by [20260820-every-delete-is-soft](20260820-every-delete-is-soft.md),
on the product owner's call: the `gear_item_status` sketch's third value, the
"escape hatch" that told a shop to retire every unit, and the 2026-08-20
amendment's line that "the register's history-preserving exit stays `retired`".

`gear_item_status` is now two values, `in_service` and `needs_service`. What
`retired` described — a unit the shop still owns, still has history for, and
will not rent again — turned out to be a soft delete wearing a word that ADR
ships banned: it kept the row, kept the service events, and dropped the unit out
of every picker, which is what `deleted_at` does for every other entity. So
`gear_items` carries `deleted_at` + `deleted_by_person_id` and a live-rows-only
partial index (the unique tag index too, so deleting "BCD #14" frees the tape
for the unit that replaces it and a restore is refused rather than doubling it),
every register read filters on it, and the escape hatch is *delete every unit*,
which loses nothing.

**Deleting refuses a unit that is still provisioned** — reserved for a day still
to come, or out on a rental now — the same call `deleteTrip` makes for a
departure with a roster, and for the same reason: hiding the unit would leave a
diver's assignment pointing at kit nobody can find. A lapsed claim nobody ever
collected does not block, matching what `listAvailableGearUnits` already
believes about where that unit physically is. The refusal is not a silent
no-op: it lands beside the Delete control naming the reservation that holds
the unit, worded from the page's own read so no diver's name rides in a URL.

The way back is the register's **Deleted** view, whose action is **Restore** —
without it the undo would last as long as a toast, and the unit's own URL is a
404 the moment it is deleted.
