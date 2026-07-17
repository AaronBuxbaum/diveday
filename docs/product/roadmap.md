# Roadmap

Sequencing guidance, not a contract. Each milestone ships a usable vertical slice. Re-order only
with a note here explaining why.

## M0 — Foundation ✅ (this PR)

Tooling, docs, agent layer, CI, design tokens. Everything after this leans on it.

## M1 — Spine: domain model, database, auth

- Choose and ADR: database + ORM, auth, hosting (see deferred decisions in
  [architecture/overview.md](../architecture/overview.md)).
- Core entities: shop, person (with roles), trip/session, booking. Seed data for a demo shop.
- Staff sign-in. Multi-tenancy from day one (a `shop_id` on everything beats a migration later).

## M2 — Bookings

- Shop-side: schedule calendar, create trips/courses, capacity, staff assignment.
- Diver-side: public booking page — the "under a minute" flow. This is the delight showcase;
  budget design time accordingly.

## M3 — Waivers

- Waiver templates, e-signature flow (pre-arrival via link), storage, status on the booking.
- Medical statement with physician-referral blocking state.

## M4 — Cert checks

- Card capture (photo + fields), verification workflow, requirements on trips/sites,
  "ready to board" status roll-up (waiver + cert + payment later).

## M5 — Gear

- Inventory with sizes and service state, assignment to bookings, service logging.

## M6 — Boat manifests

- Manifest view per trip, roll-call mode (big targets, offline-tolerant, works in sunlight),
  print/PDF export. The safety-critical milestone — domain review required.

## M7+ — Later

Payments/deposits, notifications (email/SMS), reporting, nitrox fill logs, multi-boat/multi-shop.

## Standing rule

If a milestone's slice can't be demoed in the browser, it isn't done. Every milestone ends with a
design review against [design/principles.md](../design/principles.md).
