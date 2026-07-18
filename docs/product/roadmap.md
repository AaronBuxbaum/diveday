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
- ✅ Auth chosen and ADR'd ([0006](../architecture/decisions/0006-auth.md): Auth.js v5
  credentials + JWT, edge-safe proxy split). Staff sign-in live; protected `/shop` dashboard.
- ⬜ Hosting: choose and ADR when something needs deploying.
- ✅ Demo mode: one-click, self-serve trial into the seeded shop with a resettable playground,
  gated so it never appears in a real shop's production instance
  ([20260718-demo-mode](../architecture/decisions/20260718-demo-mode.md)). Builds on the demo
  seed + staff auth; per-visitor isolated shops wait on multi-tenant routing.

## M2 — Bookings (core complete)

- ✅ Shop-side: staff schedule trips (`/shop/trips/new` — local-time entry converted via
  `src/lib/zoned.ts`, capacity, validation, success moment on `/shop`).
- ✅ Shop-side: manage trips (`/shop/trips/[id]` — edit details, cancel/reinstate, crew
  assignment via `trip_assignments`, diver roster with booking cancel).
- ✅ Diver-side: public booking flow (`/trips/[id]` — no account, name + email, transactional
  capacity enforcement in `src/db/bookings.ts`, confirmation moment, sold-out/past states).
- ⬜ Courses: deferred until cert levels and DSD rules exist (M4) — a course session without
  prerequisite gating is just a trip, and shops can schedule it as one meanwhile.
- ⬜ Booking notifications (email confirmations) — arrives with M7 notifications.

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
