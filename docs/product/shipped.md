# Shipped

What DiveDay has already built, as a scannable index. This is the "what exists" map; the *why* and
the exact mechanism live in the linked ADRs and the code. Open work — what is **not** yet built —
lives in [roadmap.md](roadmap.md), which this file keeps uncluttered.

Move an item here when its slice ships (compress it to a line or two and link its ADR); do not leave
it marked done in the roadmap. If code and this list disagree, one of them is wrong — fix it.

## Foundation and spine (M0–M1)

- **Tooling, CI, agent layer, design tokens** — the base everything leans on. The agent layer is
  drift-checked: `pnpm check:agents` (in `check:repo`) keeps skills, the skill index, AGENTS.md
  references, reviewer agents, and `task:context` doc paths in sync.
- **Database + ORM** — Drizzle + Postgres, PGlite in dev/test with auto-migrate/auto-seed
  ([0005](../architecture/decisions/0005-database.md)); Neon in production
  ([Neon hosting](../architecture/decisions/20260718-vercel-neon-hosting.md)).
- **Core entities, multi-tenant** — shop, person (roles), trip, booking, `shop_id` everywhere;
  seeded demo shop; schedule page as the first data-backed surface.
- **Auth** — Auth.js v5 credentials + JWT, edge-safe proxy split
  ([0006](../architecture/decisions/0006-auth.md)); staff sign-in, protected `/shop`.
- **Hosting** — Vercel selected and ADR'd; production builds run migrations
  ([Vercel](../architecture/decisions/20260718-vercel-hosting.md),
  [Neon](../architecture/decisions/20260718-vercel-neon-hosting.md)). Remaining owner/backup/incident
  naming is H-04 in [human-decisions.md](human-decisions.md).
- **Demo mode / dynamic onboarding** — one-click trial into a per-visitor isolated shop, checked by
  the presence of a demo shop rather than a global flag
  ([dynamic-demo-onboarding](../architecture/decisions/20260718-dynamic-demo-onboarding.md),
  [trial-shops-are-not-demo](../architecture/decisions/20260720-trial-shops-are-not-demo.md)).

## Bookings (M2)

- **Staff scheduling + management** — schedule trips (local-time entry, capacity, validation),
  edit/cancel/reinstate, crew assignment, diver roster.
- **Public party booking** — no account, up to six named divers, transactional capacity enforcement
  (`src/db/bookings.ts`), confirmation moment, sold-out/past states.
- **Courses on the trip spine** — staff-owned catalog schedules instructor-led sessions; sessions
  snapshot waiver/C-card baselines; instructor-required sessions reject enrollment until staffed;
  shops start from PADI/SSI catalog copies and set local + eLearning prices and visibility
  ([course-single-visibility-state](../architecture/decisions/20260720-course-single-visibility-state.md),
  [course-page-media](../architecture/decisions/20260720-course-page-media.md),
  [course-page-simplification](../architecture/decisions/20260720-course-page-simplification.md)).
- **Booking confirmation email** through the Resend seam; delivery failure never affects the booking.
- **Durable wait list** — first-come, separate from bookings/manifests; freed-seat invite now sends
  ([trip-waitlist](../architecture/decisions/20260719-trip-waitlist.md)).
- **Recurring trip series** — weekly/every-N-week series materializes independent trip instances on
  the shared spine ([recurring-trip-series](../architecture/decisions/20260719-recurring-trip-series.md)).
- **Returning-diver picker + roster bulk waiver send** — adding a diver leads with a search of the
  shop's people (identity carries certs/waivers/fit/history); staff issue every outstanding waiver in
  one action.

## Waivers (M3)

- **One versioned release per shop** — each edit is a new immutable version; signed records retain
  the exact title/version/text.
- **Pre-arrival expiring completion links** — only a SHA-256 token hash stored; mobile-first
  typed-consent flow with saved progress, medical questions, and explicit un­available/expired states.
- **Roster status + medical-review blocker** — affirmative medical answers fail closed to physician
  review; staff activity explains issued/started/signed/blocked/replaced from stored evidence.
- **Jurisdiction-aware medical questionnaire** — versioned RSTC/WRSTC form and a UK variant in
  `src/lib/medical.ts`.
- **Sign once** — a completed signature is held against the diver and satisfies the gate on any of
  their bookings while current ([waiver-sign-once](../architecture/decisions/20260721-waiver-sign-once.md)).
- **Durable delivery history + retries** — append-only `notification_delivery_attempts`
  ([notification-attempt-history](../architecture/decisions/20260720-notification-attempt-history.md),
  [notification-delivery-status](../architecture/decisions/20260718-notification-delivery-status.md)).

## Cert checks (M4)

- **Cards captured pending** — agency, level, number, optional expiry, durable card-image reference;
  new evidence is never implicitly trusted.
- **Fail-closed readiness** — a typed result combines waiver + cert evidence and explains missing,
  pending, expired, insufficient, medical-review, and unconfigured states; shared by staff roster,
  booking confirmation, and manifest.
- **Specialty + site/trip cert gates** — Deep/Wreck/Night/Drysuit captured and verified; readiness
  composes trip and site gates (stricter level, union of specialties); nitrox gates the mix request
  ([specialty-site-cert-requirements](../architecture/decisions/20260718-specialty-site-cert-requirements.md)).
- **Direct card-image upload** to Vercel Blob behind `src/lib/storage`, validated at the seam
  ([card-photo-only](../architecture/decisions/20260719-card-photo-only.md),
  [card-image-storage](../architecture/decisions/20260718-card-image-storage.md)).
- **Manual certification** — staff look the number up with the agency and click Mark certified; the
  earlier agency-verification seam was removed as speculative
  ([manual-certification](../architecture/decisions/20260721-manual-certification.md), supersedes
  [agency-cert-verification](../architecture/decisions/20260718-agency-cert-verification.md)).
- **Person-first workspace** — `/shop/[shopSlug]/divers`; each person owns cards, rental fit,
  bookings ([diver-person-spine](../architecture/decisions/20260719-diver-person-spine.md)).

## Payments (Stripe Connect)

- **Payment readiness** — `booking_payments` + per-trip `requires_payment` add a `payment_due`
  blocker to the shared roll-up ([payment-readiness](../architecture/decisions/20260718-payment-readiness.md)).
- **Stripe Connect + orders/invoices** — shops authorize their own Standard account via OAuth; staff
  build orders, invoice, review payment history, and refund; a webhook confirms payment back into the
  app ([stripe-connect-orders](../architecture/decisions/20260719-stripe-connect-orders.md)).
- **Checkout at booking** — a public booking on a priced, Stripe-connected trip ends on the shop's
  hosted Stripe Checkout; paid state comes only from the webhook / API read
  ([checkout-at-booking](../architecture/decisions/20260721-checkout-at-booking.md)).
- **Deposit + cancellation-window mechanisms** — opt-in per-trip `deposit_cents` and
  `cancellation_window_hours`, off by default, no default values
  ([deposit-cancellation-policy](../architecture/decisions/20260721-deposit-cancellation-policy.md)).
- **Automated cancellation refund** — cancelling inside a stated window refunds through the shop's own
  account, degrading to staff-run everywhere else
  ([automated-cancellation-refund](../architecture/decisions/20260721-automated-cancellation-refund.md)).

> The deposit/window **values**, percentage-vs-flat deposits, tax, and any platform fee remain
> open policy — H-07 in [human-decisions.md](human-decisions.md).

## Rental fit and trip prep (M5)

- **Gear inventory removed** — DiveDay tracks sizes, not individual items; assignments and service
  history were removed outright.
- **Rental fit per diver** — a shop-scoped size record; never reserves, never replaces a dock-side
  fit check. Divers set it on their confirmation; staff maintain it on the diver record.
- **Derived per-trip prep list** — one tank per diver per planned dive (split air/nitrox) plus rental
  kit grouped by item and size; the two ways it can be wrong (no fit on file, unverified nitrox) are
  raised, never buried. Rules in `src/lib/dive-prep.ts`; page at `/shop/[shopSlug]/trips/[id]/prep`.
- **Shop-level packing checklist** reused across trips.

## Boat manifests (M6)

- **Derived per-trip manifest** — every active booking with shared readiness, rental fit, mix,
  emergency contacts, and crew; missing evidence is a visible blocker, never an omission.
- **Sunlight/phone roll call** — large Boarded / Not boarded controls; a boarded event is rejected
  unless the shared readiness service clears the diver at the moment of action.
- **Append-only boarding history**, tenant-scoped; browser print/save-PDF uses the same model.
- **Encrypted offline snapshots** — IndexedDB with visible freshness (fresh/aging/stale), bounded
  retention, data-free cached shell; never caches authenticated manifest HTML
  ([offline-manifest-snapshots](../architecture/decisions/20260718-offline-manifest-snapshots.md),
  [manifest-live-first](../architecture/decisions/20260718-manifest-live-first.md),
  [msw-offline-sync-only](../architecture/decisions/20260719-msw-offline-sync-only.md)).
- **Offline reconciliation** — device events carry idempotency/source/snapshot evidence; the server
  rechecks readiness and rejects stale device events behind newer live history.
- **Per-dive checkpoints + briefings** — independent before-departure and after-each-dive head
  counts; staff publish one to four ordered dives with names, site briefings, and diver notes
  ([trip-dive-briefings](../architecture/decisions/20260719-trip-dive-briefings.md)).

> **Not yet done:** human field validation of the offline manifest (V-02) — the one manifest item
> still open. Tracked in [roadmap.md](roadmap.md) and [human-decisions.md](human-decisions.md).

## Operational surfaces (M7)

- **Shop-owner workspace nav** — Today, Divers, Schedule primary; prep/planning/business under More
  ([shop-owner-workspace](../architecture/decisions/20260719-shop-owner-workspace.md)).
- **Today work queue** — a departure board plus a ranked week of jobs (blocked divers, missing rental
  fit, unverified nitrox, unstaffed sessions, freed seats, failed emails); every row links to the
  surface that clears it ([today-work-queue](../architecture/decisions/20260720-today-work-queue.md)).
- **Role-aware landing** — a captain/divemaster's board leads with the boat they crew; an
  instructor's opens with their sessions ([role-aware-landing](../architecture/decisions/20260721-role-aware-landing.md)).
- **Nitrox as a per-booking request** — a verified enriched-air card is re-checked at every read; a
  revoked card downgrades to air (`src/db/nitrox.ts`).
- **Automated marine outlook** — a 10-day Open-Meteo water-temp/sea-state fallback until the crew
  publishes its own; visibility stays crew-entered
  ([automated-marine-outlook](../architecture/decisions/20260718-automated-marine-outlook.md)).
- **Notifications** — booking confirmation, waiver link, and wait-list invite through one `notify()`
  (email) seam; a Twilio `notifySms()` seam adds SMS, used today by the scheduled 7-day/24-hour
  pre-trip reminders (the WhatsApp channel exists at the seam but no flow requests it yet). All
  degrade to `not_configured` until their env is set
  ([sms-whatsapp-notifications](../architecture/decisions/20260721-sms-whatsapp-notifications.md),
  [scheduled-reminder-cadence](../architecture/decisions/20260721-scheduled-reminder-cadence.md)).
- **Full-shop data export** — Settings → Data export downloads one ZIP of documented CSVs (leading
  with an import-ready `contacts.csv`) plus a README manifest; the "leave anytime" half of the
  data-portability wedge ([full-shop-export](../architecture/decisions/20260722-full-shop-export.md)).
- **Diver/customer CSV importer** — Settings → Import contacts brings people, cards, and rental sizes
  in from a rival's export or DiveDay's own `contacts.csv`, matched by email so a re-import updates
  rather than duplicates. The safety spine holds: imported certs land **claimed, never verified**,
  no card number means no card, and medical answers never import (fail-closed); a scope table states
  all of it up front. Pure prepare/validate in `src/lib/import.ts`, the write in `src/db/import.ts`
  ([contact-importer](../architecture/decisions/20260723-contact-importer.md)). Migration guides,
  backups, and the read API are the open follow-ons in [roadmap.md](roadmap.md).
- **Night-before brief + post-trip recap** — the 24-hour reminder becomes a plain-language
  night-before brief (conditions, what to bring, dock time, who to text; softer first-timer voice),
  and after departure an automatic `/recap/[token]` gives each diver a shareable page of the sites
  they dived with a bring-a-buddy nudge, sent once per booking on the reminders cron
  ([post-trip-recap](../architecture/decisions/20260723-post-trip-recap.md)). The crew shout-out and
  diver photo upload follow-ons shipped 2026-07-23 (see below).

## UX arc — making the surfaces *act* (delivered 2026-07-23)

The [2026-07-21 UX audit](archive/ux-audit-20260721.md) found the surfaces existed but only *pointed* instead
of *doing*. Its entire P0–P1 plan (WP-1…WP-11) and P2 items shipped:

- **One-tap waiver send** from Today and Blockers, with per-trip batch send and no-email fallback
  (shared `src/db/waiver-issue.ts`). No imperative label merely navigates. *(WP-1)*
- **Transactional `/ready` page** — sign, pay, save rental fit, add emergency contact, `tel:`/`mailto:`
  contact; honest copy that never claims an email is coming; the ready link rides the confirmation
  email. *(WP-2)*
- **Booking + confirmation above the content** on the public trip page. *(WP-3)*
- **Emergency contact collected** from the waiver flow and `/ready`; surfaced as a low-severity
  dock-settleable nudge on boats within 3 days. *(WP-4)*
- **Forgiving booking form** — autocomplete, optional lead phone, email-typo nudge, `useActionState`
  that keeps input on failure; the dead `buddyPreference` column it named for deletion was removed. *(WP-5)*
- **Instant pending boarding** — the boarding tap shows "Boarding…" immediately and never renders a
  confirmed ✓ before the server clears the diver (via `useActionState`, server-authoritative). *(WP-6)*
- **One undo model** — the manifest re-tap un-board; the reversible-vs-confirm rule is in
  [design/principles.md](../design/principles.md). *(WP-7)*
- **Global command palette (⌘K) + nav search** over divers and trips; live Divers filter. *(WP-8)*
- **Waitlist that recovers seats** — one-tap invite with `invitedAt` and a copyable fallback on the
  trip waitlist section, now also from the Today freed-seat row. *(WP-9; Today follow-on shipped 2026-07-23.)*
- **Trip sub-nav** (Overview · Guests · Manifest · Prep) on every trip surface; boarding is a
  Manifest checkpoint, not a separate page. *(WP-10)*
- **Honesty/dead-end fixes** — real waiver stepper, waiver completion links to `/ready`, Today
  email-resend, staff-voiced empty states, duplicate-person hint, payment-source label. *(WP-11)*
- **List scale** — keyset pagination and server-side search on Divers/Schedule; booking-page content
  folded below the seat.

## Section 7 follow-ons + Delight backlog (delivered 2026-07-23)

The roadmap's §7 smaller follow-ons and the whole open Delight backlog shipped:

- **Series-wide edit, cancel, and rolling horizon** — a "Repeating series" section on the trip page
  applies one date's template across the run, cancels every upcoming date at once, and rolls the
  finite horizon forward on the same cadence (`extendTripSeries`, `weeklyOccurrencesAfter`);
  instances stay independent ([recurring-trip-series](../architecture/decisions/20260719-recurring-trip-series.md)).
- **Waitlist invite from Today** — the freed-seat row carries the front-of-line entry and reuses the
  one-tap invite control, so staff fill a seat without leaving the queue (extends WP-9).
- **Post-trip recap extras** — a crew shout-out (`trips.recap_shoutout`) renders on every diver's
  recap, and divers attach their own photos (`recap_photos` + `storeRecapImage`), which staff
  moderate from the roster ([post-trip-recap](../architecture/decisions/20260723-post-trip-recap.md)).
- **Generic undo** — the reversible card deletes land immediately and offer a 5-second undo toast
  instead of a confirm dialog (`restoreCertification`/specialty/nitrox; reusable `UndoToast`).
- **Optimistic interaction** — a true `useOptimistic` payment-status control flips instantly and
  reconciles on the server; boarding stays server-authoritative (never optimistic on safety state).
- **Visible keyboard shortcuts** — a `g`-sequence jumps between surfaces and `?` opens a shortcuts
  cheat-sheet, beyond ⌘K.
- **Saved views** — the diver roster has role-preset chips (All / Missing contact / Has insurance)
  plus per-shop browser-saved custom views, over a cheap `listDiverSummaries` facet.
- **Performance budget** — the shared first-load JS is gzip-measured after build and gated in CI
  ([performance-budgets](../architecture/performance-budgets.md)).
- **Event instrumentation** — a typed `src/lib/analytics.ts` seam for staff recovery, blocker
  frequency, and checkout abandonment ([event-instrumentation](../architecture/decisions/20260723-event-instrumentation.md)).
- **DAN / dive-insurance field** — `people.dive_insurance`, captured and shown on the diver profile.

## Simplification rulings (2026-07-19 → 20 audit)

The cleanup audit executed in full; its durable "don't re-litigate this" rulings — separate
`/schedule` and `/trips` pages, public-route allowlist, per-test PGlite, split dive-site helpers,
retained superseded ADRs — live in
[architecture/overview.md](../architecture/overview.md#settled-shape-decisions). Navigation
unification, one notice system, the `reports`/`shop` cuts, the trial/demo split, honest marketing,
and the decomposition of the four monster pages all shipped.
