# 20260815-minimal-gear-register — Add an opt-in, presence-based gear register beneath rental fit, never replacing it

- **Status:** Proposed
- **Date:** 2026-08-15

**Proposed, deliberately.** This is [roadmap §3](../../product/features/roadmap.md#3-minimal-gear-register-an-m5-reversal-deliberately-smaller),
which the roadmap already marks **ADR required** because it reverses a shipped decision (M5,
[shipped.md](../../product/shipped.md#rental-fit-and-trip-prep-m5)). Accepting it is a
product-owner decision. Scope with
[20260815-outbound-integration-webhooks-and-zapier](20260815-outbound-integration-webhooks-and-zapier.md)
in mind — the register is designed to be that ADR's first genuinely new payload, not built in
isolation and retrofitted onto it later.

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
  surface at `/shop/[shopSlug]/gear` (new feature module, per
  [20260730-feature-module-contracts](20260730-feature-module-contracts.md)) lists items, their
  current reservation if any, and status.
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
