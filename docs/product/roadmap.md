# Roadmap

Sequencing guidance, not a contract. Each milestone ships a usable vertical slice. Re-order only
with a note here explaining why.

Human-owned decisions, approvals, and validation are tracked in
[human-decisions.md](human-decisions.md).

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

## M3 — Waivers (core slice complete)

- ✅ Versioned staff templates: a new release is a new immutable version; completed records retain
  the exact title, version, and text a diver saw.
- ✅ Pre-arrival, expiring completion links; only a SHA-256 token hash is stored. Pending links can
  be safely superseded without changing signed history.
- ✅ Mobile-first typed-consent flow with saved progress, acknowledgement, medical questions,
  completion confirmation, and explicit unavailable/expired/already-completed states.
- ✅ Booking roster status with signed timestamp and an unambiguous **medical review** blocker;
  affirmative medical answers fail closed rather than becoming a generic success.
- ✅ Staff roster activity explains issued, started, signed, medically blocked, and replaced links
  from stored evidence without exposing a bearer token.
- ⬜ Production notification delivery, richer jurisdiction-specific medical questionnaires, and a
  third-party signature adapter remain follow-up work. See
  [20260718-waiver-signature-retention](../architecture/decisions/20260718-waiver-signature-retention.md).

## M4 — Cert checks (core slice complete)

- ✅ Capture agency, level, card number, optional expiry, and a durable card-image reference; new
  evidence starts **pending**, never implicitly trusted.
- ✅ Staff verification/rejection workflow and per-trip requirements kept separate from a diver’s
  cards.
- ✅ A typed, fail-closed readiness result combines waiver and certification evidence. It explains
  missing, pending, rejected, expired, insufficient, medical-review, and unconfigured states in
  staff and diver-facing language.
- ✅ Staff trip roster, public booking confirmation, and future manifest code share the same
  readiness service.
- ⬜ Direct image upload/storage, agency API verification, specialty/site-level requirements, and
  payment readiness remain follow-up work.

## M5 — Gear (core prep slice complete)

- ✅ Inventory records type, size, service state, optional next-service date, and clear
  unavailable/assigned/held status.
- ✅ Staff can pack available equipment directly against a trip roster; the transactional gate
  prevents an item from being claimed twice and makes a hold or retirement unassignable.
- ✅ Returns move equipment back into the visible packing pool, while the gear-room view retains
  checked-out equipment until it comes back.
- ✅ A completed service event records the work, staff member, completed date, and optional next
  due date before returning held equipment to service. Checked-out and retired gear cannot be
  released through this path.
- ✅ Staff can retire returned or held equipment; checked-out equipment cannot be removed from a
  diver's active assignment.
- ⬜ Diver sizing/preferences, booking-level requests, and bulk recommendations remain follow-up
  work.

## M6 — Boat manifests (live core slice complete)

- ✅ A derived per-trip manifest preserves every active booking alongside shared readiness,
  assigned gear, emergency contacts, and crew. Missing evidence is a visible blocker, never a
  reason to omit a diver.
- ✅ Sunlight/phone-ready roll call has large explicit Boarded / Not boarded controls. A boarded
  event is rejected unless the shared readiness service clears that diver at the moment of action.
- ✅ Boarding history is append-only and tenant-scoped, recording the status, staff member, and
  timestamp; browser print/save-PDF uses the same manifest model.
- ⬜ Offline snapshots, freshness/reconciliation state, per-dive checkpoints, and field testing
  remain follow-up work. The live-only boundary is deliberate and documented in
  [20260718-manifest-live-first](../architecture/decisions/20260718-manifest-live-first.md).

## M7+ — Later

Payments/deposits, notifications (email/SMS), reporting, nitrox fill logs, multi-boat/multi-shop.

## Standing rule

If a milestone's slice can't be demoed in the browser, it isn't done. Every milestone ends with a
design review against [design/principles.md](../design/principles.md).
