# Roadmap

What is **not** built yet, and the order to build it. Sequencing guidance, not a contract; each
sequenced item ships a usable vertical slice. Re-order only with a note here explaining why.

This is the **single home for unbuilt work**: the sequenced slices, the unscheduled candidates that
have not earned a slot, the engineering-enablement backlog that keeps parallel agents productive,
and the human-owned gates that block real operations. (It absorbed `future-features.md` and
`next-steps.md` on 2026-08-01 — three files were three places to look for the same question. On the
same day, this file and its siblings moved into the [features/](README.md) folder alongside
`story-backlog.md`, `brainstorm.md`, and `ai-ml.md` — one folder is the home for every unbuilt-work
shape instead of three loose files plus AI ideas split across a brainstorm note and an audit
report.)

- What already shipped is indexed in [../shipped.md](../shipped.md) — check there before assuming a
  gap.
- Human-owned approvals, provisional defaults, and validation gates are in
  [../human-decisions.md](../human-decisions.md); the deep buyer/rival analysis is in
  [competitive-analysis.md](../assessments/competitive-analysis.md) and
  [competitive-strategy.md](../assessments/competitive-strategy.md). The 2026-07-31 specialist
  optimization audit is archived
  ([../archive/specialist-optimization-audit-20260731.md](../archive/specialist-optimization-audit-20260731.md))
  — every lens shipped or moved out by 2026-08-01: ML & data into [ai-ml.md](ai-ml.md), security &
  privacy into [../shipped.md](../shipped.md), and its three still-open accessibility contrast
  fixes into this file's own [Accessibility contrast fixes](#accessibility-contrast-fixes-blocked-on-a-color-guide-decision)
  section below (two of the three have since shipped; one remains).
- Open UX tickets carried out of the persona review live in [story-backlog.md](story-backlog.md);
  raw, unfiltered ideas live in [brainstorm.md](brainstorm.md) (AI-required ideas in
  [ai-ml.md](ai-ml.md)) and are not commitments.
- When an item here ships, **move it to [../shipped.md](../shipped.md)** (compress to a line, link
  its ADR) rather than leaving it marked done — that pollution is what this file exists to avoid.
- This tracks the substantial open work; small per-feature follow-ons may also live in the ADR that
  introduced the feature (grep the ADR's *Consequences* for "follow-up").

## Where we are

Milestones M0–M7 are built: the five pillars (bookings, waivers, cert checks, rental-fit prep, boat
manifests), Stripe Connect payments with checkout-at-booking and deposits, multi-channel
notifications with scheduled reminders, the Today work queue, owner reporting, and full-shop export
— plus the UX arc that made those surfaces *act* (one-tap sends, transactional `/ready`, command
palette), the growth layer (reviews, promo codes, SEO, embed), and full diver **and** staff copy
localization. See [../shipped.md](../shipped.md).

The next arc is **not new pillars.** It is finishing the data-portability wedge and closing the
production-readiness gaps. The buyer objection that was losing deals — no gear register — was
answered 2026-08-20 ([../shipped.md](../shipped.md); ADR 20260815-minimal-gear-register).
Breadth is done; depth and proof are the work.

## Open work, in priority order

### 1. Data-portability follow-ons (the wedge)

Export, the diver/customer CSV importer, the public migration guides, and the scheduled backup
export to shop-owned storage have shipped (see [../shipped.md](../shipped.md)); one piece of the
"switching is safe" story remains. Sequenced in
[competitive-strategy.md](../assessments/competitive-strategy.md#the-build-plan-in-order).

- **Read API + webhooks**, every tier — token-scoped reads over the export schema plus
  booking/waiver/manifest events. **ADR required** before building. This is the concrete mechanism
  behind "keep your existing retail POS, DiveDay runs the boat day" (see the vision non-goals) — it
  has real payload today (bookings, waivers, `rental_fit.csv`, and since 2026-08-20 the gear
  register's `gear_items.csv` / `gear_service_events.csv` / `gear_reservations.csv` — the
  most-asked-for one, so the register-with-no-way-out half of the old objection is closed and only
  the API half remains).
  [20260815-outbound-integration-webhooks-and-zapier](../../architecture/decisions/20260815-outbound-integration-webhooks-and-zapier.md)
  sketches the `gear_item.*` events and still governs the transport (HMAC signing, at-least-once
  delivery, dead-letter log). **Its one-directional rule no longer holds** — shop-authorized
  Shopify and QuickBooks Online connectors shipped on 2026-08-25 and
  [20260827-shop-authorized-provider-connectors](../../architecture/decisions/20260827-shop-authorized-provider-connectors.md)
  accepts them: DiveDay may call a provider's API on a shop's own credentials, on private apps
  never submitted to a public directory, pushing DiveDay's facts out and never reading a provider's
  data back in as truth. A direct competitor (DiveShop360) is still not a target — nobody there has
  a reason to build the receiving end — so for everything off that short register the shape remains
  DiveDay's events feeding a no-code bridge (Zapier/Make) the shop wires up itself.

### 2. Third-party e-signature adapter (M3 follow-up)

The waiver signature is still in-house typed consent (`src/lib/signatures.ts` — local and in-person
providers only). A vendor adapter behind the existing `SignatureProvider` seam is follow-up work,
gated on the H-01/H-03 legal decisions
([waiver-signature-retention](../../architecture/decisions/20260718-waiver-signature-retention.md)).

### 3. Nitrox fill / analysis log (open question)

The analyzed-fill log was retired with M5's gear inventory (it referenced a tracked cylinder).
The gear register (shipped 2026-08-20,
[20260815-minimal-gear-register](../../architecture/decisions/20260815-minimal-gear-register.md))
tracks cylinders again — including their O2-clean clocks — but deliberately holds no fill record
of any kind: whether one should return remains gated on the nitrox policy decision — V-05 and
H-11 in [../human-decisions.md](../human-decisions.md).

### 4. Multi-boat / multi-shop configuration

Multi-shop tenancy exists (`shop_id` everywhere); there is **no boat entity** — a trip is the
boat-day. Per-boat configuration and multi-location operating views are unbuilt, and their
provider/policy decisions are open. Deliberately deferred until a real operator needs it. The
private/buyout charter workflow below blocks on this same modeling — design the two together, not
separately. That joint design now exists on paper — the Proposed ADR
[20260804-boat-resource-model](../../architecture/decisions/20260804-boat-resource-model.md) and its
[dossier](../../architecture/boat-resource-model-dossier.md) — the deferral itself is unchanged.

### 5. The departure's two working surfaces (design complete)

The trip and manifest redesign, drawn before the code and argued in the Proposed ADR
[20260827-the-departure-is-two-working-surfaces](../../architecture/decisions/20260827-the-departure-is-two-working-surfaces.md).
Pictures live in
[its canvas](../../design/canvases/20260827-the-departure-is-two-working-surfaces/README.md); the
holistic pass for both surfaces is in [design/surfaces.md](../../design/surfaces.md). Unranked
against items 1–4 — it is design-ready rather than urgent, and where it sits is an owner call.

Sequenced so each slice ships standing on its own, safest-first. **Each ends with the same
obligation**, which is what keeps the design and the code from drifting once the canvas closes: the
component that must not drift names the ADR in its doc comment, and a test fails on the rule (never
a pixel snapshot).

- **5a. The boat manifest at phone size — shipped 2026-08-27.** See
  [shipped.md](../shipped.md#the-boat-manifest-becomes-an-instrument-delivered-2026-08-27). Two
  things the later slices should know: the emergency band is still a standing panel (it moved below
  the roll call rather than behind the `⋯`, which is 5c's job, and its numbers are still `tel:`
  links), and the executed-dive log still stands open on the boat although the ADR's tier list puts
  the dive log ashore.
- **5b. The person sheet — shipped 2026-09-01.** See
  [shipped.md](../shipped.md#a-roll-call-row-opens-the-persons-sheet-delivered-2026-09-01). Two
  notes for the slices after it: the roster's own reference panel (5d's note below) now has a
  sibling with a richer vocabulary, and whether the two converge is a question for whoever touches
  the Trip page next; and the sheet is the surface 5c's `⋯` menu sits beside, so the emergency
  burial lands in a page that already has a one-tap tier to put things in.
- **5c. Emergency numbers become buried reference.** The manifest's standing band moves behind the
  phone's `⋯` and a desktop footer line; the printed manifest is unchanged. *Pins:* an assertion
  that the printed sheet still carries every number, since that is the fallback the burial relies
  on.
- **5d. The Guests roster becomes one grouped ledger — shipped 2026-08-29.** See
  [shipped.md](../shipped.md#the-guests-roster-becomes-one-grouped-ledger-delivered-2026-08-29).
  One note for 5b: the reference panel (email, rental fit, pickup, contact on file) still lives
  behind each row's trailing mark, because until the person sheet exists it has no other home —
  when 5b lands, decide whether the roster's panel defers to it.
- **5e. Overview folds into Trip's Details panel, four tabs become three.** **Blocked on the owner
  call below** — it is the one slice that changes where an action lives.
- **5f. Emoji status marks become drawn SVG** across both surfaces. Mechanically the smallest and
  independently shippable; `check:repo`'s tinted-ink gate already covers the palette half.

**Two owner calls before 5e** (both recorded in the ADR's Consequences): whether folding Overview
into Trip is an acceptable reading of one-home-per-action, and whether boat mode should hide the
phone dock. Both want a `dive-domain-expert` review; 5a–5d and 5f do not depend on either.

### 6. Clearwater — the surface language (design complete)

The app-wide surface redesign — type-led hierarchy, grouped ledgers over card stacks, earned
elevation, and five recomposed surfaces — argued in the Proposed ADR
[20260827-clearwater-surface-language](../../architecture/decisions/20260827-clearwater-surface-language.md).
Pictures live in
[its canvas](../../design/canvases/20260827-clearwater-surface-language/README.md); the holistic
passes are in [design/surfaces.md](../../design/surfaces.md). The trip/manifest surfaces are out of
scope (item 5 owns them). Unranked against items 1–5; where it sits is an owner call.

Sequenced so the language lands before the recompositions that speak it. **Each slice ends with the
standing obligation**: the component that must not drift names the ADR in its doc comment, and a
test pins the rule (never a pixel snapshot).

**Every slice of this section shipped 2026-08-28** ([shipped.md](../shipped.md)) — 6a–6i, the
last of them 6d (the home's evening reading and the fold) and 6f. Both of the section's owner calls
were decided before the build: H-62 (the fold) and H-63 (desktop-only week) in
[../human-decisions.md](../human-decisions.md), 2026-08-27. The ADR is what code obeys now; the
canvas and [its implementation spec](../../design/canvases/20260827-clearwater-surface-language/SPEC.md)
stand as the dated argument.

**The build-order graph across items 6–10 is spent** — every slice it sequenced has landed, so
what it described as arriving is simply in the tree: the ledger primitives
(`GroupLabel`/`LedgerGroup`/`LedgerRow`/`RowKind`/`InsetGroup`), `--chrome-h` and `ChromeBar`,
`assembleDaySpine`/`DaySpine`/`DayStation`, the `?week=` grammar, `ThreadShell` and the thread's
own vocabulary (`src/lib/thread-steps.ts`), the person rows
(`src/components/person/rows.tsx`), and the long-form editor pattern
(`src/components/editor/`). One deletion from it is worth carrying forward, because it is a
subtraction rather than an addition: 7c deleted `DiveBriefingsSection` and the card deck under it,
so a diver's reading of what a day dives is the trip page's "The day", "The route" and "Look for"
and nothing else.

### 7. The diver's thread (design complete)

One link from booking to afterglow, in the Clearwater grammar — argued in the Proposed ADR
[20260827-the-divers-thread](../../architecture/decisions/20260827-the-divers-thread.md), drawn in
[its canvas](../../design/canvases/20260827-the-divers-thread/README.md), specified in
[its SPEC](../../design/canvases/20260827-the-divers-thread/SPEC.md). Extends items 5 and 6;
unranked against them. The regression floor is the existing booking/readiness/waiver/recap e2e
suite — every slice keeps it green.

**Every slice of this section shipped 2026-08-28** ([shipped.md](../shipped.md)) — 7a–7e, the
last of them 7d (the after-state and the recap fold) and 7e. Two things the section deliberately did
not carry are still open and are not slices: the keepsake's unprompted-share artifact, which issue
#1081 holds, and the second booking-time email, which stays an owner call.

### 8. People, not lists (design complete)

The staff people surfaces — the diver record (whose one idea issue #780 recorded as unanswered),
the roster, reviews, waivers, requests — argued in the Proposed ADR
[20260827-people-not-lists](../../architecture/decisions/20260827-people-not-lists.md), drawn in
[its canvas](../../design/canvases/20260827-people-not-lists/README.md), specified in
[its SPEC](../../design/canvases/20260827-people-not-lists/SPEC.md). Speaks Clearwater (item 6).

**Every slice of this section shipped 2026-08-28** ([shipped.md](../shipped.md)) — 8a–8f. 8b and 8e
each had the `security-reviewer` pass their surfaces require.


### 9. The shop's shelves (design complete)

The catalog and setup surfaces — dive sites, the long-form editors, gear, staffing, reports, and
the mapped rest — argued in the Proposed ADR
[20260827-the-shops-shelves](../../architecture/decisions/20260827-the-shops-shelves.md), drawn in
[its canvas](../../design/canvases/20260827-the-shops-shelves/README.md), specified in
[its SPEC](../../design/canvases/20260827-the-shops-shelves/SPEC.md). Completes the Clearwater
stack's app-wide pass (items 6–9 + the departure's own item 5). Unranked.

**Every slice of this section shipped 2026-08-28** ([shipped.md](../shipped.md)) — 9a–9h, the
last of them the editor rail (9b on the course editor, 9c on the site form) and 9g's mapped
surfaces. The rail is a shared module now, `src/components/editor/`, rather than a shape either
editor owns.

### 10. First light (design complete)

The doors — sign-in, onboard, the reset/verify/invite family, claim, unsubscribe — and the shop's
first morning, argued in the Proposed ADR
[20260827-first-light](../../architecture/decisions/20260827-first-light.md), drawn in
[its canvas](../../design/canvases/20260827-first-light/README.md), specified in
[its SPEC](../../design/canvases/20260827-first-light/SPEC.md). Closes the route-coverage hole the
2026-08-27 sweep found: the pages a person meets *before* items 6–9's surfaces.

**Every slice of this section shipped 2026-08-28** ([shipped.md](../shipped.md)) — 10a–10d.


### 11. Product ideas from the sweep (each needs an owner's nod)

Thirteen ideas from the 2026-08-27 design sweep, each composing into a surface items 6–10 already
design — none adds a nav destination. Every one carries a schema/lib/surface sketch here so a
green-light starts warm; none is scheduled, and several are safety-adjacent enough to need the
standing reviews. Ordered roughly by leverage-per-effort.

- **Morning conditions call.** A recorded Go / Watching word on a departure — append-only
  `trip_condition_calls` (call enum, optional shop-worded note), latest row wins, deliberately no
  `blown_out` value (that act stays the blowout cascade). Renders beside the station's time (6c)
  and the week cell (6e); "watching" adds a Today urgency row. Informs, never gates; staff-only
  until an owner call puts anything on the storefront. *Medium.*
- **Milestone cues for the crew.** The visit ordinal (already computable) plus two nullable
  self-reported columns (`people.logged_dives_count`, `logged_dives_as_of`) feed
  `milestoneForBooking()` → quiet text on the counter row (6h) and record masthead (8b), one desk
  row when milestones are aboard. Never a badge, never in readiness logic; the projection always
  attributed ("by their own log"). *Small.*
- **No-show frees the seat.** When a boarding-window booking is `no_show`, the boat full, and
  live wait-list entries exist, the counter's blocked group offers one row — "Seat free — 3
  waiting · Invite" — riding the existing freed-seat invite path. Never auto-refunds, never
  auto-cancels; the seat is still claimed through `bookSpot`'s transaction. *Small; one money
  policy line for the owner.*
- **Usage-based service sentence on gear.** `usageSinceService(unitId)` counts reservation-days
  since the last service event; above a per-kind threshold the row's existing service sentence
  gains the usage clause ("~48 dive-days since service"). Copy says dive-days, never dives;
  informs only (ADR 20260815). *Small.*
- **Dive insurance completes the emergency picture.** `people.dive_insurance` exists with no
  writer and no emergency reader: one optional field in the thread's contact step (never a sixth
  step), rendered beside the emergency contact on the person sheet, the printed manifest, and
  the record's file group. security-reviewer; inform-only. *Small.*
- **Recent conditions replayed on the site library.** `latestSiteConditions(siteId)` reads the
  newest executed-dive log ≤14 days (defensive over `observed_conditions` jsonb) → a quiet
  second line on the 9a row and under the add panel's chosen site. Staff-only by design.
  *Small.*
- **Share-the-boat door, counted.** A `booking_referrals` table plus a non-secret
  `bookings.share_ref` id: the thread offers "Bring a buddy · 4 spots left" linking to the public
  trip page with `?via=`; `bookSpot` records the referral when the id resolves, ignores it
  otherwise. One quiet reports line ("6 seats came from shared links"). Explicitly no credits —
  that stays the parked referral-program call; the capability token never enters the URL.
  *Medium.*
- **Refresher counsel for rusty divers.** One nullable `shops.refresher_course_id` (a settings
  course picker): when the booking's recency band is stale and the course is live, the thread's
  prep state renders one quiet line linking to it — absent within 48h of departure. Counsel,
  never a gate; dive-domain-expert on the wording. *Small.*
- **Load-out checklist templates.** `checklist_template_items` (shop-worded label + trigger enum
  always/night/nitrox/deep_site) copy into the pre-departure checklist at trip creation and
  series materialization — copy-on-create, like site templates. Managed as one Settings inset
  group. Safety-critical review path. *Medium.*
- **Tips by crew.** `tipsByCrewForMonth()` joins paid tips → bookings → trips → assignments,
  split equally per departure; one collapsed disclosure under the 9f tips figure, with an
  "unassigned" remainder line so no money silently drops. Display arithmetic only — not payroll.
  *Small.*
- **Site rotation memory.** `recentSiteRuns(shopId, siteId, 14d)` under the add panel's chosen
  site: "Ran 3× in the last 14 days." One read after selection; cancelled blowouts never count
  as "ran". *Small.*
- **Seasonal price windows on a series.** `trip_series_price_windows` (date range + price,
  overlap-refused): materialization prices each new occurrence through
  `priceForOccurrence()`; existing instances keep their price; per-trip edit stays the override.
  One inset group in the add panel's repeat disclosure. *Medium.*
- **One outbound review door.** `shops.external_review_url` (validated https, a settings row):
  after the after-state's review submits, one quiet "Also share it on Google" link — shown to
  every submitter regardless of stars (selective solicitation is the review-gating the
  suppression floor already refuses), never pre-filling the text. *Small.*

### 12. The marketing pages earn the trial (review complete)

The conversion pass argued in
[marketing-review-20260827.md](../marketing-review-20260827.md) — three diagnoses (the
persuasion gradient is inverted, the terms never stand at the doors, help arrives after the
homework) and every replacement sentence written out, claims-policy-clean. Each slice is one
`marketing-page`-skill PR: claims checklist, `e2e/marketing.spec.ts` assertion updates
(deliberate), screenshots looked at light+dark, `conversion-reviewer` re-pass. Copy lands in
both locales in the same change. Unranked, but 12a and 12c aim directly at "owners aren't
starting trials."

**12a–12f all shipped 2026-08-28** ([shipped.md](../shipped.md)). What is left of the review is
not a slice: the leave-it guides' pricing link stays where the review left it, an owner call.

## Concept-model simplification (proposed — each row needs an owner decision)

A 2026-08-08 eight-agent design review (three of them information-architecture rethinkers)
converged on one finding: the app asks a shop to learn roughly twice as many nouns as it has
concepts. The surface-level follow-through shipped (the Today redesign, the audit-fix loops, the
six-tab header); what remains below is **concept**-level — each row changes what the product *is*
named or shaped like, so each needs an explicit owner call before implementation, recorded in
[human-decisions.md](../human-decisions.md). None is sequenced; recommendations are the review's,
not decisions.

| Proposal | What it merges or cuts | Recommendation | Cost |
| --- | --- | --- | --- |
| **The home becomes the shop's day** | Today absorbs counter Check-in (provably the by-departure view filtered oppositely — both read `operational-window.ts`) and Close-out (already "Today's evening mirror" by its own docstring); the home leads with the phase the clock is in, with a visible way to any phase | **First half decided 2026-08-27 (H-62)** — Close-out folds into the home's evening, designed as Clearwater slice 6d. The Check-in fold remains the open second half, still gated on the arrived-vs-aboard data question below | Route 308s, `?view=` contract, large e2e/visual churn |
| **Check-in = boarding's first rung** | `bookings.status = checked_in` and the manifest's "boarded" are two staff-recorded arrival facts that can disagree; make arrival a two-rung state (arrived → aboard) on the departure's first checkpoint | Do it *with* the Check-in fold above, not before — it is the data half of the same merge | Schema migration, counter surface, Today rows, reports |
| **One "your trip" link per diver** | Promote `/ready/[token]` to the single capability page (waiver step, prep, recap as states over time); retire the trip page's `?booking=` confirmation branch and the second booking-time email | **Part shipped 2026-08-20** — the owner called the shape and the confirmation branch is gone: booking and Stripe both land on `/ready`, the three duplicate server actions are deleted, and the `confirm` capability is now read-only and embed-only (ADR [20260820-one-page-after-booking](../../architecture/decisions/20260820-one-page-after-booking.md)). **Still open:** folding recap into the same link as a post-trip state, and the second booking-time email | Recap-token reconciliation, email templates |
| **One "Bill" per booking** | Order / invoice / checkout / payment stay as Stripe mechanisms but surface as one money story per booking — quoted, deposit, paid, owed, refunded | Do after the diver-link work; touches every money surface | Orders index re-homing, back-office panels, reports |
| **One "Deal", one "Interest"** | Shop promo codes + one-trip last-minute deals become one discount concept with a scope; wait list + last-minute list become one "divers who want in" record with a scope | The review's alternative — cutting the last-minute subsystem outright — is defensible pre-users but cuts a shipped revenue feature, so it is explicitly an owner call | Two staff pages merge, Stripe coupon lifecycle, `bookSpot` resolution |
| **"Departure" as the one noun** | Retire trip/charter/course-session as UI vocabulary (`trips.course_id` already agrees a session *is* a trip row); a course departure is a departure with a curriculum | Copy-level only, no schema rename; do alongside any of the above | Every staff/diver bundle, glossary, marketing pages |

## Not scheduled — candidate subsystems

Revenue-layer features DiveDay has deliberately **not** built, kept as a shortlist. Each is a real
dive-shop use case with a verified gap behind it; each is here because it is closer to a new
subsystem than a slice on top of what exists, not because it was judged unimportant. **Nothing in
this section is sequenced** — an item leaves it by earning a numbered slot above and the ADR it
needs, not by being built straight from the list. Both came out of the FareHarbor feature-gap audit
([archive/fareharbor-feature-gaps-20260726.md](../archive/fareharbor-feature-gaps-20260726.md)), whose
every other row has shipped — including diver-selectable checkout upsells, once its ADR unblocked it
(see [../shipped.md](../shipped.md#diver-selectable-checkout-upsells--rental-gear-delivered-2026-08-01)).
Verified against the running code 2026-08-01; re-verify before planning from it.

### Gift cards

A shop sells stored value and a diver redeems it against any trip or course.

- **Exists:** nothing — zero references in `src`. The nearest neighbours are Stripe Connect,
  orders/refunds, and the shop-configured discount surface that shipped with promo codes.
- **Missing:** a stored-value ledger — issue, balance, partial redemption, expiry, and how a
  redemption interacts with a refund. A promo code is a discount Stripe computes at payment time; a
  gift card is customer money DiveDay would be holding, so it is a liability to track, not a checkout
  tweak.
- **Why it isn't scheduled:** the ledger is a new subsystem, and unclaimed-balance rules are
  jurisdictional — a finance/legal question before an engineering one (see
  [stakeholders/finance-and-tax.md](../stakeholders/finance-and-tax.md)). It is a seasonal revenue lever;
  revisit ahead of a gifting season with real shops on the platform. **ADR required.**

### Private / buyout charters

A group buys out a whole departure: proposal, contract, deposit, and the boat off public sale.

- **Exists:** party booking ships — the public form books a party of up to six atomically
  (`createBookingParty`) on one shared checkout (`startBookingCheckout`), and deposits ship. So
  "group booking" is not the gap. "Charter" elsewhere in the code is only a synonym for a scheduled
  trip (`src/db/seed.ts`).
- **Missing:** the buyout workflow — quote/proposal → contract → deposit → the departure withdrawn
  from public sale — and the resource it blocks. There is still no boat entity; a trip *is* the
  boat-day.
- **Why it isn't scheduled:** it depends on the boat/resource modeling that
  [§4 above](#4-multi-boat--multi-shop-configuration) already holds open, and should be designed
  together with it rather than as a separate effort. **ADR required.** The joint design is now
  written as the Proposed ADR
  [20260804-boat-resource-model](../../architecture/decisions/20260804-boat-resource-model.md)
  (buyout = slices 3–4 there); this entry stays unscheduled until that ADR is accepted.

### Participants who are not divers

A snorkeller and a boat rider on a diver's departure — different prices, different gates, the same
head count.

- **Exists:** one kind of passenger. A `bookings` row *is* a diver seat: it consumes trip capacity,
  admission gates it on certification, readiness asks it for a card, and it is priced at the trip's
  one `price_cents`.
- **Missing:** a participant type on the booking, a second capacity limit (bodies aboard is not the
  same number as divers to kit out), per-type pricing, and a head count that counts everyone.
- **Why it isn't scheduled:** four slices, one of which reaches into `bookSpot`'s capacity
  transaction and the manifest — both safety-critical. Its price and waiver assumptions are inferred
  from published rate cards rather than from a shop, and the questions that would settle them are now
  in the first-call script (§C3). **ADR required.** Scoped in full at
  [participant-types.md](participant-types.md) (product owner, 2026-08-20).

### Smaller follow-ons live with their ADRs

These are per-feature rough edges on shipped work, not future subsystems. They are recorded in the
*Consequences* of the ADR that shipped each feature, which stays the place to look:

- Fixed-amount (rather than percent) discounts, auto-applied codes, and Stripe-side drift on a code's
  status — [20260729-shop-promo-codes](../../architecture/decisions/20260729-shop-promo-codes.md).
- Self-service reschedule of a *paid* booking, which still requires staff —
  [20260727-diver-self-service-cancel](../../architecture/decisions/20260727-diver-self-service-cancel.md).
- Recovery-email timing on the daily cron, and the party "purchaser" being the first-named diver
  rather than a verified who's-paying field —
  [20260726-abandoned-checkout-recovery](../../architecture/decisions/20260726-abandoned-checkout-recovery.md).
- Per-trip (rather than per-shop) ratings, replies to reviews, and any third-party review widget —
  [20260729-verified-diver-reviews](../../architecture/decisions/20260729-verified-diver-reviews.md).
- Currencies beyond the shop's declared one on a single order, and Stripe-reported settlement
  currency drift — [20260731-shop-currency](../../architecture/decisions/20260731-shop-currency.md).
- Recording **crew** roll call offline (it is online-only; the offline panel states the limitation
  neutrally and the checkpoint stays open) —
  [20260803-per-person-crew-roll-call](../../architecture/decisions/20260803-per-person-crew-roll-call.md).
  The count-level attestation it names as a follow-on has since been retired, and one edge remains
  with that: a hand nobody rostered can only be recorded by first creating them as staff, which no
  dockside crew member can do — the follow-on is a one-tap "add someone who sailed" on the manifest
  itself. See
  [20260804-crew-roll-call-is-per-person](../../architecture/decisions/20260804-crew-roll-call-is-per-person.md),
  whose other edge (a staff-role strip dropping somebody from a historical trip's crew list, closing
  a checkpoint held open because they did not come back) is closed.
- Setting a per-trip crew role from Today's departure board (assign-only by design), and a
  vocabulary for roles this enum cannot express (assistant instructor, safety diver) —
  [20260803-per-trip-crew-role](../../architecture/decisions/20260803-per-trip-crew-role.md).
- Retrying a `stripe_invoice_snapshot` erasure obligation, if Stripe ever exposes an API that clears
  a finalized invoice's identity snapshot —
  [20260803-processor-erasure-obligations](../../architecture/decisions/20260803-processor-erasure-obligations.md).
- A free-text companion field for `certification_agency`'s `other` value. CMAS, RAID, GUE and BSAC
  now have their own enum values (2026-08-06), but a diver holding an IANTD, SEI, ANDI, ACUC, PSAI or
  NASE card still records as bare "Other agency" with nowhere to write which one — confirm the list
  with a `dive-domain-expert` review before widening a safety-adjacent enum further, or add the
  free-text companion instead of another enum value. Carried out of the archived
  [2026-08-02 review](../archive/comprehensive-review-20260802.md), DOM-L1.

## Accessibility contrast fixes (blocked on a color-guide decision)

Carried over from the archived [2026-07-31 specialist optimization
audit](../archive/specialist-optimization-audit-20260731.md#3-accessibility-contrast-tasks-moved)
§3. **Two of the three have shipped (2026-08-02 and 2026-08-23); one remains deliberately not
built**: the product owner ruled out touching the placeholder color value, because it would fight
the current color guide. Pick it up once that guide decision is made, not before — re-verify the
computed ratios against `globals.css` first, since token values may have drifted.

`e2e/a11y.spec.ts`'s axe scan **no longer excludes** the `color-contrast` rule (2026-08-23, issue
#793). What this section used to assert — that the rule "fires app-wide on exactly these token
values, so turning it on now would just paint CI red" — was measured and was not true: 23 failing
nodes in light mode and one in dark, reducing to four colour combinations, none of which was a
frozen token value. They were one mechanism, a translucent `bg-<hue>/10` fill composited over
something that is not `--surface`, and an opaque `--<hue>-tint` token closed all of them. Nothing
here is now blocking that scan, and a new contrast failure on any scanned surface is a red build.
The placeholder item below is invisible to it either way: axe does not evaluate `::placeholder`.

Nothing in the repo may claim WCAG AA conformance while that item is open — see
[design/principles.md](../../design/principles.md#tokens-the-mechanics) for the wording that is
actually true, and keep any new claim in sync with this section.

The focus-indicator item that used to head this section **shipped on 2026-08-02** and has moved to
[../shipped.md](../shipped.md) with its measured before/after ratios; `--focus-ring` now clears
WCAG 1.4.11's 3:1 in all six light/dark palettes. The tinted status-banner item **shipped on
2026-08-23** with issue #793 — and not by darkening `--success`/`--warning`, which stay exactly
where the colour guide put them: the fills those inks sit on became opaque, so the ratios the
palette had already computed are the ones that render. The one item below is what remains.

### Fix placeholder text contrast

- **Priority**: medium
- **Effort**: S
- **Prompt**: `src/app/globals.css` sets `input::placeholder`/`textarea::placeholder` to `color-mix(in srgb, var(--muted) 78%, transparent)`, which computes to 3.35:1 on white surfaces and 3.07:1 on `--surface-sunken` in light mode — placeholder text is real text under WCAG 1.4.3 and needs 4.5:1 (the schedule builder's title placeholder and search inputs rely on it). Change the rule to use `var(--muted)` at full strength (5.0:1 on background, 4.58:1 on sunken — passing) or raise the mix to a percentage that clears 4.5:1 on the darkest light-mode surface it sits on; placeholders remain visually distinct from typed text because typed text uses `--foreground`, not `--muted`. Dark mode currently sits at 4.54:1 — keep it at or above that.
- **Verification**: Node contrast script confirming ≥4.5:1 for the computed placeholder color over `#ffffff`, `#faf9f6`, and `#f1efe9` (light) and `#0d222d` (dark); axe run (or DevTools contrast checker) on the schedule builder's Add panel; `pnpm visual` diff reviewed and explained.

## Engineering enablement

The still-open work that keeps many short-lived AI agents productive and safe. Product slices are
above; this is the repository making the correct implementation path easier than an expedient wrong
one. Keep it to still-open work: when an item ships, move it to [../shipped.md](../shipped.md) or an
ADR rather than letting this become an unbounded second backlog.

### P1 — next

1. **Provider adapters for non-Claude agents.** Keep the provider-neutral workflow — `AGENTS.md`,
   `docs/`, `scripts/`, tests, and the canonical skills under `.claude/skills/` — as the single
   source of truth, and generate or maintain thin per-provider adapters (skill indexes, config
   pointers) that never introduce unique requirements. The internal-consistency half is done:
   `pnpm check:agents` fails `check:repo` when skills, the skill index, AGENTS.md references,
   AGENTS.md route-map paths, or `task:context` doc paths drift. Still open: the per-provider
   adapters themselves and checking *them* against the canonical layer.
2. **Path-aware CI.** Run the smallest trustworthy check set for a change while preserving the full
   `pnpm check` gate before merge. The per-developer half of this shipped (`pnpm test:changed`,
   `pnpm e2e:run`); what's open is job selection in `.github/workflows/ci.yml` based on changed
   paths. Changed-UI evidence is already covered — reg-suit posts a visual report per PR and
   AGENTS.md makes accounting for every diff a hard rule.
3. **Realistic seeded scenarios and visual-regression coverage for the states that aren't the happy
   path** — empty, loading, error, and safety states. The seed is realistic and busy, and the money
   surfaces and a first empty state are captured; systematic coverage of the rest is not. Its first
   concrete gap is closed: the demo shop has a **second instructor** (Talia Okonkwo), rostered as
   the Nitrox session's **divemaster** — the one (shop roles × trip role) combination
   [20260803-per-trip-crew-role](../../architecture/decisions/20260803-per-trip-crew-role.md) had
   left unseeded, and the only one that is a genuine downgrade rather than a roster over-claim
   (review 20260802, DOM-M7; delivered 2026-08-06). What remains under this heading is the rest of
   the non-happy-path states, which nothing has systematically enumerated yet.
4. **A real-Postgres CI job — shipped 2026-08-06.** A `postgres:16` service-container job applies
   `drizzle/` from empty *and* from the previous release's schema, and races two genuinely concurrent
   connections for the last seat; the `FOR UPDATE` oversell guard is no longer dead code under test
   (remove the lock and a one-seat trip sells two). Gated on `src/db/**`/`drizzle/**` plus a nightly
   run rather than per-PR — [H-38](../human-decisions.md#decision-register) asks the owner to bless
   that cadence rather than change it. See
   [20260806-real-postgres-ci-job](../../architecture/decisions/20260806-real-postgres-ci-job.md) and
   [shipped.md](../shipped.md). The [2026-08-02 review](../archive/comprehensive-review-20260802.md)
   this closed the last of its *original* engineering queue for is fully dissolved and archived as of
   2026-08-07 — its two small leftover buildable items (dropping two Stripe invoice URLs from the
   export contract, and DOM-L1's agency companion field above) and its full human-decision register
   moved into [human-decisions.md](../human-decisions.md) as H-31 through H-44.
   What it still does not rehearse, deliberately: the migrations meet an *empty* database, so lock
   duration and backfill runtime on a table with production's row count are still found in
   production.

### P2 — when parallelism or scale proves the need

1. Shard feature/entity docs and generate optional aggregates rather than maintaining a
   merge-conflict-prone central catalog. Split only after collisions prove the need.
2. Serialize migration finalization if concurrent schema PRs collide repeatedly.
3. Add a machine-readable task manifest for external orchestrators — a structured list of safe
   paths, invariants, and validation commands, generated from the same data `pnpm task:context`
   reads.
4. Add automated PR scope/collision warnings based on changed paths and declared ownership.
5. **Make the remaining prose invariants executable.** Carried out of the
   [2026-08-02 review](../archive/comprehensive-review-20260802.md#2-architecture--code-quality)'s
   recurring theme that only ratcheted rules hold. Shipped 2026-08-04: ARCH-2
   (`check-architecture.mjs` now sees bare side-effect imports, holds `src/i18n`/`src/components`
   to the layer direction, and ratchets pre-existing debt in `scripts/architecture-baseline.json`),
   I18N-4 (`pnpm check:tokens` fails raw hex and palette-scale classes, ratcheted in
   `scripts/tokens-baseline.json`), and the I18N-2 residue (`src/i18n/provider-coverage.test.ts`
   had closed both documented failure modes for `src/app` on 2026-08-03; it now also traces
   `useTranslations()` consumers under `src/components` through their importing pages). Still
   open: a scheduled check watching Next 16.3 GA, drizzle 1.0 stable and next-auth v5
   stable, which the ADRs commit to migrating to promptly with nothing tracking them (ARCH-4,
   [H-39](../human-decisions.md#decision-register)).

(Feature-folder boundaries were P2 and are now settled — see
[20260730-feature-module-contracts](../../architecture/decisions/20260730-feature-module-contracts.md)
and `pnpm check:architecture`.)

## Measures

Track a small set of measures so "delight" and "agent efficiency" stay concrete. Every meaningful
increment should improve at least one of: less staff coordination work, more diver confidence, safer
departure, or faster agent delivery.

- median time for staff to resolve a booking blocker;
- waiver completion rate before arrival and median completion time;
- percentage of departures with all readiness checks complete before the day of the trip;
- agent time from task start to first relevant test;
- tokens/files read before first code change (sampled, not exhaustively instrumented);
- PR rework caused by missed invariants, architecture drift, or merge collisions;
- escaped defects in safety-critical flows.

## Delight backlog

Cross-cutting quality to fold into slices as they're touched, not defer to a final "polish" pass.
Empty right now — the last open list shipped 2026-07-23 (see [../shipped.md](../shipped.md)). Fold
new cross-cutting quality in here as it arises.

## Production-readiness gates (human-owned)

These block real operations regardless of code completeness; owners and evidence live in
[../human-decisions.md](../human-decisions.md), and the per-discipline playbooks for clearing them
(who to talk to, with what prepared) live in [stakeholders/](../stakeholders/README.md):

- **V-02 — field-validate the offline manifest** on a phone, outdoors, wet hands, airplane-mode.
  Until it passes, the safety differentiator is unproven and unclaimable.
- **Pricing posture** — the public price is **approved for now** (`src/lib/marketing.ts`,
  early-access and still moving; H-12, 2026-07-24). H-12 also closed the founding-cohort terms —
  a **two-year price lock** and **founder-direct support** — both now published on the
  pricing and home pages. H-26 (2026-08-02) confirms the posture behind these terms is
  deliberately lifestyle-scale, not venture-scale (see [vision.md](../vision.md#what-kind-of-business-this-is)),
  and dropped the explicit same-day response-time SLA pending a real support-hour-capacity answer.
  Billing cadence, taxes/fees, and the contract flow remain open. See
  [competitive-analysis.md](../assessments/competitive-analysis.md#pricing-posture).
- **Legal / policy sign-off** for waivers, medical, retention, course rules, nitrox parameters, and
  notification consent — H-01…H-11.

## Standing rule

If a slice can't be demoed in the browser, it isn't done. Every milestone ends with a design review
against [design/principles.md](../../design/principles.md).
