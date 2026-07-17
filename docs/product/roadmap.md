# Roadmap

Sequencing guidance, not a contract. Each milestone ships a usable vertical slice. Re-order only
with a note here explaining why.

## M0 — Foundation ✅ (this PR)

Tooling, docs, agent layer, CI, design tokens. Everything after this leans on it.

## M1 — Spine: domain model, database, auth (in progress)

- ✅ Database + ORM chosen and ADR'd ([0005](../architecture/decisions/0005-database.md):
  Drizzle + Postgres, PGlite in dev/test with auto-migrate/auto-seed).
- ✅ Core entities: shop, person (with roles), trip, booking — multi-tenant (`shop_id`
  everywhere). Demo shop seed data; `/trips` schedule page as the first data-backed surface.
- ⬜ Auth: choose and ADR (Better Auth / Auth.js / Clerk), staff sign-in.
- ⬜ Hosting: choose and ADR when something needs deploying.

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
