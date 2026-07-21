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
  everywhere). Demo shop seed data; the `/shop/[shopSlug]/schedule` page as the first
  data-backed surface.
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
  transactional capacity enforcement in `src/db/bookings.ts`, one all-or-nothing reservation for
  up to six named divers, confirmation moment, sold-out/past states).
- ✅ Courses: a staff-owned catalog schedules instructor-led sessions on the trip/booking spine.
  Sessions snapshot waiver/C-card baselines; instructor-required sessions reject enrollment until
  an instructor is assigned, and existing-card courses admit only a verified card at the required
  level. Agency-specific ratios, age, medical, specialty, and exception rules remain H-08 review.
  Shops start from PADI/SSI catalog copies, then configure local and eLearning-inclusive prices
  and show/hide availability without deleting historical sessions.
- ✅ Booking confirmations email immediately through the Resend notification seam. The owner
  dashboard surfaces an unresolved delivery failure; email never affects the capacity-safe booking.
- ✅ Full trips offer a durable, first-come wait list. Entries remain separate from bookings and
  manifests; staff follow up manually when space opens. Automated offers and expiry policy remain
  future work.
- ✅ Recurring trips: staff schedule a weekly (or every-N-week) series in one action and it
  materializes independent, initially-identical trip instances on the shared spine, editable and
  cancellable per date ([20260719-recurring-trip-series](../architecture/decisions/20260719-recurring-trip-series.md)).
  Series-wide edits and a rolling horizon remain future work.

## M3 — Waivers (core slice complete)

- ✅ One versioned release per shop: staff edit a single waiver and each edit is saved as a new
  immutable version; completed records retain the exact title, version, and text a diver saw.
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
- ✅ Every waiver request uses the shop's single current release; the trip roster offers one status
  action rather than an on-demand template picker, while signed evidence retains its template
  snapshot.
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
  composes them (stricter level, union of specialties), fail-closed. Nitrox gates the mix request.
  See [20260718-specialty-site-cert-requirements](../architecture/decisions/20260718-specialty-site-cert-requirements.md).
- ✅ Direct card-image upload: a provider seam ([`src/lib/storage`](../../src/lib/storage)) stores a
  captured photo to Vercel Blob and saves a durable URL; validated at the seam (JPG/PNG/WebP,
  ≤5 MB). The staff form is upload-only, with no pasted-URL alternative. See
  [20260719-card-photo-only](../architecture/decisions/20260719-card-photo-only.md).
- ✅ Manual certification: certifying a C-card is a staff step, not an integration. Staff look the
  card number up with the issuing agency and click **Mark certified**; the card only affects
  readiness once certified. The earlier assistive agency-verification seam was removed — no agency
  exposes a usable C-card API, so it was speculative plumbing on a safety surface. See
  [20260721-manual-certification](../architecture/decisions/20260721-manual-certification.md)
  (supersedes [20260718-agency-cert-verification](../architecture/decisions/20260718-agency-cert-verification.md)).
- ✅ Person-first staff workspace: `/shop/[shopSlug]/divers` is the starting point for a diver;
  each person record owns their level and specialty cards, rental fit profile, bookings, and issued
  rental fit. The former cards-first certifications route remains a bookmark redirect. See
  [the person-spine ADR](../architecture/decisions/20260719-diver-person-spine.md).
- ✅ Payment readiness: a `booking_payments` state plus a per-trip `requires_payment` flag adds a
  `payment_due` blocker to the shared roll-up (paid/deposit/waived clear; absent = unpaid; a refund
  re-opens). Staff mark payment on the roster; online payment is taken by the Stripe Connect +
  invoicing flow below (the earlier single-account checkout seam was retired). See
  [20260718-payment-readiness](../architecture/decisions/20260718-payment-readiness.md).
- ✅ Stripe Connect + orders/invoices: a shop authorizes its own Standard Stripe account via OAuth
  (`/shop/[shopSlug]/settings/payments`); staff build an order from a diver's person page, invoice the connected
  account, review that diver's payment history in the same context,
  and refund paid invoice payments when needed. A Connect webhook
  (`/api/webhooks/stripe`) confirms `invoice.paid`/`voided` and account status changes back into
  the app, cascading paid/refunded orders to their booking's payment gate. See
  [20260719-stripe-connect-orders](../architecture/decisions/20260719-stripe-connect-orders.md)
  (the online capture/webhook confirmation this superseded from the prior entry). Tax and any
  platform fee remain H-07.
- ✅ Checkout at booking: a public booking (or party) on a priced trip at a Stripe-connected shop
  ends on the shop's own hosted Stripe Checkout; the webhook (or a direct API read when the diver
  beats it home) marks the bookings paid through the shared payment gate. Abandonment degrades to
  the ordinary unpaid booking, and an open session is reused via "Finish paying" on the
  confirmation. See
  [20260721-checkout-at-booking](../architecture/decisions/20260721-checkout-at-booking.md).
- ✅ Deposit + cancellation policy (mechanism): an optional per-trip deposit charges a partial at
  checkout and settles the booking to `deposit_paid` with the balance shown as due; an optional
  cancellation window is shown to divers and surfaced to staff as a refund-eligible cue (refunds
  stay staff-run). Both are opt-in and off by default, no default values — the policy *values*
  remain H-07. See
  [20260721-deposit-cancellation-policy](../architecture/decisions/20260721-deposit-cancellation-policy.md).

## M5 — Rental fit and trip prep (gear inventory removed)

- ✅ Equipment inventory, assignments, and service history were removed outright. DiveDay does not
  track individual items: shops that want an asset register have one, and a half-maintained
  duplicate was worse than none. What survives is what prep actually needs — sizes.
- ✅ A shop-scoped **rental fit** per diver records which pieces they take from the shop and in
  what size. It is a storage concept: it never reserves anything and never replaces a dock-side fit
  check. Divers set it themselves on their booking confirmation; staff maintain it on the diver
  record.
- ✅ A per-trip **prep list** is derived purely from rental fit and the dive plan: one tank per
  diver per planned dive, split air/nitrox, plus rental kit grouped by item and size with the
  divers each line is for. It prints. Rules in [`src/lib/dive-prep.ts`](../../src/lib/dive-prep.ts),
  assembly in [`src/db/rental-fit.ts`](../../src/db/rental-fit.ts), page at
  `/shop/[shopSlug]/trips/[id]/prep`.
- ✅ The two ways the list can be wrong — a diver with no fit on file, a nitrox request whose card
  is not verified — are stated at the top of the page and raised on Today, never buried.
- ✅ The diver-facing packing checklist is configured once at shop level and reused across trips.

## M6 — Boat manifests (implementation complete; field validation open)

- ✅ A derived per-trip manifest preserves every active booking alongside shared readiness,
  rental fit, mix, emergency contacts, and crew. Missing evidence is a visible blocker, never a
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
- ✅ Per-dive trip briefings: staff can publish one to four ordered dives with optional names, site
  briefings, and diver-facing notes while keeping the boat-day details shared.
- ⬜ Human field validation remains V-02: phone glare/wet-hand use, airplane-mode reload, extended
  outage, reconciliation conflict, and print fallback must pass before production operations. See
  [the offline ADR](../architecture/decisions/20260718-offline-manifest-snapshots.md).

## M7+ — Early operational slice shipped; integrations later

- ✅ Shop-owner workspace navigation: Today, Divers, and Schedule are the primary workspaces;
  preparation, planning, and business tools are grouped under More. See
  [the workspace navigation ADR](../architecture/decisions/20260719-shop-owner-workspace.md).
- ✅ Today is a work queue: a departure board for the boats sailing today, then a ranked list of
  jobs over the next week — blocked divers (collapsed per boat and per blocker), divers with no
  rental fit on file, nitrox requests with no verified card, unstaffed course sessions, freed seats on
  wait-listed trips, and failed booking emails. Every row links to the surface that clears it;
  nothing that the nav already reaches in one click appears. Rules in
  [`src/lib/today.ts`](../../src/lib/today.ts), assembly in [`src/db/today.ts`](../../src/db/today.ts).
  See [the Today work-queue ADR](../architecture/decisions/20260720-today-work-queue.md).
- ✅ Live staff operations, merged into the daily surfaces: actionable work (readiness blockers,
  missing rental fit, unstaffed instructor-required sessions) is on Today, and shop-level counts
  (departures, booked divers, open seats) are on Schedule. The standalone operations-report page was
  retired as duplication of these two surfaces.
- ✅ Nitrox as a per-booking request, billed per dive: a diver with a verified enriched-air card
  asks for it on their booking, and the request is refused at write time without one. Fail-closed
  persistence in [`src/db/nitrox.ts`](../../src/db/nitrox.ts); every read re-checks the card so a
  revoked card downgrades that diver to air. The analyzed-fill log was retired with gear inventory:
  a fill record referenced a tracked cylinder, and without one it was evidence about nothing.
  Whether a fill/analysis log should return in some tank-free form is open (V-05, H-11).
- ✅ Automated marine outlook: a mapped dive site supplies a clearly-labelled 10-day Open-Meteo
  water-temperature and sea-state fallback until the crew publishes its dated prediction. Underwater
  visibility remains crew-entered rather than being inferred from atmospheric visibility.
- ⬜ Payments/deposits, SMS and multi-channel notifications, deeper reporting,
  multi-boat/multi-shop configuration, and their provider/policy decisions.

## Delight backlog (applies across every milestone)

Cross-cutting quality work to fold into slices as they are touched, not defer to a final "polish"
pass:

- global command/search for staff once there are enough entities to justify it;
- keyboard-first staff workflows with visible shortcuts;
- optimistic interaction only where rollback is safe and obvious;
- undo for reversible staff actions instead of confirmation dialogs everywhere;
- activity history written in operational language;
- saved filters/views for common shop roles;
- thoughtful demo data that tells a realistic story;
- accessible motion, contrast, focus, and touch targets;
- performance budgets for staff pages on ordinary phones and weak marina Wi-Fi;
- event instrumentation for abandonment, blocker frequency, and staff recovery paths.

## Standing rule

If a milestone's slice can't be demoed in the browser, it isn't done. Every milestone ends with a
design review against [design/principles.md](../design/principles.md).
