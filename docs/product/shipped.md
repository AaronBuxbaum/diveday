# Shipped

What DiveDay has already built, as a scannable index. This is the "what exists" map; the *why* and
the exact mechanism live in the linked ADRs and the code. Open work — what is **not** yet built —
lives in [features/roadmap.md](features/roadmap.md), which this file keeps uncluttered.

Move an item here when its slice ships (compress it to a line or two and link its ADR); do not leave
it marked done in the roadmap. If code and this list disagree, one of them is wrong — fix it.

## Trip surfaces after a walk-through (delivered 2026-08-04)

A product-owner pass over the boat loop, mostly subtraction. The manifest's typed **"crew aboard at
&lt;checkpoint&gt;" attestation is gone**: the named crew list is now the whole crew half of a head
count, and a trip with nobody on its crew list holds the checkpoint open under its own reason
(`crew_none_assigned`) with an **"Add crew to trip"** button as the way out, instead of a number to
type. Roll-call rows tell their two recorded outcomes apart by hue — aboard green, left ashore amber
— with awaiting in neutral slate; the status pill and the "Ready" chip now appear only where the
buttons beside them do not already say the same thing. **Boat mode** (was "Contrast: Auto / Standard
/ Maximum", plus a redundant "Glare mode active ☀" chip) is now one Auto / Land mode / Boat mode
control that belongs to the whole trip, not the Manifest tab alone. Print / save PDF sits in the
same place on every tab. The **incident-ready export is owner-only** — the manifest stays open to the
crew who run the roll call, but the shop's evidentiary account of a departure is the owner's to
produce, and the route refuses however it is reached. Smaller: the Celebrations line now says
*today* / *coming up* / *just had* rather than one sentence for all three; a confirm-guarded resend
settles back to its status instead of sitting open on an answered question; and a waiver that could
not be mailed because `APP_HOST` is unset says exactly that rather than blaming a missing email
provider. See
[20260804-crew-roll-call-is-per-person](../architecture/decisions/20260804-crew-roll-call-is-per-person.md).

## Weather blow-out cancellation cascade (delivered 2026-08-04)

The brainstorm's Revenue And Recovery big bet, first slice. Staff tap "Weather blow-out…" on a
departure and confirm once: the trip is cancelled through the existing `setTripStatus` machinery,
and every booked diver gets one message — what happened, their money story, and up to three
rebooking links filtered through the real booking-time admission gate (`decideTripAdmission`) to
departures they actually qualify for. A cascade record at
`/shop/[shopSlug]/schedule/blowout/[tripId]` tracks per diver: message state (sent / retrying /
failed / no email), payment position, the offers their message carried, and a live
rebooked-vs-unresolved state — the blow-out isn't over until that column empties. Sends are
idempotent and resumable; no money moves (refunds stay per-booking, H-14 gate intact).
Alternative-day salvage and a courtesy text channel are the named follow-ons. See
[20260804-blowout-cascade](../architecture/decisions/20260804-blowout-cascade.md).

## Buddy pairs in roll call (delivered 2026-08-04)

Staff pair divers into buddy teams on the manifest, and roll call stops being a flat list: when
one buddy is back aboard and the other is not — the state a real deck watches for — the pair and
the returned diver's row both say so, loud after a dive and as a heads-up at the dock. Pairs are
exactly two bookings of one departure, DB-enforced to at most one pair per diver, explicit to
make and to dissolve, and they **inform only** — never readiness, admission, capacity, or
checkpoint completeness. The offline copy shows pairs read-only by name and says the split-pair
read belongs to the live roll call; the export bundle carries the standing pairs as
`buddy_pairs.csv`. Seeded on the demo reef boat (two teams plus the normal odd remainder). See
[20260804-buddy-pairs](../architecture/decisions/20260804-buddy-pairs.md).

## Scheduled backup export to shop-owned storage (2026-08-04)

Roadmap §1's first remaining bullet, delivered: every week a shop's full export bundle — the same
documented CSVs, README, and bundled photos as the on-demand download, with the shop-wide
`trips.ics` calendar riding along — lands in an S3-compatible bucket the *shop* owns (AWS S3,
Cloudflare R2, Backblaze B2, MinIO). Configured at Settings → Backups: destination form, one-click
test delivery, and a paged delivery history where every failure is a named, coded row. The secret
access key is sealed with `secret-box` and never returned to anyone; uploads are hand-signed SigV4
(no SDK dependency); the weekly cron is idempotent per shop per ISO week and treats next week as
the only retry. "Switching is safe" is now a standing fact in the shop's own bucket, not a button
someone has to remember. See
[20260804-shop-owned-backup-export](../architecture/decisions/20260804-shop-owned-backup-export.md)
and §2b of the [backup-and-restore runbook](../engineering/backup-and-restore-runbook.md).

## End-of-day close-out — the "everyone is home" ritual (2026-08-04)

The brainstorm's end-of-day close-out, delivered as Today's evening mirror at
`/shop/<slug>/close-out`: every departure of the shop-local day judged by its head count (read off
`listRollCallGaps`, never re-derived), today's unresolved queue rows each given an explicit
**carry/dismiss** choice, and tomorrow's first blockers as the parting glance. Closing the day is
an append-only recorded act (`day_closeouts`: who, when, and the outstanding snapshot recomputed
server-side at close time) — **never a gate**: an open after-dive count or a boat still out makes
the close a by-name acknowledgement, not an impossibility, and nothing downstream conditions on the
row. Carry/dismiss is a memory, not a filter — tomorrow's queue keeps deriving from the source of
truth. Gear-return reconciliation from the original idea is deliberately out of scope until a gear
register exists. See [20260804-day-closeout](../architecture/decisions/20260804-day-closeout.md)
and the glossary's "Close-out".

## Incident-ready export (delivered 2026-08-04)

- **One tap on a departure produces the document a shop hands to authorities or insurers.** From
  the manifest, "Incident-ready export" opens a staff-only, print-optimized page
  (`/shop/<slug>/trips/<id>/incident-export`) assembling the departure's recorded facts: the
  manifest roster with each diver's per-checkpoint roll-call state, the complete append-only
  roll-call timeline (corrections included — history is never laundered), each diver's
  certification evidence as held (imported cards marked distinctly), waiver **status** only — state,
  date, template version; medical questionnaire answers never appear — the buddy pair staff
  recorded for the departure (team number, buddy name, and who paired them when), plus crew, crew counts, and
  generation metadata. A SHA-256 integrity code over the printed facts sits in the footer, so a
  printout can be checked against a fresh export.
- **Facts, not judgments.** The document states what was recorded, with timestamps and recorders;
  it computes no safety verdict, and every absence (no roll call yet, no cards on file, superseded
  or unsigned waiver) is stated explicitly rather than left blank. Assembly is pure
  (`src/lib/incident-export.ts` over the same manifest/readiness readers every safety surface
  uses); print-ready HTML, no PDF dependency. No insurer-facing marketing claim ships with this —
  that stays parked per the brainstorm's insurance-leverage entry until real operators validate it.

## Seat claim links for party bookings (delivered 2026-08-04)

The first slice of the group-organizer bet: every party seat beyond the organizer's own gets a
claimable bearer link, so the people the shop has never met stop being names the organizer typed.
`/claim/<token>` is a third `booking_capabilities` purpose (`claim`) — hashed-only storage, the
same expiry and live-cap rules as its siblings, redacted before telemetry. Only the organizer's
already-verified surfaces mint them (the confirmation panel and their `/ready` page), and only for
unclaimed, non-cancelled member seats on a not-yet-departed trip. Claiming resolves the claimant by
email with `findOrCreatePerson` semantics — a non-matching name stamps `identity_unconfirmed_at`,
so nobody inherits verified evidence by typing an email (H-13) — re-runs the gates a fresh booking
would face, supersedes any waiver signed by the placeholder, and revokes every outstanding
capability on the booking. Claiming never weakens a gate, and an unclaimed seat simply boards under
the organizer's party as before. Pay-your-own-share stays out of scope. See
[20260804-seat-claim-links](../architecture/decisions/20260804-seat-claim-links.md).

## The 2026-08-02 review's engineering queue (delivered 2026-08-03)

The Medium and Low engineering items the [2026-08-02 review](assessments/comprehensive-review-20260802.md)
still carried below its top findings. What it did *not* touch: MKT-F5 and MKT-F10, the two live
claims-policy violations at P0-1, which are owner decisions under HD-25 and not an agent's to close.

**Money.**

- **A booking's payment history is now local** (DATA-M3). `booking_payments` is one mutable row that
  refunds overwrite in place, so reconstructing how a booking got to its balance meant asking
  Stripe. The new append-only `booking_payment_events` records every transition — status, previous
  status, amount, currency, provider reference, and the operation that caused it — written inside
  `setBookingPayment`, the single funnel every writer reaches, under the same lock and in the same
  transaction. It records **transitions, not writes**: a replayed webhook re-running the self-healing
  checkout cascade appends nothing, and a refused write appends nothing, so a row always means the
  state genuinely changed. This is the built alternative to HD-14's "accept Stripe as sole ledger".
  See [20260803-booking-payment-events](../architecture/decisions/20260803-booking-payment-events.md).
- **Tips are in Reports** (PAY-M2), the last Stripe-vs-Reports divergence. Reported *beside* revenue,
  not inside it — a tip is its own Stripe charge, 100% to the shop, and never touches the booking
  payment gate, so folding it in would make "Revenue collected" stop meaning what its own detail
  line says.
- **`checkout.session.async_payment_failed` is handled** (PAY-L1); it previously left a permanent
  pending desync. `booking_payments` is deliberately untouched by it: an unsettled async payment
  wrote no row, and writing `unpaid` is the one thing that could regress a booking a human has since
  marked paid or waived.
  See [20260803-async-payment-failed](../architecture/decisions/20260803-async-payment-failed.md).
- **Append-only tables are pruned** (PAY-L2/DATA-M4). One `RETENTION_DAYS` table in
  `src/lib/retention.ts` is the only place a human edits, on a weekly cron with the same fail-closed
  auth as the reminders cron. The `stripe_webhook_events` window is **asserted, not commented**:
  those rows are load-bearing evidence now that `hasNewerAccountUpdate` reads their `occurred_at`,
  so `retentionWindowsOutlastStripeRetries()` fails a test if anyone shortens it toward Stripe's own
  retry horizon. The window *values* remain HD-11's to set.
  See [20260803-append-only-retention](../architecture/decisions/20260803-append-only-retention.md).
- **Money columns no longer default their currency** (DATA-L3). Dropped from `booking_payments`,
  `orders`, `booking_checkouts` and `tips`; `shops.currency` (the source-of-truth setting) and
  `shop_stripe_accounts.default_currency` (Stripe-reported, advisory) keep theirs. Exactly one
  production writer had been relying on the default.

**Safety.** A trip's certification and specialty requirement is now checked at **booking**, not only
at boarding (DOM-M6) — a diver could pay in full for a charter they could not qualify for. The gate
lives in `createBookingRecord`, so every door inherits it, and the lookup fails closed. It is
deliberately **weaker than readiness** and may never refuse someone readiness would clear — a
property test asserts that invariant across every requirement × evidence combination. A course
session is carved out: a site's inherent gate must not refuse a student from the course that grants
the very card. **This narrows DOM-M6 rather than closing it** — following the H-08 precedent, a
diver the shop has never carded is not refused, which is why the trip's requirement is now stated
above the public booking form and why H-27 through H-30 exist.
See [20260803-trip-admission-at-booking](../architecture/decisions/20260803-trip-admission-at-booking.md).

**Architecture.** The four files every feature touched are split (ARCH-3): `src/db/seed.ts`
4,650 → a 740-line orchestrator over 14 scenario modules, `src/db/trips.ts` 2,003 → a 94-line barrel
over six, `notifications/index.ts` 731 → a 77-line surface over five, and `SettingsPage.tsx`'s
inline `"use server"` closures extracted to a sibling `actions.ts`. Every public export is
byte-identical and no importer changed; the seeded database was proven identical by fingerprinting
every row, after first validating the method on unchanged code.
See [20260803-seed-scenario-modules](../architecture/decisions/20260803-seed-scenario-modules.md).
The `tx as unknown as AppDb` casts are gone (ARCH-5) — `DbExecutor` everywhere it belongs.
Auth-path hygiene (ARCH-8): the missing-account short-circuit no longer skips the bcrypt compare
(an enumeration oracle), the demo bypass moved behind a reserved `*.demo.invalid` namespace so
database write access to `is_demo` alone grants nothing, and bcrypt cost 10 became one documented
constant — deliberately not applied at the verify site, where `compare()` reads the cost out of the
stored hash. See [20260803-demo-bypass-containment](../architecture/decisions/20260803-demo-bypass-containment.md).

**Copy and languages.** Bearer-token error boundaries speak the reader's language (I18N-3). The old
exemption comments assumed a provider meant shipping the diver bundle on every visit; that stopped
being true when `DiverIntlProvider` grew a required `namespaces` list, so each route's `layout.tsx`
now mounts four strings above the boundary. Seven token routes, not the six the review counted, plus
the public shop namespace. `src/i18n/provider-coverage.test.ts` makes the `DiverIntlProvider`
footgun executable instead of tribal. es-ES swept for terminology and register (I18N-5): 256 strings,
`tienda` → `centro` with agreement fixed and the retail sense split off, recorded in
`src/i18n/locales/es-ES/README.md` so the next translator is consistent.
See [20260803-error-boundary-copy-bridge](../architecture/decisions/20260803-error-boundary-copy-bridge.md).

**Marketing.** `/product`'s mid-page CTA can finally be measured (MKT-F3 — it existed, but tagged
itself identically to the hero and closing). `/switching/spreadsheet` gained its OG block and every
marketing route sets Twitter cards (MKT-F6) — and verifying that policy surfaced a live defect:
Next merges `metadata` shallowly, so every marketing page except `/` had been unfurling with **no
`og:image`**. `/about`'s hero stopped being pasteable onto any dive vendor's site (MKT-F7).
`/pricing` anchors against the per-booking fees the switching guides document, using only figures
already in the repo and no savings arithmetic (MKT-F9). MKT-F4 and MKT-F8 were already delivered
before this slice; the review measures `be15104`, not HEAD.

**Domain wording.** H-11, V-05 and the nitrox provisional defaults now say plainly that DiveDay
gates the fill *request* and holds no fill log of any kind (DOM-M4). HD-8 is left standing and named
as unanswered in all three places.

## Booking-and-diver UX pass: multi-day departures, one door per destination (2026-08-03)

A batch of fixes from a walk through the staff app, plus the two features the walk turned up as
genuinely missing.

**Multi-day departures can finally be built.** `trip_schedule_days` could always describe a
departure that meets on consecutive days — the trip page printed the list, the board badged the
count, `moveTrip` slid them together, crew double-booking was checked day by day — but no write
path ever populated it, so an Open Water weekend went on the board as unrelated trips sharing a
title: separate rosters, separate waivers, separate crew. "Schedule a trip" and the trip's own
details editor now take a day count (1–14, `src/lib/trip-days.ts`); the day-one window repeats on
consecutive days, each converted through the shop's own zone on its own date so a departure that
straddles a DST change keeps the wall-clock time the shop promised. `updateTrip` rebuilds the day
rows when the schedule moves, and a weekly series gives every occurrence its own days.

**A shop's timezone is no longer a one-shot question.** Sign-up's picker opened on US Eastern for
everyone and nothing could change it afterwards, so a shop that clicked past it read every day
header, departure time, and "sailing today" in someone else's zone. The picker now preselects the
device's own zone, and Settings → *Timezone* is the way to change it later.

**"View booking page" works.** The public trip page redirected a signed-in staffer to the
management view, so the trip overview's own button could never show the booking page — it opened
and bounced straight back. The page stays put now and carries a staff preview banner with a
"Manage this trip" link, which also serves the staffer who followed a shared `/s/` link. Removing
the redirect also retired an eight-attempt retry loop in `e2e/boat-loop.spec.ts`.

**One destination, one door.** Team and Promo codes sat in both the header's "Set up" menu and on
the Settings page; Orders sat in both the header and Settings. Each now lives in exactly one place
— Team and Promo codes on Settings, Orders in the header, all three still in ⌘K — and Settings is
the last row of the menu (`src/lib/staff-destinations.ts`).

**And the smaller ones.** The Today board's drag-to-assign strip is desktop-only and the crew
copy stopped instructing a phone to drag; the schedule board's rows became two aligned columns and
its Remove confirmation moved into a panel like Move and Copy instead of inflating a card inside a
button row; the per-dive picker says "Dive site" like every other surface rather than "Dive
briefing"; the diver record's Edit control is a real button that opens itself right after you
create a diver; "Number of trips" under *Repeat* is blank and disabled until a cadence is chosen;
and optional fields that were silently optional now say so.

## A shop's water-temperature unit is its own setting (2026-08-03)

`shops.temperature_unit` (`celsius` | `fahrenheit`, default Celsius) replaces the derivation that
read the unit off `depth_unit`. Feet no longer implies Fahrenheit: a Caribbean operator serving
American divers publishes depths in feet and water temperature in Celsius, and the derivation had
no way to say so. The migration backfilled Fahrenheit for every shop already on feet, so nothing
anyone was reading changed. Staff pick it in Settings → *Units*, beside the depth unit and the
shop's currency; the crew's conditions form now takes the reading **in the shop's unit** (the unit is part of
the field label) and converts to the canonical Celsius that gets stored, and the night-before brief
finally writes both water temperature and visibility in the shop's own units instead of always
"27°C" and "20 m". `trips.water_temperature_c` and `visibility_meters` widened to floating point so
a whole-degree Fahrenheit entry round-trips exactly, the same reason `dive_sites.max_depth_meters`
was floating point from the start. See the
[amendment to 20260730-site-depth-and-diver-age-surfaces](../architecture/decisions/20260730-site-depth-and-diver-age-surfaces.md#amendment-2026-08-03--the-temperature-unit-is-a-sibling-setting-not-a-reading-of-this-one).
## The 2026-08-02 review: payments, data, and crew residuals delivered (2026-08-03)

The six findings the [2026-08-02 review](assessments/comprehensive-review-20260802.md) still carried
in its top ten after the first delivery below — **PAY-M1, PAY-M3, DATA-M1/M2, the two DATA-H1
engineering residuals, DOM-M3 and the DOM-H1 residue**. With these the review has **no open code
finding left**: everything that survives in it is a human decision, a human action, or a claim only
the owner can retract. The assessment was pruned again the same day.

**Money.**

- **A Stripe webhook claim can no longer outlive a failed handler** (PAY-M1, the review's last P0).
  The claim and the *evidence* now sit on two columns of `stripe_webhook_events`: `occurred_at` is
  Stripe's own event-creation time and is never deleted, and a new nullable `claimed_at` is the
  dedup claim, released when a handler throws so Stripe's own retry genuinely re-reaches it (the
  route then answers non-2xx, so Stripe does retry). Every reachable handler was re-read for
  re-runnability first. The two-column shape exists because the **first** fix released the claim by
  *deleting* the row — which also destroyed the only chronological record `hasNewerAccountUpdate`
  reads, reopening the out-of-order `account.updated` fail-open that regresses `charges_enabled`;
  the `security-reviewer` pass caught it, and the ADR now says so. `account.application.deauthorized`
  additionally orders itself against the shop's own `connected_at`, so a redelivery landing after
  the owner reconnected cannot re-disconnect a live account (`src/app/api/webhooks/stripe/route.ts`,
  `src/db/webhook-events.ts`, `src/db/stripe-accounts.ts`).
- **The applied discount is snapshotted, so an unsettled party splits correctly** (PAY-M3), for
  **every** discount class rather than only shop-wide codes. `booking_checkouts` records
  `applied_discount_percent` and its source (`promo_code_id` *or* `trip_promo_id`, at most one) at
  session-creation time, written only when a code was genuinely handed to Stripe and never
  re-derived afterwards from whatever promo is live on the trip. A trip-scoped last-minute deal is
  therefore reconstructible without asking Stripe anything, which is what the review's "party on a
  discounted session with no `amount_total`" case needed. Rows written before the column keep their
  prior conservative behaviour — a shop-wide code still reconstructs from `promo_code_id`, anything
  else falls back to the asked total — so no completion is refused or recorded as zero for want of
  the figure (`src/db/checkouts.ts`, `src/lib/payments/settlement.ts`).

**Data and privacy.**

- **Erasure reaches the processor** (DATA-H1 residue 1). `anonymizeDiver` now deletes the diver's
  Stripe **customer** through a provider seam after its own transaction commits — never as a
  condition of it, so a Stripe outage cannot roll back an erasure a diver asked for — and records
  what no API can reach in a new `processor_erasure_obligations` ledger: one row per customer
  (retryable, with `attempts`/`last_error` so a failure is visible rather than retried into
  silence) and one per finalized invoice, because Stripe snapshots the name and email onto an
  invoice **at finalization** and deleting the customer afterwards does not rewrite that copy. The
  design's first premise — "deleting a Stripe customer destroys the shop's tax and chargeback
  record" — was checked against Stripe's documented behaviour and is **wrong**; charges, invoices,
  refunds and disputes are separate objects and survive. That is recorded in the ADR so nobody
  re-derives it from intuition.
  [20260803-processor-erasure-obligations](../architecture/decisions/20260803-processor-erasure-obligations.md).
- **A lead is reachable after the diver changes their email** (DATA-H1 residue 2).
  `course_inquiries` gained a nullable `person_id`, resolved **at capture time by exact email
  match** against a live diver of that shop (`people_shop_email_unique` makes that at most one
  row) — never from a phone number, which households share, and never back-filled by a matching
  job, because a link inferred after the fact would erase a bystander's lead. The erasure sweep
  matches on the link first, then still on email and phone.
- **The two hot cross-shop scans have indexes** (DATA-M1/M2), with shapes derived from the queries
  rather than from the review's prescription: both scans pin a leading equality column and then take
  a range, which is the only order a single index scan can walk. `claimBookingsForCheckout`'s
  stale-intent sweep gets a partial `payment_operation_intents(kind, started_at) WHERE
  status = 'started'`; the daily cron's two window scans get `trips(status, starts_at)` and
  `trips(status, ends_at)`. The review had prescribed bare `(started_at)` and bare
  `starts_at`/`ends_at`, which would have read every row in the window across every shop.

**Safety.**

- **`trip_assignments` carries the job, and "in-water certified assistant" is defined once**
  (DOM-M3). A nullable `trip_role` on a new `trip_assignment_role` enum
  (`instructor | divemaster | captain | crew` — a deliberate subset of `person_role`), so a
  divemaster rostered as *this trip's captain* no longer raises the supervision ratio by two
  students per head and a shop-wide instructor rostered as deck crew no longer clears
  `course_unstaffed` on their own. The rule had been written out five times in three idioms and
  named nowhere in `src/lib`; it is now `src/lib/crew-roles.ts` and read from one place. A roster
  can only ever **downgrade** — rostering an unqualified deckhand as "instructor" buys the session
  nothing — asserted as a monotonicity test over every (shop roles × trip role) pair. The role is
  settable in the UI by a job picker on the trip's crew section, and both write paths preserve it.
  [20260803-per-trip-crew-role](../architecture/decisions/20260803-per-trip-crew-role.md).
- **Crew roll call names people** (DOM-H1 residue). A new `roll_call_crew_events` table gives every
  rostered crew member their own append-only roll-call subject beside the count, with
  `roll_call_events.booking_id` left `notNull` rather than widened. `rollCallCompleteness` stays the
  single definition of "this checkpoint is closed" and now requires a named result per rostered crew
  member *and* the count. Two new Today reasons — `missing_crew` and `crew_uncounted` — put an
  unclosed after-dive crew gap on the same footing as a diver's, where before the loudest signal the
  manifest has went nowhere at all. The offline copy shows crew by name and state and **absence
  reads as awaiting**, so an old snapshot keeps the checkpoint open rather than reading "done".
  Carried in the CSV export.
  [20260803-per-person-crew-roll-call](../architecture/decisions/20260803-per-person-crew-roll-call.md),
  which extends
  [20260802-crew-roll-call-attestation](../architecture/decisions/20260802-crew-roll-call-attestation.md)
  — that ADR named this work as its own follow-on and is **not superseded**: the attestation stays
  as the count-level record, and its
  [2026-08-03 amendment](../architecture/decisions/20260802-crew-roll-call-attestation.md#amendment-2026-08-03--the-follow-on-landed-this-adr-is-not-superseded)
  records which of its statements the follow-on narrows and which are unchanged.

**What did NOT ship, deliberately.** Each is stated in the ADR that created it, not left to be
rediscovered:

- **Crew roll call is not recordable offline.** It needs a subject kind on `OfflineRollCallEvent`
  and on the offline idempotency key, plus store, sync-route and reconciliation work. The offline
  crew panel now says so in a **third, neutral tone** — "not recordable here" is a limitation, "a
  named crew member is not back aboard" is the alarm — because rendering both in warning-yellow on
  every out-of-signal dive teaches crews to stop reading the panel. Fail-closed is unchanged.
- **Today's departure board still assigns crew without a job.** It is a drag-and-drop scheduling
  surface; the job someone is doing is set on the trip page, where the ratio that reads it lives.
- **Unassign-then-reassign does not preserve a per-trip role**, and cannot — the row and the role go
  together. That is how staff fix a mis-tap, so it carries a regression test rather than a sentence.
- **The seed lacks one case:** an instructor rostered as a session's **divemaster**. The demo shop
  has exactly one instructor, so seeding it would leave that session with nobody on the ratio and
  move seeded bookings, staffing and Today across the whole demo. A second seeded instructor is the
  obvious follow-on and is carried in
  [features/roadmap.md](features/roadmap.md#p1--next). The rule is asserted directly by the
  monotonicity test meanwhile.
- **The count-level crew attestation deliberately raises no Today row.** Most shops have never
  filled it in, so it would fire on nearly every trip and bury the rows that mean a person is in the
  water. Only the per-person gaps escalate.
- **Erasure cannot reach the PII Stripe snapshots onto an invoice at finalization.** There is no API
  behind it; that obligation is **never auto-retried** and closes only when an owner attests they
  filed Stripe's data-deletion request. An erasure with an undischarged obligation is genuinely
  incomplete, and any promise made to a diver has to say so.
- **The erasure ADR is still `Proposed`,** and no human gate moved. HD-10/HD-11 (counsel on erasure
  vs signed evidence, and retention windows) and HD-7 (whether the launch jurisdiction requires
  per-person crew coverage) are open exactly as they were; `pnpm gates` reports the same 16 open
  rows on 2026-08-03 as on 2026-08-02.

## The 2026-08-02 comprehensive review: fourteen top findings delivered (2026-08-02)

All fourteen rows of "the findings that matter most" in the
[2026-08-02 ten-lens review](assessments/comprehensive-review-20260802.md) — three Criticals and
eleven Highs — plus two further queue items and a set of defects the required reviews found in the
new work. The assessment has been pruned to what remains open; what is still open is **not** listed
here. Owner decisions taken before the work started: refunds return what was actually paid with gear
included (HD-12/HD-13), erasure is anonymize-and-keep (HD-11 direction, ADR still Proposed), contrast
is focus-ring only (HD-17 unchanged), and visual diffs warn loudly rather than block (HD-18).

**Safety.**

- **Cert, specialty and nitrox gates read every site a trip visits** (DOM-C1), not just
  `trips.dive_site_id`. `getTripSiteRequirement` and the batch path in `listTripsReadiness` compose
  the stricter `minimum_certification_level`, the union of required specialties, and `requires_nitrox`
  across the primary site **and** every `trip_dives.dive_site_id`, mirroring the depth advisory's join
  — an Open Water diver on a shallow primary with an AOW/Deep second dive is now blocked
  (`src/db/readiness.ts`).
- **Intro sessions cap at 2 students per instructor with no assistant bonus** (DOM-H2), the PADI
  Instructor Manual's open-water Discover Scuba figure obtained under HD-6, replacing the Open Water
  training ratio (8, +2 per assistant, ceiling 12) that had been applied to DSD for lack of a real
  number. DiveDay's trip model has no confined-water session type, so the Manual's 4:1 confined figure
  is recorded and deliberately unenforced. The cap is **agency-agnostic** — zero prior water time does
  not depend on whose logo is on the course — while the cited 8/+2/12 entry-level figure stays
  PADI-scoped; `courses.agency` comparisons are normalized, closing the case where a shop typing
  `"PADI"` silently lost the cap entirely (DATA-L2). `restoreBooking` re-checks the ratio, and a crew
  change that leaves a session over ratio is now **recorded rather than refused**, so a manifest never
  lists crew who are not aboard.
  [20260802-dsd-instructor-manual-ratio](../architecture/decisions/20260802-dsd-instructor-manual-ratio.md)
  and the [2026-08-02 amendment](../architecture/decisions/20260724-course-admission-standards.md) to
  the course-admission standards.
- **Crew enter the head count** (DOM-H1, interim slice): a per-checkpoint "crew aboard: N of N"
  attestation that a checkpoint cannot read complete without, surfaced in the live *and* offline
  manifests and carried in the export. "0 of 0" deliberately still needs a human — auto-completing
  would hand a silent all-clear to exactly the trips whose crew data is worst.
  [20260802-crew-roll-call-attestation](../architecture/decisions/20260802-crew-roll-call-attestation.md).
  Per-person crew roll call and the per-trip role landed the next day — see the 2026-08-03 section
  above; this table stays as the count-level record.
- **A returned boat with an unfinished head count escalates** (DOM-H3): top-severity Today item plus a
  schedule-board badge for any trip past its end with awaiting divers or no after-dive events. The
  review of this work found the alarm was silenced by the input that should trigger it — `not_boarded`
  means "never left the dock" at departure and "**did not come back to the boat**" after a dive, and
  both were being treated as accounted-for and carried forward, rendering as "Not boarded ✓". Fixed
  before merge, along with a returned-trips query that kept the twenty *oldest* trips before testing
  whether any count was open, so the busiest shop lost the most recent boat.

**Money.**

- **Refund idempotency is keyed on the payment-operation intent** (PAY-C1), not
  `refund:{intent}:{amount}` — two party members cancelling for the same amount against one payment
  intent no longer collide into a single replayed Stripe refund with two local rows claiming money
  came back (`src/db/refunds.ts`, `src/lib/payments/checkout.ts`).
- **A settled-amount ledger** (PAY-H1/H2): `booking_checkouts` records the session's actual
  `amount_total` at completion, per-booking paid amounts are derived from it post-discount with gear
  included, and refunds and the monthly report are based on that instead of the quoted list price
  (`src/lib/payments/settlement.ts`, `src/db/checkouts.ts`, `src/db/reporting.ts`). A shop no longer
  loses money on every within-window promo cancellation, and gear money is no longer invisible.

**Data and privacy.**

- **A diver can be erased** (DATA-H1): a one-way, owner-gated anonymization that strips identity and
  medical fields across the schema while preserving a verifiable signed-release skeleton. The hard
  part was that `waiverIntegrityMetadata` HMACs a field set including `signedName` and
  `medicalAnswers`, so stripping medical answers would have flipped every erased record to `invalid`
  — "strip medical" and "preserve verifiable evidence" were mutually exclusive as the code stood.
  Resolved with a **waiver integrity v2** seal over the surviving fields, dispatched per record
  (`src/db/anonymize.ts`, `src/lib/waiver-integrity.ts`), with the erased-diver markers carried into
  the CSV export so a destination system can tell an erased record from an incomplete one.
  [20260802-diver-data-erasure](../architecture/decisions/20260802-diver-data-erasure.md) — **Status:
  Proposed on purpose**: HD-10/HD-11 (counsel on erasure vs signed evidence, and retention windows)
  decide when the mechanism may point at a real diver. The ADR is honest that erasure is one-way and
  evidence-reducing, and records what it cannot reach: `orders.stripe_customer_id` is a `NOT NULL`
  pointer erasure cannot rewrite, so processor-side deletion was a separate manual step — closed
  the next day by the obligation ledger in the 2026-08-03 section above. The ADR stays **Proposed**
  regardless: that is the human gate, not the mechanism.

**Operations.**

- **A backup and restore posture** (OPS-1) where there was none: Neon PITR plus a scheduled per-shop
  logical export to a versioned private S3 bucket provisioned in `infra/`, its two known gaps written
  down, and a quarterly restore test on the calendar.
  [20260802-backup-and-restore-posture](../architecture/decisions/20260802-backup-and-restore-posture.md),
  [backup-and-restore-runbook.md](../engineering/backup-and-restore-runbook.md).
- **The daily cron is no longer silent** (OPS-3): per-scan try/catch with `Sentry.captureException` so
  one failure cannot starve later scans, an exported `maxDuration`, structured per-scan logging, and a
  real Sentry Cron Monitor check-in from the route itself — `webpack.automaticVercelMonitors` was inert
  under Turbopack, so the configured monitor had never worked.
- **`/api/health`** (OPS-6 half): an unauthenticated liveness probe (DB `select 1` + commit SHA), plus
  [deploy-and-migrations-runbook.md](../engineering/deploy-and-migrations-runbook.md) (expand/contract
  rule, forward-only rollback, concurrent-deploy posture) and
  [incident-response-runbook.md](../engineering/incident-response-runbook.md) (severity ladder, first
  five minutes, Vercel instant rollback, Neon restore, comms template) — OPS-2 and OPS-4's
  documentation halves.
- **`/calendar/[token]` joined `CAPABILITY_ROUTE_PREFIXES`** (OPS-5) — the one bearer route the
  redaction map had forgotten, so a route error no longer sends a raw feed token to Sentry
  (`src/app/observability.ts`).

**Conversion, tooling, and the launch stall.**

- **The onboard timezone field no longer hard-blocks a dive shop** (MKT-F2): the full IANA list from
  `Intl.supportedValuesOf("timeZone")` with curated dive-region optgroups on top, so Bonaire, Cayman,
  Belize, Roatán, Indonesia, the Maldives and Fiji can complete signup (`src/lib/timezones.ts`).
- **Switching guides carry an above-the-fold CTA** (MKT-F1) plus a repeat after the scope table, for
  signed-out buyers too — previously the highest-intent landers had no actionable CTA until ~7
  sections deep and the mid-page CTA rendered `null`.
- **Visual diffs are summarized on the PR** (TEST-1): `visual-report` parses reg-suit's `out.json` into
  a markdown report and a per-PR comment behind a **neutral** check. The owner's decision was warn
  loudly, never block —
  [20260802-visual-diff-pr-comment](../architecture/decisions/20260802-visual-diff-pr-comment.md),
  closing HD-18.
- **`pnpm gates`** (PROD-C1's tooling only): a report — never a gate, never in `check` — of days since
  each `human-decisions.md` H-/V- row last moved, reconciled against `rollout.md`'s "next 30 days"
  list, with ages derived from dated outcomes and `git blame` and printed as `≥ N` when a shallow
  clone can only bound them (`scripts/gate-freshness.mjs`). With it, the
  [pilot-kit/](pilot-kit/README.md): design-partner one-pager, Florida call-list template, first-call
  script, and a printable V-02 run sheet that includes the spray-guard false-trigger measurement
  (DOM-L3). The call list ships with **no rows** on purpose — ten plausible shop names would get
  dialled and counted as pipeline. **This measured the launch stall; it did not move it**, and the
  finding itself stays open in the assessment.

**Defects the reviews found in the new work, all fixed before merge.** Beyond the roll-call and
returned-trips defects above, `dive-domain-expert` and `security-reviewer` found: the 4:1 intro cap
applying only to PADI when the reason for it is agency-independent; an over-ratio warning citing a
standard that didn't apply and prescribing "assign an assistant", which the new rule ignores; erasure
that the cron would have undone, because `booking_checkouts.customer_email` wasn't scrubbed and
erasure doesn't cancel bookings, so the next daily tick would have emailed the address the shop had
just said was destroyed; an activity-log scrub written as `ILIKE '%fullName%'`, so erasing a diver
named "Al" would have irreversibly redacted most of the shop's history; `restoreBooking` bypassing the
ratio cap; and a system that refused to record reality on a safety document, since an instructor
calling in sick couldn't be unassigned if it put the session over ratio. Two more were found outside
the findings' scope: the offline shell precached only assets named in the shell HTML, so hydration
could hand a captain the error boundary instead of the roll call; and the new attestation table
blocked `delete from trips`, which would have broken demo-shop reaping from the daily cron while e2e
still reported green.

**The offline shell stops claiming an empty phone before it has looked.** `envelope` and `list` both
start `null` meaning "not looked yet", and every branch read that as "nothing there" — a definitive
claim about a safety artifact, printed above a status line saying the store was still opening. Worse,
`manifest-sw.js` caches one document under `/offline-manifest` and replayed it for every offline
reload whatever `?trip=`/`?checkpoint=` the captain was on, so the reloaded page painted a different
page than the one requested and only became correct through React's hydration-mismatch error
recovery — a recoverable hydration error on **every** offline reload. A `storeRead` flag gates both,
so the server always emits one neutral view, the client hydrates against a match, and the real branch
is chosen by an ordinary render. This was reached by investigating a flaky storage-eviction e2e test;
the product bug is real and removed, but the flake was **never reproduced**, so it is not proven
fixed — tracked as TEST-3 in the assessment.

## The keyboard focus ring passes WCAG 1.4.11 in every palette (2026-08-02)

The first of the three deferred accessibility contrast tasks. `src/app/globals.css` gained a
semantic `--focus-ring` token — full-strength `var(--primary)`, derived the same lazy way as
`--primary-sunken` so each skin's ring follows its own action color — replacing the
`color-mix(… 55%, transparent)` blend in the app-wide `:focus-visible` rule. Worst-case contrast
against the surfaces the ring sits on went from 2.21:1 → 4.66:1 (light), 2.57:1 → 6.69:1
(`boat-mode` light) and 2.59:1 → 6.87:1 (`glare-mode` light), all three previously **below** the
3:1 minimum; the dark palettes were already passing and only improved (3.69:1 → 9.05:1 and up). The
audit had flagged only the light palette — boat and glare light were failing too.

The other two contrast tasks (tinted status-banner text, placeholder text) are **still deferred**
pending the color-guide decision, so the axe scan's `color-contrast` exclusion stays in place and
**the app still may not be described as WCAG AA conformant**. See
[features/roadmap.md](features/roadmap.md#accessibility-contrast-fixes-blocked-on-a-color-guide-decision)
and [../design/principles.md](../design/principles.md#tokens-the-mechanics).

## UX persona review — fifteen personas delivered (2026-07-30 → 07-31)

The 165-task persona walkthrough closed out; the vast majority shipped across PRs #268–#280. The
task-by-task rationale is archived in
[archive/ux-personas-20260730-findings.md](archive/ux-personas-20260730-findings.md), the standing
evaluation frame is [personas.md](personas.md), and what's still open is in
[features/story-backlog.md](features/story-backlog.md). The headline slices:

- **The shop declares its own currency** — `shops.currency` (ISO 4217, chosen in settings) is the
  single source of truth for every checkout, order, invoice, tip, and displayed amount; Stripe's
  reported `default_currency` is kept but advisory, and the settings page warns when the two
  disagree. Zero-decimal currencies like JPY are handled at display time
  ([shop-currency](../architecture/decisions/20260731-shop-currency.md)).
- **Notifications go out in the language the diver reads** — outbound email and SMS localize
  ([notification-locale](../architecture/decisions/20260731-notification-locale.md)), and
  `people.locale` records a diver's own language when *they* made the request (a public booking as
  lead booker, or any action on their own waiver/ready/recap link), outranking the shop default. A
  staff-triggered send never writes it
  ([per-person-notification-locale](../architecture/decisions/20260731-per-person-notification-locale.md)).
- **Numeric site depth and diver age reach the surfaces that need them** — `dive_sites.max_depth_meters`
  sits alongside the free-text range so a site's depth can be compared to a certification ceiling,
  and it renders as an advisory *beside* readiness, never a blocker inside it; the crew's list shows
  a diver's age where it matters
  ([site-depth-and-diver-age-surfaces](../architecture/decisions/20260730-site-depth-and-diver-age-surfaces.md)).
- **Self-serve email unsubscribe**, a staff operations board split out from the always-public
  schedule, copy-density and jargon cuts across the diver surfaces, and the accessibility fixes the
  specialist audit later credited: a skip link in both layouts, `<html lang>` from the negotiated
  locale, and a real focus trap on the portal dialogs.

## Specialist optimization audit — security & privacy delivered (2026-08-01)

Continuing the [specialist optimization audit](archive/specialist-optimization-audit-20260731.md)
(now archived — every lens shipped or moved out): six of the seven security/privacy (§5) findings
shipped, each with a `security-reviewer` pass per the repo's hard rules.

- **Blob object keys use a CSPRNG.** `vercelBlobStorageProvider.upload` (`src/lib/storage/index.ts`)
  now suffixes every object path with `randomBytes(16).toString("base64url")` (128 bits) instead of
  `Math.random()` (~41 bits, non-cryptographic) — these blobs, including certification-card photos,
  live on a public unauthenticated host where URL unguessability is the only access control.
- **Stripe webhook events are checked against the secret that verified them.** A live-secret-verified
  event must carry `livemode: true` and a test-secret-verified event `livemode: false`
  (`src/lib/payments/webhook.ts`, `src/app/api/webhooks/stripe/route.ts`); a mismatch is refused
  with 200-and-ignore (a non-2xx would make Stripe retry forever) rather than mutating live payment
  state. Closes the gap where a correctly-signed test-mode event could reach the handlers that flip
  live orders to paid, if both secrets were ever configured together.
- **Baseline security headers ship beyond frame protection** — `next.config.ts`'s `headers()`
  (`src/lib/security-headers.ts`) adds HSTS, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin` (tightened to `no-referrer` on every
  bearer-token route — waivers, ready, recap, verify, reset-password, invite, unsubscribe,
  calendar), and a `Permissions-Policy` disabling camera/microphone/geolocation. Covers `/api` and
  static assets, which `src/proxy.ts`'s frame-header matcher deliberately excludes; the two layers
  set disjoint header keys and don't interact.
- **Recap tokens get their own signing key and a lifetime.** `src/lib/recap-links.ts` derives its
  HMAC key via HKDF from `AUTH_SECRET` (or a dedicated `RECAP_LINK_SECRET`) instead of signing
  directly with the session-JWT secret, and folds an issued-at timestamp into the payload, rejected
  past a 180-day window. A recap link no longer works forever once leaked, and `AUTH_SECRET` can
  rotate without silently killing every outstanding recap link.
- **Sign-in and every other rate limit can now be enforced globally, not just per server instance.**
  `src/lib/rate-limit.ts` gained `upstashRateLimitStore` — Upstash Redis over its REST API (no SDK
  dependency, matching the Stripe/Blob precedent), with the whole token-bucket read/refill/decide/write
  cycle run atomically via one `EVAL`'d Lua script per check. `checkRateLimit` is now `async`;
  `rateLimitStoreFromEnvironment()` falls back to the original in-memory store when
  `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` aren't both set, so dev/e2e/CI stay zero-setup.
  See [20260801-distributed-rate-limit-store](../architecture/decisions/20260801-distributed-rate-limit-store.md).
- **The `/api/test/*` seed endpoints require a bearer secret, not just env-var configuration.**
  `e2eTestRouteAuthorized` (`src/lib/e2e-test-routes.ts`) fails closed on a missing/wrong
  `DIVEDAY_E2E_SECRET`, exactly like `CRON_SECRET` on the reminders cron route — a misconfigured
  staging deployment (production build, `DIVEDAY_E2E=1` left set, PGlite fallback) can no longer
  reach a route that mints password-reset tokens or wipes data on the env-var predicate alone.
  Wired into the Playwright harness (`playwright.config.ts`, `e2e/global-setup.ts`).

**"Close the revocation window on base staff surfaces" was not built** — it re-proposed exactly what
[H-15](human-decisions.md#decision-register) already decided against on 2026-07-24; see
[20260724-staff-session-and-capability-migration-policy](../architecture/decisions/20260724-staff-session-and-capability-migration-policy.md).
**"Reduce what a stolen device can read from offline manifests" remains open by deliberate human
decision**, kept in full in the archived audit's §5 for whoever eventually revisits it.

## Specialist optimization audit — accessibility non-contrast items and CI dedup (2026-08-01)

Continuing the [specialist optimization audit](archive/specialist-optimization-audit-20260731.md):
developer/agent experience (§8) is now fully delivered, and three of the six remaining accessibility
(§3) tasks landed. The three contrast-specific accessibility tasks are deliberately deferred (see
below) and moved to
[features/roadmap.md](features/roadmap.md#accessibility-contrast-fixes-blocked-on-a-color-guide-decision),
not forgotten.

- **CI job setup is now one composite action, not eight copies** — `.github/actions/setup/action.yml`
  holds the shared pnpm/node/install steps and `.github/actions/playwright-shell/action.yml` holds
  the Chromium headless-shell cache+install, both reused across all seven `ci.yml` jobs. Pure
  refactor: every job's effective step sequence, `timeout-minutes`, shard matrix, and artifact step
  is unchanged; only the duplicated setup shrank.
- **Waiver-signing errors point at the field that's actually wrong** — `signerName` and
  `acknowledged` on `/waivers/[token]` now carry `required`/`minLength`, so the browser blocks and
  focuses an incomplete submit before it ever reaches the server; the fallback error banner (reached
  only when that's bypassed) names and links to the specific missing field instead of one generic
  "check every question" message. The "Save for later" button keeps accepting partial drafts via
  `formNoValidate`.
- **The schedule builder's Add/Move/Copy panels manage keyboard focus** — opening a panel focuses its
  first field, Cancel returns focus to the toggle that opened it, and the three hand-rolled Cancel
  buttons now go through `buttonClass` like every other button-shaped control. The panel-completion
  announcement this item also called for turned out to already exist (the board's `ShopNotice
  role="status"` banner), so nothing new was needed there.
- **Automated accessibility scans run in CI** — `@axe-core/playwright` (test-only devDependency, ADR
  [20260801-axe-core-playwright-a11y-scans](../architecture/decisions/20260801-axe-core-playwright-a11y-scans.md))
  scans five high-stakes surfaces — the public schedule, trip booking + confirmation, the waiver page,
  the staff manifest, and the offline manifest viewer — against WCAG 2.0 A/AA and 2.2 AA on every
  Playwright run, catching regressions like a missing label or broken landmark automatically. The
  `color-contrast` rule is excluded on purpose: it fires on every surface over the same token values
  the three still-open contrast tasks track, and the product owner ruled out touching contrast in
  this pass (it would fight the current color guide) — re-include the rule once that work lands.

## Specialist optimization audit — five lenses delivered (2026-07-31 → 08-01)

Five of the eight lenses of the [specialist optimization
audit](archive/specialist-optimization-audit-20260731.md) shipped in full. At the time, accessibility
and security/privacy were still open and ML & data had just moved to
[features/ai-ml.md](features/ai-ml.md#scoped-prompt-ready--from-the-2026-07-31-specialist-audit); both
of the others have since shipped or moved too (see the entries above) and the audit is now fully
archived.

- **UX & interaction design (§1)** — every button and button-shaped link gets a press dip on touch
  (one `active:scale-[0.98]` in `buttonClass`, so no call site changed); the `/ready` checklist now
  leads with a wave-fill readiness bar carrying a "N of M done" label; public schedule cards say
  "only N spots left" in words when a departure is nearly full; the schedule builder's add/move/copy
  panels animate open; the undo toast pauses on hover/focus and fades out instead of vanishing; the
  Today board lights its crew drop zone during a drag; the waiver's medical questionnaire has a
  sticky progress cue; and the shared `EmptyState` carries a quiet dive-themed mark.
- **Frontend performance (§2)** — uploads are bounded to ~2048px in the sharp pipeline before the
  JPEG encode; every photo surface moved to `next/image` with `remotePatterns` for the Blob host, so
  phones stop downloading full-resolution originals and photo grids stop shifting; the diver message
  bundle ships per-namespace instead of all 80 KB; the Sentry client SDK was trimmed and the
  first-load budget ratcheted down; the public schedule streams its calendar and reviews behind
  Suspense and the last staff routes got `loading.tsx`; independent session/shop/locale lookups run
  in one `Promise.all`; command-palette search moved from a serialized Server Action to a
  cancellable GET route; and `AddPanel` was hoisted out of the render body.
- **SEO & growth (§4)** — the sitemap publishes every public shop schedule and active course page
  (per-visitor demo shops excluded); course sessions on the schedule link to their course page;
  `robots.txt` disallows every bearer-token prefix; per-shop and per-trip OpenGraph images render
  the shop/trip a diver is actually sharing; published reviews emit `schema.org/Review`; the embed
  snippet carries a "Powered by DiveDay" backlink with UTM params; shops carry a physical address so
  Event rich results become eligible; and `e2e/seo.spec.ts` locks the whole surface in.
- **Backend & data architecture (§7)** — order status transitions are now a guarded table with a
  `FOR UPDATE` re-read, so a replayed or out-of-order Stripe `invoice.*` event can't flip a refunded
  order back to paid; a `stripe_webhook_events` ledger dedupes deliveries and cross-checks the
  connected account; `src/lib/log.ts` puts structured JSON lines on the money and cron paths that
  previously logged nothing; `moveTrip`/`duplicateTrip` preserve shop-local wall-clock time across a
  DST boundary instead of shifting by an absolute delta; `applyProviderEmailEvent` became one
  conditional update so a late `delivered` can't beat an earlier `bounced`; staff `cancelBooking`
  revokes capabilities inside the same transaction; per-person indexes landed on `bookings` and
  `orders`; and production cold starts skip the seed/backfill scan behind a cheap marker check with
  an explicitly configured `pg` Pool.
- **Developer & agent experience (§8)** — four new `task:context` areas (payments, notifications,
  reviews, data portability) and refreshed goals on the milestone-era ones; `pnpm e2e:run` reuses an
  existing build with a staleness guard, and `pnpm test:changed` runs only the tests a diff affects;
  `src/features` is inside the copy safeguards; `pnpm check:repo` runs its ten checks in parallel and
  reports *all* failures rather than stopping at the first; `check:agents` now verifies every
  route-map path in AGENTS.md exists on disk; and the stale "~1,000 strings still to extract" claim
  was corrected everywhere — that backlog is finished.

## List pagination and query bounding (delivered 2026-07-30)

- **Cursor pagination reaches the waiver integrity audit and the staff reviews queue** — both now
  page with the same opaque keyset cursor (`src/db/cursor.ts`) that the diver roster and schedule
  board already used, showing a "Show more" link instead of either an unbounded fetch or a silent
  truncation. The waivers page previously fetched every signed record a shop ever had and then
  showed only the first 20 with no way to reach the rest; it now pages the same way the other lists
  do.
- **Today's board, the blockers queue, the reschedule picker, and a diver's "book on an upcoming
  trip" list** all switched from the intentionally-unbounded `upcomingTripsWithCounts` to the
  existing `pagedUpcomingTripsWithCounts`, so each asks the database for only the trips it can use
  instead of every scheduled trip in the shop's future. The notification-delivery-issues query Today
  reads is now windowed to Today's own horizon in SQL rather than fetched shop-wide and filtered
  after.

## Calendar subscriptions, feature modules, and the copy ratchet (delivered 2026-07-30)

- **Staff calendar subscriptions** — a captain or instructor subscribes to their DiveDay departures
  from Google, Apple, or Outlook via a read-only iCalendar feed at `/calendar/<token>.ics`
  (`webcal:` form offered too). Two scopes: their own assignments, or every shop departure for an
  owner/manager. The credential never expires — a lapsed one would stop a calendar updating
  silently — so rotation is the remedy and issuing *is* rotating; authorization is re-derived from
  current roles on every fetch, so leaving the team kills the feed with no cleanup step
  ([calendar-feed-subscriptions](../architecture/decisions/20260730-calendar-feed-subscriptions.md)).
- **Feature modules** — `src/features/<feature>/` publishes exactly one entry point (`index.ts`) and
  documents itself (`README.md`); `pnpm check:architecture` fails a deep import, a missing file, or
  a `lib`/`db` file reaching up into a feature. Dependency direction is now `app → features →
  lib/db`, one way and enforced. `calendar-sync` is the first module — a convention proven on one
  feature, not a migration order
  ([feature-module-contracts](../architecture/decisions/20260730-feature-module-contracts.md)).
- **The copy ratchet** — a staff message bundle (`staff.json`, server-side only) plus
  `pnpm check:copy`, which blocked *new* hard-coded copy outright and let the existing debt only
  ever shrink: a count that rose failed, and a count that fell had to be banked in the same
  change. That debt is now fully paid down — the baseline is empty and the ratchet behaves as a
  full gate. Domain layers now return codes rather than sentences. The staffing page and the
  whole calendar-subscriptions surface ship fully translated into `es-ES`
  ([staff-copy-localization](../architecture/decisions/20260730-staff-copy-localization.md)).

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
> still open. Tracked in [roadmap.md](features/roadmap.md) and [human-decisions.md](human-decisions.md).

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
  (email) seam; an AWS SNS `notifySms()` seam adds courtesy SMS, used today by the scheduled
  7-day/24-hour pre-trip reminders. All degrade to `not_configured` until their env is set
  ([sns-sms-adapter](../architecture/decisions/20260802-sns-sms-adapter.md),
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
  `src/app/switching/` ([marketing.md](marketing.md#where-the-words-live)). Backups and the read API are
  the open follow-ons in [roadmap.md](features/roadmap.md).
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
- **Event instrumentation** — a typed `src/lib/analytics.ts` seam over Vercel Analytics' custom
  events, covering staff recovery, blocker frequency, checkout abandonment, and — as of
  2026-07-30 — booking outcomes, wait-list joins, cancellations, refunds, waiver signing, roll-call
  readiness blocks, the schedule builder's four mutations, and staff sign-in
  ([event-instrumentation](../architecture/decisions/20260723-event-instrumentation.md)).
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
  [fareharbor-feature-gaps-20260726.md](archive/fareharbor-feature-gaps-20260726.md).
  See [20260726-schedule-embed](../architecture/decisions/20260726-schedule-embed.md).

## Abandoned pay-at-booking checkout recovery (delivered 2026-07-26)

- **A diver who reserves a seat but doesn't finish paying gets a nudge email** — rides the existing
  daily reminders/recap cron (`GET /api/cron/reminders`), reconciles every candidate against Stripe
  before sending (a delayed webhook can leave a paid session looking `pending`), and refuses to send
  once the trip or any linked booking has been cancelled since checkout started. The purchaser's
  email is stored durably on `booking_checkouts.customer_email` at checkout-creation time rather
  than re-derived from the party's linked bookings. Answers the abandoned-cart gap named in
  [fareharbor-feature-gaps-20260726.md](archive/fareharbor-feature-gaps-20260726.md).
  See [20260726-abandoned-checkout-recovery](../architecture/decisions/20260726-abandoned-checkout-recovery.md).

## Post-trip review request (delivered 2026-07-26)

- **A "Leave a review" section on the recap page** — one optional shop-level `shops.review_url` set
  once in Settings; the recap page renders a plain `target="_blank"` link to it when configured,
  nothing otherwise. No review-platform API integration, no click tracking, no sentiment gating (ToS
  risk). Rides the existing recap delivery rather than its own send. Answers the review-request gap
  named in [fareharbor-feature-gaps-20260726.md](archive/fareharbor-feature-gaps-20260726.md).
  See [20260726-post-trip-review-request](../architecture/decisions/20260726-post-trip-review-request.md).

## Post-trip crew tipping (delivered 2026-07-26)

- **A diver can tip the crew from the recap page** — a full 100%-to-shop Stripe Checkout on the
  shop's own connected account, same merchant-of-record model as a booking checkout but tracked in a
  dedicated `tips` table so its simpler lifecycle never threads through the booking-payment gate.
  Three presets ($5/$10/$20) or a bounded custom amount ($1–$500), enforced server-side regardless of
  which the diver used. Inert until a shop both connects Stripe and has `chargesEnabled`. Answers the
  tipping gap named in [fareharbor-feature-gaps-20260726.md](archive/fareharbor-feature-gaps-20260726.md).
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
  [fareharbor-feature-gaps-20260726.md](archive/fareharbor-feature-gaps-20260726.md).
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

## Diver-selectable checkout upsells — rental gear (delivered 2026-08-01)

- **Rental gear selection moves ahead of the first checkout.** A shop that has priced any rental
  gear online (`hasAnyRentalPricing`) shows a per-diver gear step on the public booking form, right
  next to the party fields — checkboxes for every offered item plus nitrox, defaulting to the
  shop's own defaults, with a live per-diver quote (`quoteRentalFit`, unchanged). A shop that has
  priced nothing keeps today's flow with zero change.
- **One combined Stripe Checkout.** The trip fee and every diver's priced gear ride the same hosted
  session as separate line items — `CreateCheckoutSessionRequest` moved from one hardcoded line to
  a `lineItems` array. Gear is always charged in full; a trip's deposit policy discounts only the
  trip-fee line. Each diver's gear subtotal is snapshotted onto `booking_checkout_bookings.gear_cents`
  so a later refund or report can attribute money back to trip vs. gear.
- **The chosen fit and nitrox request are saved the moment the booking exists** — the same
  `saveRentalFit`/`setBookingNitrox` writes the post-booking form already made, just a step earlier;
  that form still exists for a diver who skipped the step or wants to add sizes afterward.
  Was the highest-leverage of [roadmap.md](features/roadmap.md#not-scheduled--candidate-subsystems)'s deferred revenue-layer
  candidates. See
  [20260801-checkout-upsells-rental-gear](../architecture/decisions/20260801-checkout-upsells-rental-gear.md).

## Simplification rulings (2026-07-19 → 20 audit)

The cleanup audit executed in full; its durable "don't re-litigate this" rulings — separate diver
and staff trip pages, per-test PGlite, split dive-site helpers, retained superseded ADRs — live in
[architecture/overview.md](../architecture/overview.md#settled-shape-decisions). Navigation
unification, one notice system, the `reports`/`shop` cuts, the trial/demo split, honest marketing,
and the decomposition of the four monster pages all shipped.
