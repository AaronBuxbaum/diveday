# Shipped

What DiveDay has already built, as a scannable index. This is the "what exists" map; the *why* and
the exact mechanism live in the linked ADRs and the code. Open work — what is **not** yet built —
lives in [roadmap.md](roadmap.md), which this file keeps uncluttered.

Move an item here when its slice ships (compress it to a line or two and link its ADR); do not leave
it marked done in the roadmap. If code and this list disagree, one of them is wrong — fix it.

## Schedule builder, catalog paths, and the diver-copy completion (delivered 2026-07-30)

- **The schedule *is* the builder** — staff add a departure inline under any day, slide one to
  another day or time, copy it forward, or take an untouched one off, without leaving
  `/shop/[shopSlug]/schedule`. A move carries a multi-day course's whole shape; a copy takes the
  dive and none of the day (no roster, crew, or conditions); a removal refuses a departure anyone
  has booked, waitlisted, or counted heads against, and names which. Crew shows on each row, so the
  separate read-only staff list and staff schedule board are gone
  ([schedule-builder-and-course-paths](../architecture/decisions/20260730-schedule-builder-and-course-paths.md)).
- **Certification paths in the catalog** — a shop defines the order it walks divers through its own
  courses with an interactive builder at `/shop/[shopSlug]/courses/paths/[pathSlug]`: pick from the
  catalog, reorder, annotate each rung, watch the diver-facing trail rebuild live. Divers read it on
  the public course page, and it replaces the title-matching guess that decided what to suggest
  after a cert-blocked booking. Guidance, never a gate. Included in the shop's data export.
- **The diver-facing surface is fully translated** — trip page, course page, schedule calendar, and
  the waiver/readiness/recap capability pages all read from `src/i18n/locales/<locale>/diver.json`
  in English and Spanish, including the dock-day timeline and site-fit readings that used to return
  English prose out of `src/lib`. Staff copy remains inline English (still a stated gap).
- **Fewer round trips on the two hottest pages** — Today asked the readiness engine once per
  departure (about ten queries each, so ~60 to render a six-departure morning) and now asks once for
  the whole window; the public trip page asked per dive for a site's creatures and moments and now
  asks once for the day. Median server response for Today on the seeded demo: 263 ms → 165 ms
  ([performance-budgets](../architecture/performance-budgets.md)).
- **The diver trip page actually server-rendered again** — `DiverIntlProvider` passed next-intl only
  `locale` and `messages`, so the provider reached for a request config this app deliberately does
  not install, threw during the server render, and dropped every diver trip page to a blank
  client-only 200. Fixed by passing every config prop explicitly.

## Growth layer: reviews, discounts, SEO, and languages (delivered 2026-07-29)

- **Verified diver reviews** — a diver rates their day (and optionally writes) from their own
  post-trip recap link, so every review provably comes from someone who was on the boat. A bare
  rating publishes immediately; words wait for staff at `/shop/[shopSlug]/reviews`. The shop's
  rating and its released reviews show on the public schedule
  ([verified-diver-reviews](../architecture/decisions/20260729-verified-diver-reviews.md)).
- **Shop-wide promo codes** — staff mint a percent-off code at `/shop/[shopSlug]/promos` with an
  optional window, scope (trips / courses / both), and redemption cap; DiveDay creates the coupon on
  the shop's own Stripe account and records each paid redemption. Divers type it in the same box as a
  trip-scoped last-minute deal, and the trip-scoped code wins
  ([shop-promo-codes](../architecture/decisions/20260729-shop-promo-codes.md)).
- **Structured data and real titles on the booking pages** — the public schedule, trip, and course
  pages emit schema.org `ItemList`/`Event`/`Course` JSON-LD carrying price, remaining seats, and the
  shop's verified rating, plus per-shop titles and canonical URLs. Never emitted in embed mode or on
  a bearer-token page
  ([booking-page-structured-data](../architecture/decisions/20260729-booking-page-structured-data.md)).
- **The app speaks the visitor's language** — next-intl with per-locale JSON bundles, and the locale
  negotiated from `Accept-Language` (falling back to the shop's own default) with no switcher and no
  `/es/` URL. Every date, time, and money figure in the whole UI now follows that locale — 81
  compiled-in `en-US` call sites across 32 files are gone, staff screens included. Translated *copy*
  covers the diver-facing surface (schedule, trip, course, booking form, recap); Spanish ships
  alongside English. Staff copy is still inline English — a stated gap, not a claim — and the
  waiver/medical wording stays English pending H-01/H-03. `pnpm check:locale` guards both halves
  ([diver-copy-localization](../architecture/decisions/20260729-diver-copy-localization.md)).

## Diver experience and growth completion (delivered 2026-07-29)

- **Plan and share the dive** — every public trip offers a portable `.ics` calendar event, mapped
  directions when a location exists, and native share/copy-link controls; Discover Scuba explains
  how a giver can book and pay for the recipient without creating an account.
- **Honest conditions holds** — crew can pause new bookings without cancelling existing seats;
  the public trip explains the live state and best-effort email carries the crew note when delivery
  is configured. The transactional booking boundary rejects races after the page was loaded.
- **Rationed course progression** — only a confirmed diver whose current card is below the trip's
  requirement sees the shop's active Advanced Open Water path. Public controls retain the shared
  44 px target, semantic field/button, focus, and reduced-motion rules.

## Operations integrity and staffing (delivered 2026-07-29)

- **Staffing coverage view** — owner/manager shift planning shows working staff, teach/crew/captain
  capabilities, scheduled-trip coverage gaps, and keeps trip crew assignment as the boarding authority.
- **Tamper-evident waiver records** — newly signed and in-person waiver records carry a versioned
  HMAC integrity seal over their signed metadata; staff can review verified, mismatched, and legacy
  unsealed records ([staffing, waiver audit, and localized copy](../architecture/decisions/20260729-staffing-waiver-audit-and-localized-copy.md)).
- **Manifest change ritual** — roster, capacity, checkpoint, instructor, crew, and boarding-gate
  risks are enumerated before crew changes and covered by failure-mode tests.
- **Localization-ready capability copy** — the `LocalizedCopy` primitive for locale-keyed *data*.
  Its static-UI half is superseded by
  [diver-copy-localization](../architecture/decisions/20260729-diver-copy-localization.md).
- **Line-busting check-in** — `/shop/[shopSlug]/check-in` is a scanner-compatible counter queue:
  search a booking, recheck readiness, record arrival, and move to the next diver without opening
  the full guest roster.
- **Operational motion accents** — the manifest’s existing clean-slate close-out now uses a restrained
  one-ring “Board clean” signal, and the shared trip tabs use a sliding underline; both respect reduced
  motion. The ripple is already used when a trip checkpoint reaches `rollCallComplete`.

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
  retention, data-free cached shell; never caches authenticated manifest HTML. Saves and refreshes
  itself automatically while a device has signal, for every trip in a rolling 48-hour window across
  the whole shop — not only a trip whose live manifest someone opened. The offline shell lists every
  saved trip (soonest departure first), and `dive.day`'s root path falls back to that list when
  offline, so a captain never needs to have opened a specific trip first
  ([offline-manifest-snapshots](../architecture/decisions/20260718-offline-manifest-snapshots.md),
  [manifest-live-first](../architecture/decisions/20260718-manifest-live-first.md),
  [msw-offline-sync-only](../architecture/decisions/20260719-msw-offline-sync-only.md),
  [manifest-offline-copy-automation](../architecture/decisions/20260726-manifest-offline-copy-automation.md),
  [shopwide-offline-manifest-priming](../architecture/decisions/20260726-shopwide-offline-manifest-priming.md)).
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
  revoked card downgrades to air (`src/db/nitrox.ts`). Offered only to shops that fill nitrox at all
  (a "Nitrox fills" entry in the rental catalog, default off — most shops don't); a shop that hasn't
  enabled it never shows the request, its price, or the prep-list tank split.
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
  Every image URL the CSVs reference that DiveDay's own storage actually holds — certification cards,
  recap photos, dive-site and course imagery — now ships as a real file under `photos/` in the same
  bundle, so photos survive after the account closes, not just links to them
  ([export-bundled-photos](../architecture/decisions/20260724-export-bundled-photos.md)).
- **Diver/customer CSV importer** — Settings → Import contacts brings people, cards, rental sizes, and
  (2026-07-24) prior waiver acceptance in from a rival's export or DiveDay's own `contacts.csv`,
  matched by email so a re-import updates rather than duplicates. Imported cards land **`verified` and
  flagged `imported`** — DiveDay trusts a card the shop's own system already checked and surfaces a
  soft one-tap **Confirm card** nudge rather than re-capturing it as an unverified claim; card expiry
  applies and comes across with the card, and no card imports without a real number. The one gate the confirm actually holds is
  the **enriched-air fill** — an imported nitrox card gives plain air until confirmed (a nitrox card
  has no expiry backstop and a wrong fill is the highest-consequence failure), per `dive-domain-expert`
  review; boarding and depth clear immediately (product-owner decision H-20,
  [import-verified-cards](../architecture/decisions/20260724-import-verified-cards.md)). **Specialty
  cards (deep, wreck, night, drysuit) come across the same way** — from a specialty column or a
  certification row that names one — with the one difference that the specialty *gate* waits on the
  confirm, because a specialty authorizes a riskier dive; boarding still never waits (H-23,
  [import-specialty-cards](../architecture/decisions/20260725-import-specialty-cards.md)). A card's
  **expiry** travels with it, a past date included, and a diver's **dive insurance** comes across as
  free text. Confirming an imported specialty or nitrox card — the tap that opens the dive or the fill
  — requires an explicit **card sighting** the staffer attests to and the record keeps, and a
  **technical rating** (Advanced Nitrox, Trimix, CCR, cave, deco) imports as nothing rather than as the
  nearest-looking recreational rung, named in the preview so a shop knows to enter it by hand (H-24,
  [imported-card-sighting](../architecture/decisions/20260725-imported-card-sighting.md)). A row explicitly
  claiming a waiver was already accepted at the prior shop is likewise trusted — medical clearance
  included — and written as an `imported` record (H-17,
  [import-waiver-acceptance](../architecture/decisions/20260724-import-waiver-acceptance.md)); waiver/
  medical document links (image **or PDF**, 5 MB) are re-stored in DiveDay's own storage. A scope table
  states it all up front. **Prior visits** come across from the same file when it is a bookings or
  orders export (one row per booking, the customer repeated): each becomes an inert history line on
  the diver's profile — the date, the old system's own title, its own status word, and the price it
  recorded, all verbatim — merged into Shop history newest-first and marked imported. It is a booking
  record, never a dive record and never a trip: nothing reaches the schedule, a manifest, capacity, or
  reporting, and the amounts are display text nothing sums. A visit with no readable date is declined
  rather than dated by guess, and re-running the same export doesn't double anyone's history
  ([import-prior-visits](../architecture/decisions/20260725-import-prior-visits.md)). Pure
  prepare/validate in `src/lib/import.ts`, the write in `src/db/import.ts`
  ([contact-importer](../architecture/decisions/20260723-contact-importer.md)).
- **Public migration guides** — a `/switching` hub plus a live marketing page per named incumbent
  (EVE, DiveShop360, DiveAdmin, Smartwaiver): each states how to export the shop's own data from
  that system, renders the importer's `IMPORT_HONESTY_TABLE` scope table verbatim, and walks the
  DiveDay import. High-intent SEO capture of "leaving &lt;incumbent&gt;" searches and the third leg
  of the portability wedge. Every switching page (hub, incumbent guides, spreadsheet) also carries the
  shared **concierge switch offer** — a person will help you bring your data in *and*, if DiveDay is
  ever not right, take it back out, free (`SwitchingConcierge`, routed to `switch@dive.day`; an
  authorized service claim, H-20). Content in `src/lib/migration-guides.ts`, pages in
  `src/app/switching/` ([marketing.md](marketing.md#migration-guides)). Backups and the read API are
  the open follow-ons in [roadmap.md](roadmap.md).
- **FareHarbor guide (coexist-led)** (2026-07-24) — `/switching/fareharbor`, the same template with
  an optional `coexist` block, because FareHarbor is a booking/distribution *channel* (a general
  tours engine, Booking-Holdings-owned), not a records system to leave: the guide leads with "keep
  FareHarbor's storefront and network, run the dive day it can't" and offers the clean leave path
  (DiveDay takes the booking, the per-booking fee stops), over the shared export/scope/import
  mechanics. Every competitor claim is sourced and honesty-flagged (the ~6% fee is reported-only,
  not FareHarbor-published; no live sync claimed)
  ([assessments/fareharbor-positioning.md](assessments/fareharbor-positioning.md)).
- **Rezdy guide (coexist-led)** (2026-07-24) — `/switching/rezdy`, the second booking-channel guide
  on the same `coexist` template. Rezdy is a general tours engine (part of a PE-backed group with
  Checkfront and Regiondo) with a *monthly-subscription-plus-per-booking* model, so the leave pitch
  is the recurring fee rather than FareHarbor's per-booking cut; its export path is verified
  (self-serve Sales/Orders CSV plus an operator API), and the copy honestly concedes Rezdy's own
  portability-friendliness. The wider survey of who gets a guide next — WeTravel, Rezgo, Bókun,
  Bloowatch, Peek Pro, and why PADI/SSI are import rails, not switching targets — is in
  [assessments/switching-guide-landscape.md](assessments/switching-guide-landscape.md).
- **Marketing SEO substrate + try/run/leave repositioning** (2026-07-24) — the public pages argue
  the researched wedge instead of the category: home gains a "Safe to leave" portability band and
  founding-shop closing, `/product` a diver-arc moment (night-before brief, recap) and an "honest
  no" scope section, `/pricing` a nine-question objection FAQ (data exit, PADI/SSI, POS, switching
  cost); demo CTA on every sales page with a typed `demo_entered` funnel event; sitewide
  `metadataBase`/canonicals/OG card image, `robots.ts` + `sitemap.ts`, and `FAQPage` +
  `SoftwareApplication` JSON-LD reading price from `src/lib/marketing.ts`
  ([marketing.md](marketing.md),
  [archive/marketing-review-20260723.md](archive/marketing-review-20260723.md) M1–M5).
- **Sign-up reassurance + the trial half of the funnel** (2026-07-30) — `/onboard` stops asking for
  a password cold: a founding-shop eyebrow and three checkable reassurances beside the form (no
  card and no setup fee, the one-ZIP export that works on day one rather than only on the last, the
  founder-direct line), plus the page-level description/canonical/OG card every other public page
  already had. The funnel now measures both halves: a typed `trial_started` event fires when a shop
  is actually created, every "Start a trial" link carries `?from=<page>`, and the visitor-supplied
  tag passes through `eventSource()` so only the slug vocabulary our pages emit reaches the event
  stream. Closes the last two items of the 2026-07-23 marketing review
  ([archive/marketing-review-20260723.md](archive/marketing-review-20260723.md) M8 and M2's deferred
  trial-start event), which is now fully delivered and archived.
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

## Owner reporting (delivered 2026-07-23)

- **"How's your month" dashboard** at `/shop/[shopSlug]/reports` — revenue collected, bookings, seat
  fill, and waiver completion for the trips that sailed, with a per-trip breakdown and month
  navigation. Anchored to trip-departure month; revenue is the `paid`/`deposit_paid` booking
  payments. Pure `summarizeMonth` (`src/lib/reporting.ts`) over three aggregate queries
  (`src/db/reporting.ts`); owner/manager only (`canViewShopReports`). Answers the recurring buyer
  objection #5 ([owner-reporting](../architecture/decisions/20260723-owner-reporting.md)).
- **Seeded trailing quarter** — the demo shop back-fills already-sailed trips (this month, last, and
  the one before) with bookings, payments, signed waivers, and paid invoices, deterministically so
  the frozen-clock e2e/Argos fleet is stable (`seedHistory`). Demo-only, behind a `{ history }` flag
  the lean unit-test template and trial shops opt out of. Demo `orders` carry fabricated Stripe ids,
  so the order page disables Refresh/Void/Refund on a demo shop with a hover explanation.

## Staff role authorization (delivered 2026-07-24)

- **Real role boundaries on payment settings, refunds, waiver templates, diver deletion, and trip
  configuration** — five predicates in `src/lib/authz.ts` (`canManagePaymentSettings`, `canRefund`,
  `canManageWaiverTemplates`, `canDeleteDiver` → owner/manager; `canConfigureTrips` →
  owner/manager/instructor), with live DB-checked companions in `src/db/authz.ts`
  (`loadActiveStaffRoles` + `canPersonX`) so a demoted/disabled/deleted staff member loses the
  surface immediately. Enforced in both layers per ADR-0006 — each surface's page hides the control
  and its server action(s)/route re-check. Answers H-14 in
  [human-decisions.md](human-decisions.md#decision-register).
  See [20260724-role-authorization](../architecture/decisions/20260724-role-authorization.md).

## Account lifecycle emails (delivered 2026-07-26)

- **Welcome, verify-email, and password reset** — `/onboard` now sends a welcome note and a
  verify-email link right after account creation; `/forgot-password` issues a reset link
  (enumeration-safe — always the same generic response) and `/reset-password/[token]` sets a new
  password, signs the owner in, and sends a `password_changed` security notice. Hashed, expiring,
  one-time `account_tokens` (not the stateless recap-link shape); verification is tracked
  (`user_accounts.email_verified_at`) but does not yet gate sign-in
  ([account-lifecycle-emails](../architecture/decisions/20260725-account-lifecycle-emails.md)).

## Staff invite accounts (delivered 2026-07-26)

- **Team management at `/shop/[shopSlug]/settings/team`** — an owner/manager invites a named
  person by email with one or more staff roles; the invitee gets an emailed link to
  `/invite/[token]` to set their own password and land signed into the shop. Owner/manager can
  edit anyone's roles, resend a stale invite, and disable/re-enable or remove access. Reuses the
  `account_tokens` seam (`invite` purpose) and a new `invited` account status exactly as
  anticipated in [account-lifecycle-emails](../architecture/decisions/20260725-account-lifecycle-emails.md).
  A shop may never end up with zero owners — removing/disabling/demoting the last one is refused.
  See [staff-invite-accounts](../architecture/decisions/20260726-staff-invite-accounts.md).

## Schedule embed widget (delivered 2026-07-26)

- **A shop can put its live booking calendar on its own website** — `?embed=1` on the schedule/trip
  pages renders a compact, chrome-light surface reusing the existing booking logic untouched;
  Settings → Website embed generates a copy-paste `<iframe>` snippet and a plain `target="_blank"`
  "Book a dive" button link. Framing is denied site-wide by default (a prior gap — nothing had ever
  set `X-Frame-Options`) except on the two embeddable route/query combinations, enforced at the edge
  (`src/proxy.ts`, `isEmbeddableShopRoute`). Answers the schedule/embed gap named in
  [fareharbor-feature-gaps-20260726.md](assessments/fareharbor-feature-gaps-20260726.md).
  See [20260726-schedule-embed](../architecture/decisions/20260726-schedule-embed.md).

## Abandoned pay-at-booking checkout recovery (delivered 2026-07-26)

- **A diver who reserves a seat but doesn't finish paying gets a nudge email** — rides the existing
  daily reminders/recap cron (`GET /api/cron/reminders`), reconciles every candidate against Stripe
  before sending (a delayed webhook can leave a paid session looking `pending`), and refuses to send
  once the trip or any linked booking has been cancelled since checkout started. The purchaser's
  email is stored durably on `booking_checkouts.customer_email` at checkout-creation time rather
  than re-derived from the party's linked bookings. Answers the abandoned-cart gap named in
  [fareharbor-feature-gaps-20260726.md](assessments/fareharbor-feature-gaps-20260726.md).
  See [20260726-abandoned-checkout-recovery](../architecture/decisions/20260726-abandoned-checkout-recovery.md).

## Post-trip review request (delivered 2026-07-26)

- **A "Leave a review" section on the recap page** — one optional shop-level `shops.review_url` set
  once in Settings; the recap page renders a plain `target="_blank"` link to it when configured,
  nothing otherwise. No review-platform API integration, no click tracking, no sentiment gating (ToS
  risk). Rides the existing recap delivery rather than its own send. Answers the review-request gap
  named in [fareharbor-feature-gaps-20260726.md](assessments/fareharbor-feature-gaps-20260726.md).
  See [20260726-post-trip-review-request](../architecture/decisions/20260726-post-trip-review-request.md).

## Post-trip crew tipping (delivered 2026-07-26)

- **A diver can tip the crew from the recap page** — a full 100%-to-shop Stripe Checkout on the
  shop's own connected account, same merchant-of-record model as a booking checkout but tracked in a
  dedicated `tips` table so its simpler lifecycle never threads through the booking-payment gate.
  Three presets ($5/$10/$20) or a bounded custom amount ($1–$500), enforced server-side regardless of
  which the diver used. Inert until a shop both connects Stripe and has `chargesEnabled`. Answers the
  tipping gap named in [fareharbor-feature-gaps-20260726.md](assessments/fareharbor-feature-gaps-20260726.md).
  See [20260726-post-trip-tipping](../architecture/decisions/20260726-post-trip-tipping.md).

## Diver self-service booking cancel/reschedule (delivered 2026-07-27)

- **A diver can cancel or move their own unpaid booking from their readiness page** —
  `/ready/[token]` gains a "Need to change your plans?" section; reschedule books the destination
  trip *before* cancelling the source, inside one transaction, so a full or newly-unavailable
  destination never strands the diver seatless. Offered, and re-enforced server-side, only for an
  unpaid booking (paid/deposit-paid/waived still require staff). Cancellation reuses the same
  automated-refund logic the staff cancellation path already uses. Reviewed by `dive-domain-expert`
  and `security-reviewer` per AGENTS.md's hard rules for a manifest-mutating, token-authorized
  surface. Answers the self-service reschedule/cancel gap named in
  [fareharbor-feature-gaps-20260726.md](assessments/fareharbor-feature-gaps-20260726.md).
  See [20260727-diver-self-service-cancel](../architecture/decisions/20260727-diver-self-service-cancel.md).

## Last-minute fill promos (delivered 2026-07-27)

- **Shop-wide last-minute list + Stripe-backed discount codes** — divers opt in from the public
  schedule page (name, email, an optional date range they're around), separate from the existing
  per-trip **wait list**. Staff on a trip's Guests page see how many matching divers there are and
  can send a time-boxed discount: a real Stripe `Coupon` + `PromotionCode` on the shop's connected
  account, expiring at departure and capped at the trip's open-seat count, emailed to every match.
  The diver redeems it by typing the code on the booking form; it's validated against that exact
  trip before being handed to Stripe Checkout, so a code can't discount an unrelated booking. A
  **Today** work-queue card (`last_minute_fill`) nudges staff toward any under-capacity trip
  departing within 3 days that has never had a deal sent, and stops once one actually sends — not
  merely attempted. Answers the "every empty seat is money lost" gap. See
  [20260727-last-minute-fill-promos](../architecture/decisions/20260727-last-minute-fill-promos.md).

## Demand, crew, and staff context (delivered 2026-07-29)

- **Demand intelligence** — a full departure with a wait list of at least two divers or 25% of its
  capacity gets a calm prompt to add another boat or departure.
- **Conflict-safe crew assignment** — overlapping ordinary trips now count as conflicts (not only
  multi-day course windows), and staffed course changes cannot remove the last instructor or leave
  an already-booked entry-level PADI session over ratio.
- **Private notes and operational activity** — staff can add booking notes that no diver-facing
  surface reads; each note adds an append-only, plain-language activity sentence to the trip.

## Simplification rulings (2026-07-19 → 20 audit)

The cleanup audit executed in full; its durable "don't re-litigate this" rulings — separate
`/schedule` and `/trips` pages, public-route allowlist, per-test PGlite, split dive-site helpers,
retained superseded ADRs — live in
[architecture/overview.md](../architecture/overview.md#settled-shape-decisions). Navigation
unification, one notice system, the `reports`/`shop` cuts, the trial/demo split, honest marketing,
and the decomposition of the four monster pages all shipped.
