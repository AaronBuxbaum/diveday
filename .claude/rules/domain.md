---
paths:
  - "src/lib/**"
  - "src/features/**"
---

# Rules for `src/lib/` and `src/features/`

Framework-free domain logic and the feature modules. Each rule names what enforces it; the
reasoning and the longer form of every row are in
[docs/agents/repo-checks.md](../../docs/agents/repo-checks.md#the-domain-rules).

## Where things are

AGENTS.md and [the route map](../../docs/agents/route-map.md) say where (capacity, dates, payments,
Today, notifications, offline manifests, auth). What they do not say:

- **Admission is weaker than readiness**: `src/lib/trip-admission.ts` (booking-time) never refuses
  someone `src/lib/readiness.ts` (boarding-time) would clear.
- **Codes and deals** both resolve in `bookSpot`, and Stripe owns the arithmetic.
- **Today and the close-out are a feature**, `src/features/today` (issue #2756): they read every
  other module, so nothing in `src/lib`, `src/db` or `src/i18n` imports them. Closing the day is a
  recorded act, never a gate, and the open head counts have one detector, `src/features/roll-call-gaps/store.ts`
  (ADR 20260804-day-closeout). What a substrate module needs from Today is a small file below it:
  `today-kinds.ts`, `today-urgency.ts`, `today-job.ts`, `roll-call-gaps.ts`, `closeout-kinds.ts`,
  `blockers.ts`, `seat-sailed.ts`, `shop-day.ts`; import those, not the queue.
- **Offline manifests**: two `no-store` routes read through the response types in
  `src/lib/offline-manifests.ts` (ADR 20260726-shopwide-offline-manifest-priming).
- **Dive-site difficulty** is one of three codes in `src/lib/dive-site-difficulty.ts`, never free
  text (ADR 20260813-dive-site-difficulty-is-a-code).
- **Course depth** is a marker (`{depth18}`) resolved by the shop's unit; a broken marker is
  refused at save (ADR 20260814-course-depth-markers).
- **`src/proxy.ts` is convenience, not the auth boundary.**
- **Optional features**: `src/lib/shop-features.ts` (the switches) and
  `src/lib/feature-coverage.ts` (every destination and `shops` boolean, a switch or a written
  `core` reason). A new feature a shop could run without gets a switch, default on.
- **Staff destinations** are one registry, `src/lib/staff-destinations.ts` (ADR 20261001-logbook).
- **Staff notices**: `noticeUrl`, `noticeFromParam`, `shopPath` in `src/lib/staff-notices.ts`;
  never hand-build the string (notice-code guard).
- **Feature modules**: `src/features/<feature>/index.ts` is the whole public surface
  (ADR 20260730-feature-module-contracts). A Zapier hook URL is pinned to `hooks.zapier.com`.

## Rules

- **`app → features → lib/db`, one way**, and `src/lib` takes only *types* from `src/db`; a
  loader that reads is a `src/db` function or a feature module: `pnpm check:architecture`.
- **Time is read through the clock** (`nowDate()`/`nowMs()` from `src/lib/clock.ts`), never
  `new Date()` or `Date.now()`: Biome rule `clock` (`pnpm lint`). Freeze the clock at the harness, never mask
  moving text.
- **The one-hour departure buffer is asked through `hasSailed()`/`hasReturned()`**, never a second
  constant or a hand comparison: departure-buffer guard. Those and the push window and recap delay
  are rungs on one ladder, `src/lib/departure-clock.ts`; a new window measured from a departure is
  a rung there, not an offset of its own.
- **`src/lib` and `src/db` return codes, not sentences**; a registry feeding the UI holds bundle
  keys: `pnpm check:domain-strings` (ADR 20260731-domain-layer-copy-leaks).
  A renderer (the page, `src/lib/notifications/**`, the file) is the only module that imports a
  translator; the rest returns a `Copy` (`src/lib/copy.ts`) it resolves: `pnpm check:architecture`
  ratchets the files still importing one (issue #2772).
- **Every formatter takes a required `timeZone`**; a value with no instant says `"UTC"`
  (`src/lib/calendar-date.ts`): Biome rule `timezone`. Every `Intl` formatter comes from
  `src/lib/intl-cache.ts`: Biome rule `intlCache`.
- **A formatted date or time is one unit**, joined by `keepUnitsWhole` (`src/lib/date-parts.ts`)
  with U+00A0 inside; a test matches it with a string query or a regex that spells `\s`.
- **Safety-critical logic** (manifests, roll call, cert gating, medical flags) gets boring code,
  failure-path and adversarial tests, and a `dive-domain-expert` review; auth, tokens and personal
  or medical data get a `security-reviewer` review.

## Area invariants

What each area must keep true; its tests hold most of these, and its ADR the reasoning.

- **Waivers**: a signed record is immutable (a correction is a new version); a medical answer
  that triggers referral fails closed; submission is idempotent and authorized.
- **Certifications**: requirements and evidence are separate, and missing configuration fails
  closed; only verified, unexpired evidence at or above the required level clears a diver; every
  readiness blocker is typed.
- **Rental fit**: a fit is a size record, never an allocation (only a gear reservation reserves a
  unit), and the register never answers what size a diver needs; one tank per diver per planned
  dive; a nitrox request needs a verified card at write time and is re-checked on every read; a
  diver with no fit on file is named on the prep list.
- **The bench**: rental and repair, never retail (ADR 20261008-gear-work-orders). A work order
  covers a customer's own gear or one shop unit, never both; `picked_up` is terminal and a ticket
  that comes back is a new ticket; the ticket number is the shop's next from 1, allocated under a
  lock on the shop row; the Work done record is the only path from a ticket to a gear clock, and a
  shop unit returns to service only when every check passed.
- **Manifests and roll call**: every active booking appears, incomplete or blocked included;
  readiness is never recomputed differently in the manifest; a boarding change is explicit,
  time-stamped and auditable; departure and every after-dive checkpoint keep their own roll-call
  state. A buddy team is two or more, a diver is on one team per departure at most, and a team
  feeds no readiness, admission, capacity or checkpoint input.
- **Offline manifests**: a copy is encrypted, freshness-labelled, expiring and never an editable
  roster; every seat tap writes an event and an idempotent repeat writes nothing; sync replays by
  `client_event_id`, rechecks live readiness, and newer server history wins; a copy kept past
  retention only for an unsynced event is labelled expired.
- **Nitrox**: only a verified nitrox card allows an EANx fill, enforced at write; only 22 to 40%
  O2 is accepted; MOD is derived from the mix and the ppO2 ceiling, never taken from the caller; a
  fill is append-only evidence.
- **Courses**: an instructor-led session with no instructor fails closed; enrollment gates come
  from the course baseline and clear only on verified evidence; a course slug never shadows a
  staff route; a content edit never touches pricing, the cert gate or the agency age baseline; the
  roster orders by each course's own minimum level (ADR 20260805-remove-certification-paths).
- **Today**: the earlier departure's problems come first and severity ranks only within one
  departure; undated work sorts last; identical blockers on one boat collapse into one batch
  action; a diver who is already clear produces no action; an action is never a dead end.
- **Bookings**: a cancelled or past trip accepts no booking; every staff door that seats a diver
  goes through `seatDiver`.
- **Auth**: the edge proxy stays DB-free (cookie-cache reads only); actions and queries authorize
  on their own, whatever the route gate did; dev credentials never become production behavior.
- **Payments** (ADR 20260723-payment-operation-intents): every Stripe-mutating call carries an
  Idempotency-Key from a `payment_operation_intents` row written first; paid state comes only from
  Stripe (a webhook or an authenticated read), never a return URL; a payment status only moves
  forward (`setBookingPaymentIfNotFinal`) and a cancelled booking is never paid; a zero-decimal
  currency is never divided by 100 and a settled order keeps its currency; a refund automates only
  inside the stated window for a real Stripe payment, and anything else routes to staff; a
  replayed webhook repairs a partial write but never regresses a refund.
- **Notifications**: `notify()` is the one send entrypoint, each kind with a deterministic
  idempotency key; a reserved test domain never reaches SES; a provider rejection fails closed
  without exposing details; a diver's message goes in their recorded locale, then the shop's,
  never the sender's; attempt history is append-only, an event applies only when newer, and an
  unknown message id is reported without failing. SNS (SES events and SMS receipts) and Meta
  signatures are verified before any event is trusted, Meta's over the raw body; an event that
  names a tenant applies only to it. One channel per diver per message: WhatsApp when connected,
  otherwise SMS, and a WhatsApp failure falls back to SMS. WhatsApp connects only through Embedded
  Signup, and its token never reads back out of `src/db/whatsapp-accounts.ts`.
- **Reviews and promos**: a review comes only from a diver's own recap link, for a booking that
  dived; a bare rating publishes now, words wait for staff, and added words go back to moderation;
  the average never counts a held review or rounds up; `discountedAmountCents` mirrors Stripe's
  rounding; a redemption counts once per paid checkout; a last-minute promo's `max_redemptions` is
  capped at the open seats.
- **Export and import**: every table and every exported column is exported, folded or excluded
  (the coverage test); access is re-checked against the database on each request; an imported card
  lands verified and flagged, and a number another diver holds is reported, never reassigned; an
  imported waiver never overrides a live medical hold; imported prior visits write inert,
  deduplicated history and never an operational table.
- **Schedule**: occurrence dates come from `seriesOccurrenceDates` in the shop's wall-clock time;
  filling the window is one idempotent `rollSeriesForward`; `series_id` is provenance, never a live
  link.
- **Boats**: a boat is an optional label and `trips.boat_id` reserves nothing; capacity stays on
  the trip (`max_passengers` is the ceiling, `default_capacity` a prefill); a buyout withdraws the
  sale, never locks; a boat migration is expand-only.
- **Dive sites**: every sentence a diver reads on a briefing is the shop's own row; the catalog is
  a view (`?view=catalog`), not a second route tree.
- **Integrations**: delivery drains after the response (`after()`), never inline; a webhook is
  HMAC-SHA256 signed per shop.
- **Setup links** (ADR 20261009-single-use-setup-links): stored only as a SHA-256 hash, expiring
  after `SETUP_LINK_TTL_MS`; spent by a conditional update in the transaction that creates the shop;
  a bounce carries the token in an HttpOnly, SameSite=Strict cookie scoped to `/onboard`, never a
  URL; every bad link draws the same closed door.
- **Retention**: every append-only table is in exactly one of `RETENTION_DAYS`,
  `UNBOUNDED_BY_DECISION` or `OUTSIDE_RETENTION`; retention prunes trails, never people; the
  windows are a human decision (HD-11); one pass is bounded.
