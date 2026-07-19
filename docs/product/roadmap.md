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
- ✅ Hosting: Vercel selected and ADR'd. A managed Postgres adapter, environment ownership,
  migrations, backups, domain, and production validation remain H-04 work.
- ✅ Demo mode: one-click, self-serve trial into the seeded shop with a resettable playground,
  dynamically checked by the presence of a demo shop in the database rather than a global
  environment variable flag ([20260718-demo-mode](../architecture/decisions/20260718-demo-mode.md)
  superseded by [20260718-dynamic-demo-onboarding](../architecture/decisions/20260718-dynamic-demo-onboarding.md)).
  Per-visitor isolated shops and dynamic multi-tenant routing are fully live.

## M2 — Bookings (core complete)

- ✅ Shop-side: staff schedule trips (`/shop/[shopSlug]/trips/new` — local-time entry converted via
  `src/lib/zoned.ts`, capacity, validation, success moment on `/shop/[shopSlug]`).
- ✅ Shop-side: manage trips (`/shop/[shopSlug]/trips/[id]` — edit details, cancel/reinstate, crew
  assignment via `trip_assignments`, diver roster with booking cancel).
- ✅ Diver-side: public booking flow (`/shop/[shopSlug]/schedule/[id]` — no account, name + email,
  transactional capacity enforcement in `src/db/bookings.ts`, confirmation moment, sold-out/past states).
- ✅ Courses: a staff-owned catalog schedules instructor-led sessions on the trip/booking spine.
  Sessions snapshot waiver/C-card baselines; instructor-required sessions reject enrollment until
  an instructor is assigned, and existing-card courses admit only a verified card at the required
  level. Agency-specific ratios, age, medical, specialty, and exception rules remain H-08 review.
- ✅ Booking confirmations email immediately through the Resend notification seam. The owner
  dashboard surfaces an unresolved delivery failure; email never affects the capacity-safe booking.
- ✅ Full trips offer a durable, first-come wait list. Entries remain separate from bookings and
  manifests; staff follow up manually when space opens. Automated offers and expiry policy remain
  future work.

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
- ✅ Staff-triggered waiver links can be emailed through the same transactional notification seam;
  the staff-visible one-time link remains available if delivery fails.
- ✅ Richer, jurisdiction-aware medical questionnaire: a versioned RSTC/WRSTC form (and a UK
  variant) defined in [`src/lib/medical.ts`](../../src/lib/medical.ts), selected by the shop's
  jurisdiction on the waivers page. Completed waivers store the questionnaire id + version; any
  referral-flagged "yes" fails closed to physician review, and staff see the flagged questions in
  the waiver activity timeline.
- ✅ Durable delivery history + retries: every send appends to an append-only
  `notification_delivery_attempts` trail behind the denormalized latest state, and staff can retry a
  failed booking confirmation from the dashboard (waiver links re-issue instead, since their
  one-time token is never stored).
- ⬜ A third-party signature adapter remains follow-up work. See
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
- ✅ Specialty and site-level requirements: specialties (Deep/Wreck/Night/Drysuit) are captured and
  verified like level cards; dive sites and trips each carry a cert gate and the readiness service
  composes them (stricter level, union of specialties), fail-closed. Nitrox stays a fill-time gate.
  See [20260718-specialty-site-cert-requirements](../architecture/decisions/20260718-specialty-site-cert-requirements.md).
- ✅ Direct card-image upload: a provider seam ([`src/lib/storage`](../../src/lib/storage)) stores a
  captured photo to Vercel Blob and saves a durable URL; validated at the seam (JPG/PNG/WebP,
  ≤5 MB). The staff form is upload-only, with no pasted-URL alternative. See
  [20260719-card-photo-only](../architecture/decisions/20260719-card-photo-only.md).
- ✅ Agency cert verification: an assistive provider seam
  ([`src/lib/cert-verification`](../../src/lib/cert-verification)) checks a C-card against its
  issuing agency. A confirmed match auto-verifies (recording the source); not-found/mismatch only
  warn and leave the card pending; it fails closed to "unavailable". Human review stays
  authoritative. See
  [20260718-agency-cert-verification](../architecture/decisions/20260718-agency-cert-verification.md)
  (needs a gateway + `CERT_VERIFICATION_*` env, H).
- ✅ Person-first staff workspace: `/shop/[shopSlug]/divers` is the starting point for a diver;
  each person record owns their level and specialty cards, rental fit profile, bookings, and issued
  gear history. The former cards-first certifications route remains a bookmark redirect. See
  [the person-spine ADR](../architecture/decisions/20260719-diver-person-spine.md).
- ✅ Payment readiness: a `booking_payments` state plus a per-trip `requires_payment` flag adds a
  `payment_due` blocker to the shared roll-up (paid/deposit/waived clear; absent = unpaid; a refund
  re-opens). Staff mark payment on the roster; a Stripe checkout seam
  ([`src/lib/payments`](../../src/lib/payments)) mints a pay link when configured. See
  [20260718-payment-readiness](../architecture/decisions/20260718-payment-readiness.md).
- ✅ Stripe Connect + orders/invoices: a shop authorizes its own Standard Stripe account via OAuth
  (`/shop/[shopSlug]/settings/payments`); staff build an order from line items and invoice the
  connected account (`/shop/[shopSlug]/orders`), and a Connect webhook
  (`/api/webhooks/stripe`) confirms `invoice.paid`/`voided` and account status changes back into
  the app, cascading a paid order to its booking's payment gate. See
  [20260719-stripe-connect-orders](../architecture/decisions/20260719-stripe-connect-orders.md)
  (the online capture/webhook confirmation this superseded from the prior entry). Tax, refunds,
  deposits, cancellation policy, and any platform fee remain H-07.

## M5 — Gear (core prep slice complete)

- ✅ Inventory records type, size, service state, optional next-service date, and durable
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
- ✅ Diver booking-level rental requests capture a standard set, fit preferences, usual weighting,
  and notes; staff sees them while packing, but the request never reserves inventory or replaces a
  dock-side fit check.
- ✅ A shop-scoped rental size profile pre-fills a diver’s later requests. Staff can bulk-pack
  only currently available, requested gear; sized items require an exact requested/profile match,
  and every conditional inventory claim remains conflict-safe.

## M6 — Boat manifests (implementation complete; field validation open)

- ✅ A derived per-trip manifest preserves every active booking alongside shared readiness,
  assigned gear, emergency contacts, and crew. Missing evidence is a visible blocker, never a
  reason to omit a diver.
- ✅ Sunlight/phone-ready roll call has large explicit Boarded / Not boarded controls. A boarded
  event is rejected unless the shared readiness service clears that diver at the moment of action.
- ✅ Boarding history is append-only and tenant-scoped, recording the status, staff member, and
  timestamp; browser print/save-PDF uses the same manifest model.
- ✅ Explicit offline safety copy: all checkpoints are encrypted in IndexedDB with visible saved
  time, current/aging/stale state, bounded device retention, and a data-free cached shell. It never
  caches authenticated manifest HTML.
- ✅ Offline roll-call reconciliation: device events carry idempotency/source/snapshot evidence;
  the server rechecks current readiness and rejects older device events behind newer live history.
- ✅ Per-dive checkpoints: each trip records its planned dive count and keeps before-departure and
  after-each-dive head counts independent.
- ⬜ Human field validation remains V-02: phone glare/wet-hand use, airplane-mode reload, extended
  outage, reconciliation conflict, and print fallback must pass before production operations. See
  [the offline ADR](../architecture/decisions/20260718-offline-manifest-snapshots.md).

## M7+ — Early operational slice shipped; integrations later

- ✅ Shop-owner workspace navigation: Today, Divers, and Schedule are the primary workspaces;
  preparation, planning, and business tools are grouped under More, with dashboard handoffs that
  explain how the work connects. See [the workspace navigation ADR](../architecture/decisions/20260719-shop-owner-workspace.md).
- ✅ Live staff operations report: upcoming bookings, readiness blockers, rental requests, course
  sessions, and unstaffed instructor-required sessions, all derived from source-of-truth models.
- ✅ Nitrox fill logs: a verified enriched-air specialty card gates every fill; staff log an
  analyzed mix per diver/tank and the MOD is derived, not entered. Framework-free rules in
  [`src/lib/nitrox.ts`](../../src/lib/nitrox.ts); fail-closed persistence in
  [`src/db/nitrox.ts`](../../src/db/nitrox.ts); surfaces at `/shop/[shopSlug]/nitrox` and
  `/shop/[shopSlug]/trips/[id]/nitrox`. Provisional dive parameters are in
  [defaults-to-verify.md](defaults-to-verify.md#nitrox-fills) (H-11) and still need a
  dive-domain-expert review (V-05).
- ✅ Automated marine outlook: a mapped dive site supplies a clearly-labelled 10-day Open-Meteo
  water-temperature and sea-state fallback until the crew publishes its dated prediction. Underwater
  visibility remains crew-entered rather than being inferred from atmospheric visibility.
- ⬜ Payments/deposits, SMS and multi-channel notifications, deeper reporting,
  multi-boat/multi-shop configuration, and their provider/policy decisions.

## Standing rule

If a milestone's slice can't be demoed in the browser, it isn't done. Every milestone ends with a
design review against [design/principles.md](../design/principles.md).
