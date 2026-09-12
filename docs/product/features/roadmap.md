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
- **5b. The person sheet — shipped 2026-08-29.** One tap from a roll-call row: today's trail, buddy states, emergency
  contact as reference text, one act. Replaces the two per-row disclosures. *Pins:* a test that the
  sheet renders no control that can place a call (decision 3's "no call buttons" half).
- **5c. Emergency numbers become buried reference — shipped 2026-08-29.** The manifest's standing band moves behind the
  phone's `⋯` and a desktop footer line; the printed manifest is unchanged. *Pins:* an assertion
  that the printed sheet still carries every number, since that is the fallback the burial relies
  on.
- **5d. The Guests roster becomes one grouped ledger — shipped 2026-08-29.** See
  [shipped.md](../shipped.md#the-guests-roster-becomes-one-grouped-ledger-delivered-2026-08-29).
  One note for 5b: the reference panel (email, rental fit, pickup, contact on file) still lives
  behind each row's trailing mark, because until the person sheet exists it has no other home —
  when 5b lands, decide whether the roster's panel defers to it.
- **5e. Overview folds into Trip's Details panel, four tabs become three — shipped 2026-08-29.**
  See [shipped.md](../shipped.md#the-trip-surface-folds-overview-into-its-about-panel-delivered-2026-08-29).
  The owner authorized the fold by requesting implementation; the existing `/guests` path remains
  as a compatibility route, while the canonical Trip surface owns the roster and its actions.
- **5f. Emoji status marks become drawn SVG across both surfaces — shipped 2026-08-29.** Mechanically the smallest and
  independently shippable; `check:repo`'s tinted-ink gate already covers the palette half.

The 5e fold was authorized on 2026-08-29 and keeps the existing roster actions intact. The separate
question of whether boat mode should hide the phone dock remains open for a later manifest pass;
this slice does not change that surface's dock behavior.

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
not carry were not slices: the keepsake's unprompted-share artifact, which issue #1081 held until
slice 16i shipped it as save-as-image, and the second booking-time email, still an owner call.

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


### 11. Product ideas from the sweep (all thirteen deferred past pilot)

**Ruled 2026-09-02 (Aaron Buxbaum, #1079): all thirteen are later.** None is scheduled and none
is to be picked up by a session before the first pilot shop has run a boat day. The sketches below
stay so that a green-light after the pilot starts warm; re-triage them then, not now.

**One of the thirteen was built anyway.** *No-show frees the seat* (#1209) shipped on 2026-09-11 and
its entry now lives in [shipped.md](../shipped.md#no-show-frees-the-seat-delivered-2026-09-11), where
built work belongs; the twelve sketches below are what the ruling still governs.

Thirteen ideas from the 2026-08-27 design sweep, twelve of them still sketches below, each composing
into a surface items 6–10 already design — none adds a nav destination. Every one carries a schema/lib/surface sketch here so a
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

### 14. Gaps against the field (each needs an owner's nod)

The 2026-09-01 whole-field comparison
([competitive-landscape-20260901.md](../assessments/competitive-landscape-20260901.md)) found
DiveDay complete on every table-stakes row of a 32-product feature table and ahead on the rare
ones; the seven rows it lacks that are not deliberate non-goals are filed as `needs-triage` issues
under parent #1248.

**Ruled 2026-09-02 (Aaron Buxbaum): all later.** The hotel/agent rate cards (#1237) and the agency
rail partnership (#1239) are deferred past pilot and their issues closed; the prepaid air-fill card
(#1234) keeps the boundary now written into H-11. Re-triage the rest after the first pilot boat day.

- **Prepaid air-fill cards** as package-style entitlements (#1234) — the feature owners keep
  paying the retail incumbents for; a commercial count, not the fill log H-11 declines.
- **Instructor self-service** — pros request the classes they can teach, keep blackout dates,
  the owner approves in one tap (#1235). DiveCrewPro's whole product.
- **A QR self-registration door before a booking exists** (#1236) — ScubaHub's 0% → 90–95%
  pre-arrival onboarding number.
- **Hotel and agent rate cards** (#1237) — an owner question first: 11 of 32 products have it,
  all resort-market.
- **PADI Adventures as a coexist channel guide** (#1238) — gated on a verified export path.
- **The agency rail as a partnership question** (#1239) — H-10 dropped the API; nobody has
  scheduled the conversation.

### 15. The maker is the proof (design complete; 15a and 15c wait on H-66)

The 2026-09-02 loop over every marketing page, argued on
[the canvas](../../design/canvases/20260902-the-maker-is-the-proof/README.md) and decided in ADR
[20260902-the-maker-is-the-proof](../../architecture/decisions/20260902-the-maker-is-the-proof.md):
the site has no maker, the pages argue insurance rather than desire, support is described as a
mailbox, and the copy sounds machine-written. Each slice is one `marketing-page`-skill PR — claims
checklist, `e2e/marketing.spec.ts` assertions moved deliberately, both locales in one change,
screenshots looked at, a `conversion-reviewer` pass — and the canvas's copy ledger is the change
list.

- **15a** — `/about` gains a "Who builds it" band directly under the hero, third person, no
  signature, with the three-row ledger; "spec" leaves `founderP3`. Waits on H-66 (a).
- **15b** — `/` gains one echo band between the records diptych and the close, in the
  moment-row shape, with a link to `/about` as its only new control.
- **15c** — the support sentence becomes "read by the people who build DiveDay" in its five
  places, never with a response time. Waits on H-66 (b).
- **15d** — the voice pass across every marketing page, held to the seven tells on the ledger.
- **15e** — `marketing.md` records the "ex-Google" rules, the voice list, and the biography's
  return under 15a's shape; H-12's row is amended by H-66's outcome, never rewritten.

### 16. Reef, all the way down (design complete; H-67 Chosen 2026-09-04)

The 2026-09-04 loop over every surface a shop and a diver live in, argued on
[the canvas](../../design/canvases/20260904-reef-all-the-way-down/README.md) and decided in ADR
[20260904-reef-all-the-way-down](../../architecture/decisions/20260904-reef-all-the-way-down.md):
the gap between Reef's drawings and the code is composition, not colour; the public booking page
is unbounded; and the product does not know what time it is. Every open feature idea got one
verdict, the delight budget widened along time with every ban standing, and the owner chose all
three of H-67's calls. Each slice runs the `design-implementation` skill: the component names the
ADR, a test pins the rule, the canvas README's slice table moves, and the visual diffs are explained.

- **16a** — the station on the shop home is a `SectionCard` with the site tile leading, one line
  per row, the log door a quiet link, the dial at 76px. **Started 2026-09-04.**
- **16b** — the water band follows the shop's clock (four washes) and the one fact of scale renders
  on the day it is true, with a season-start setting (#1371, #1373). **Shipped 2026-09-05.**
- **16c** — the boat says where it is: `trip_stage_events`, the manifest's stage strip, the home's
  chip, the storefront's live panel, the thread's line; the boat drawing (#1372, #1374, D20).
  **Shipped 2026-09-05** — `#1374`'s "next with space" half stays open for 16f.
- **16d** — the manifest's top: the catch-up strip (D42 with D27 folded in), the plan-change door
  (D24), the welcome word under a name (D22). **Shipped 2026-09-05.** `trip_desk_events` and
  `trip_read_marks` are new, kind-coded and prose-free, written from the consequence paths that
  already exist and pruned at 30 days; the plan change is a four-value reason plus a staff-only
  note on `executed_dives`, which never touches `trip_dives`; the welcome word is one consent
  stamp on `bookings` the diver writes on their own `/ready` thread. The strip's second drawn
  line, D12's intent count, ships with 16e.
- **16e** — the booking page bounded: three tiles and a door, the other departures worth a look
  (D01), the intent question (D12 with D23 folded into its count), the rusty diver's offers (D18);
  a composition test holds the length. **Shipped 2026-09-05.**
- **16f** — the storefront's lenses (D02) and "next with space". **Shipped 2026-09-05.** A lens is
  the shop's own word for a kind of day, single-select, and the drawn checkbox folds into a dashed
  **Has space** pill at the end of the rail.
- **16g** — the thread: "Anything changed?" (D15 with D19 folded in), provenance chips (D51), the
  rental-fit line (D14). **Shipped 2026-09-05.** It also carried the clock bug D15's own comparison
  exposed: `bookings.created_at` was Postgres' `now()` while every fact beside it read the app
  clock, so under a frozen harness every fit read as last season's.
- **16h** — the evening: souls not seats (#1346), the open-seats debrief (D47), the rental-fit
  leftover (D14), the plan-change meta (D24). **Shipped 2026-09-05.**
- **16i** — the recap: the postcard's number, save-as-image (#1081), the private line (D33), the
  private pulse (D40), the next dive (D35). **Shipped 2026-09-05.**
- **16j** — the ten adopted-unseen issues (D05 on `trips.revision`, D17, D25, #1363, #1366, D36 and
  D45 as one recap variant, D44, D52, #1357). **Shipped 2026-09-05 in two batches** rather than the
  planned pull request per issue: batch A the `.ics` SEQUENCE and the reminder rhythm, batch B the
  six the shop's own words run through. #1284's remaining half — the stored named set of embed
  departures — was dropped from this slice on 2026-09-05: the owner deferred it on 2026-09-03
  pending a shop asking. The tag question that deferral wanted decided first was answered on
  2026-09-10 (issue #1395): the set is the shape, no reusable departure tag is built for the
  embeds, and 16f's lens vocabulary stays a lens. #1357 keeps its take-down question open, which is
  `ready-for-human`; its consent stamp shipped.

16h, 16i and 16j landed as a stack, each cut from the layer below and merged bottom-up.

### 18. Nothing from nowhere (18a–18e shipped 2026-09-07; 18f waiting on H-69 b)

The 2026-09-07 loop over how the interface moves, argued on
[the canvas](../../design/canvases/20260907-nothing-from-nowhere/README.md) and proposed in ADR
[20260907-nothing-from-nowhere](../../architecture/decisions/20260907-nothing-from-nowhere.md): a
figure that changes in place swaps, a row that leaves takes 200ms and the gap beneath it closes in
none, the More sheet cannot be dragged, timing is ten copied numbers in two languages, and a
pressed row does nothing under the finger. The ADR states one physics (a three-rung ladder as
tokens, the three curves, the press on every tappable thing, an event table) and applies it in six
moves, every one rendering the cut, the swap or the tap the app has today when it is not true.
Three calls are the owner's (H-69): the spring's ration, the Wallet pass, and whether the roll and
the slide reach the roll call. Each slice runs the `design-implementation` skill: the component
names the ADR, a test pins the rule, the canvas README's slice table moves, and the visual diffs
are explained. 18b, 18c, 18d and 18e do not depend on H-69 and may start on the ADR alone; 18a's
spring half, 18c's roster half and 18f wait on it.

- **18a** — the physics: `--motion-quick` / `--motion-base` / `--motion-unfold` as theme tokens,
  `motionMs()` for the copied timers, the press on every tappable primitive, principle 5's ladder
  and event table. **Shipped 2026-09-07.** Ten hand-copied timers now name a rung, every animation
  utility runs off one, and `motion-tokens.test.ts` reads the stylesheet to prove CSS and JS state
  the same three numbers. The press has two spellings rather than one: a discrete control scales
  (`.pressable`), a full-bleed row tints (`.pressable-row`), because three percent of a phone's
  width is six pixels of travel on each edge and a row that scales reads as the page flinching.
  The spring on the release ships as H-69 a recommends, and is one token in two rules if declined.
- **18b** — a figure rolls: `RollingFigure` on the counter's instrument line and settled count and
  on the held send's seconds; the never-list held by a test over the roll call's and the manifest's
  trees. **Shipped 2026-09-07.** A figure whose *sentence* changed swaps rather than rolls, which
  the boards did not draw: rolling digits inside a line that rewrote itself claims a continuity
  that is not there. The station chip, the palette count and the gear price are the same one-line
  wiring and go with the surfaces that own them.
- **18c** — a row closes its own gap: `SettledRows` on the counter's working queue and its settled
  group, with Undo running the same path reversed. **Shipped 2026-09-07.** Rows are tracked by DOM
  identity rather than by a key attribute, so a list opts in by wrapping and nothing labels its
  children. The home's station, the wait list and the board's day are the same wrapper and follow;
  the manifest roster waits on H-69 c.
- **18d** — the sheet follows the thumb: `useDragSheet`, on the dock's More sheet, with the grab
  handle. **Shipped 2026-09-07.** The release decision is a pure function (`dismissOnRelease`)
  because a hand's *speed* is the one input a DOM test cannot express, and a velocity guard stops a
  release that lands in the same millisecond as the last move from reading as a flick. The embed
  lightbox is the same hook and follows.
- **18e** — the title folds into the bar on a phone. **Shipped 2026-09-07** (issue #1422). The bar
  and the title live in two trees, so the page delivers its title into an `aria-hidden` slot
  `ShopNav` renders (`FoldedPageTitle`, a portal) — the smaller of the two answers, and the one that
  leaves the layout's shape alone. Three facts hold it together, and each was a way to get it wrong:
  the slot exists only in the staff shell, so `PublicShopChrome` has no target and the storefront
  cannot fold; the gate is `:has([data-chrome-title-slot]:not(:empty))`, so a page carrying its own
  header (the four departure surfaces) does not fade its shop name away and leave a bar holding
  nothing; and the reduced-motion stop has to name `animation-timeline`, because the global
  kill-switch overrides only durations and a scroll progress timeline takes no progress from time.
  The page's `<h1>` fades from 40px on — the bar is 85% of the page behind a blur, so without it a
  34px heading ghosts through the chrome under the folded label and the word is on screen twice.
- **18f** — the departure on the lock screen: Add to Wallet on the thread, the pass in the shop's
  brand, updates from `trips.revision` and the crew-set stage, the PassKit web service under
  `/api/wallet/v1/**`, the Google object, a ten-minute push cron. **H-69 b decided yes 2026-09-07**:
  built now, shipped dark — with no credential configured the thread renders as today and every
  pass route 404s — so the slice merges ahead of the Apple Developer and Google Wallet accounts,
  which are manual steps in §17's registry rather than blockers. One new dependency,
  `passkit-generator`. The contract is the canvas's
  [SPEC.md](../../design/canvases/20260907-nothing-from-nowhere/SPEC.md); the implementing prompt is
  in the canvas README.

### 19. In your hands (design complete; H-70 decided)

The second look at the 2026-09-07 brief, argued on
[the canvas](../../design/canvases/20260907-in-your-hands/README.md) and proposed in ADR
[20260907-in-your-hands](../../architecture/decisions/20260907-in-your-hands.md). Section 18 answered
the half about animation; this one answers features, read against what Apple's features are — the
device using a fact it already holds — and finds five gaps: the door asks for a password on a phone
that knows its owner's face, a diver at the counter with no waiver is sent a link or handed paper,
a certification card is photographed and then typed, the type ignores the phone's own text setting,
and the app can be installed and never says so. The ADR states one rule (the device already knows
it; what it supplied says where it came from; the last tap is a person's; the safety floor is
untouched) and applies it in five moves, every one rendering the page as it ships when it is not
true. The owner ruled on 2026-09-07 (H-70): passkeys and the step-up yes, the release signed on the
shop's device yes, the card reader declined — and the reader's premise was wrong, since a card has
carried no photograph since ADR 20260811-retire-the-digital-card, so 19c is dropped in full and
nothing on the certification form changes. Each slice runs the `design-implementation` skill: the
component names the ADR, a test pins the rule, the canvas README's slice table moves, and the visual
diffs are explained. All four remaining slices may start.

- **19a** — the door knows your face: Better Auth's passkey plugin and its table (schema-change
  skill), the passkey frame on `/sign-in` with the password as a link, the Passkeys panel in
  Settings → Security (add this device, named per device, remove), the origin-binding test, the
  security review. The step-up half waits on H-70 a.
- **19b** — hand it over: *Sign here* as the primary on the counter's and the roster's blocked row
  where the fix is the release, the session lock (`handed_over_at`) read by `requireShopSurface` and
  pinned by a test that every `/shop` read refuses while it is set, the hand-over and who-sees-what
  lines on the waiver page, the counter provenance on the signature row, the settled row's one line
  on the counter. `dive-domain-expert` and security review. Waits on H-70 b.
- **19c** — *dropped 2026-09-07* (H-70 c declined). The card reader is not built, no photo capture
  is added, and the certification form ships as it is: a card carries no photograph (ADR
  20260811-retire-the-digital-card).
- **19d** — the type follows the phone: the `-apple-system-body` probe in the pre-hydration script
  that sets `lang` and `dir`, upward only from the app's 16px root, one visual capture of the
  manifest at the largest root.
- **19e** — on the home screen: one row under `DaySpine` on a phone or tablet in a browser tab for a
  staffer whose role reaches the manifest, the platform's install prompt or its own menu item with the
  share glyph, a device-kept dismissal, a test that it renders nothing when installed or on a desktop.

### 20. One hand (design complete; H-71 pending)

The 2026-09-08 loop over why the app feels like four products, argued on
[the canvas](../../design/canvases/20260908-one-hand/README.md) and proposed in ADR
[20260908-one-hand](../../architecture/decisions/20260908-one-hand.md). Read from the running app with
the whole tree counted, the design system is good and mostly adopted, and the seams are in the six
things no checker sees — a page's width, what the eyebrow says, how a group carries its count, what a
row is, how a thing is added, how a state is drawn — each with between five and twenty-seven spellings
after five design passes in twelve days that added vocabularies without deleting the last; the voice
has the same shape of problem across 7,390 strings. The ADR states a floor (six jobs, one spelling
each, held by guards; a voice sheet) that every direction shares, and draws four directions on the same
two surfaces: A finishes Reef by subtraction, B is a paper logbook, C a dive computer, D the voice as
the system. The pick is the owner's (H-71). Each slice runs the `design-implementation` skill: the
component names the ADR, a test pins the rule, the canvas README's slice table moves, and the visual
diffs are explained. 20a–20e may start on the ADR alone.

- **20a** — one width, one header: the `<main>` width guard over `src/app/shop/**`; `ShopPageHeader`
  takes the destination group from `src/lib/staff-destinations.ts` instead of an eyebrow string; the
  title as the tab's word (the title half waits on H-71 b).
- **20b** — one row: `LedgerRow` on the five densest hand-rolled lists (`WaitlistSection`,
  `CrewSection`, `PersonBuddyList`, `CrewRollCall`, `TripInvitationSection`), `person/rows.tsx`
  rendering it, the group's count as right-aligned meta, the add row as the last row of every list,
  and a guard on `divide-y` outside `src/components/ui/`.
- **20c** — one state: `Badge` loses its neutral tone, Gear's all-clear becomes the check-and-sentence
  line, the counter's meter turns lagoon and `ProgressBar` is the one bar, one row joins Reef's coral
  table (never a wash behind reading text, never a meter), and the two bugs — `bg-card` on the
  dive-sites empty state, the rental-fit glow's hard-coded rgba.
- **20d** — one link, one skeleton, one disclosure: `button.test.ts` refuses the raw link string and
  the 104 sites move to the link variant; `src/components/ui/skeleton.tsx` and the twenty
  shell-less `loading.tsx`; the 27-spelling `<summary>` sweep onto `ui/disclosure.tsx`;
  `ActionResultNotice` folds into `FormStatus`.
- **20e** — the voice sheet written into brand.md, `check:voice` grown to its mechanical half, and the
  bundle sweep in both locales: one actor, one spelling, one separator, one word for fine and one for
  not, one sentence per event, descriptions under 120 characters or deleted, no arrows, exclamation
  marks or emoji.
- **20f** — the earned moment inside `EntryDone`, once, for the twelve shared terminal outcomes.
  Waits on H-71 c.
- **20g** — the levers on A: F (the tide line), H (their sea) and K (together) as composed on the
  canvas's second page and drawn on every surface on its third; E is answered by 20l and I stays on
  the canvas as the phone-first alternative. B, C and D were declined on 2026-09-09. Waits on H-71 a.

Round 3 (2026-09-09, after the owner's read of round 2 — "keep pushing these concepts farther,
keep cleaning up, design every surface") adds the kit that composes A with F, H and K, redraws all
eighty-one page routes on it across fifteen boards that each name their deletions, and eight more
levers, L–S. The ADR's decision 5 records it; the owner's calls are H-71 (a) and (e)–(h).

- **20h** — L, the trip's own line: drawn once and shown on the staff trip page, the diver's trip
  page and thread, the lobby board and the reminder email; moves on the crew's stage taps, says
  "as of" when stale. Waits on 20g's F and H-71 h.
- **20i** — M, the pass: booking confirmed becomes a pass in the shop's colour with the site's
  photo, the boat, the slip, the time, what to bring and a code carrying the booking id only; the
  counter scans it with the device's camera; the diver's screen says "You're aboard" as the desk's
  row settles. Composes 18f. Waits on H-71 e and f.
- **20j** — O, the log: the close-out writes the day's entry from a sentence DiveDay proposes;
  Reports keeps its title and becomes the log with the season as a strip of days and the month's
  figures from the entries. Waits on H-71 g.
- **20k** — N, the postcard: the recap printed from the crew's log, front and back, the review as
  one line, "next time" with a reason; the recap email carries the front. Waits on 20h.
- **20l** — P the six room drawings in the empty states and on the lobby board; R the shop's card as
  the settings index's pane with the live brand preview; S first light on a new shop's first Today;
  Q's two new answers (a unit, a day's line) in the palette.
- **20m** — the surface sweep: each round-3 board's "Deleted here" list applied to its family of
  pages, one family per session, with the visual diffs explained in the PR. Waits on 20a–20e.

Round 4 (2026-09-10, after the owner's read of round 3 — "evaluate the entire app from many
different angles; show me a few interesting possibilities; elegant; wow in marketing and in-app")
reads the app by twelve angles instead of by surface and draws seven possibilities, T–Z, on the
kit, each with a marketing frame that is a screenshot of its in-app frame. The ADR's decision 6
records it; the owner's calls are H-71 (i)–(o). **Shipped 2026-09-10** on the owner's read of
round 4 (all seven at once) as one stack of seven pull requests, merged bottom first the same day —
20n #1626, 20o #1627, 20p #1629, 20t #1630, 20s #1631, 20r #1633, 20q #1634 — each built on the
recommendation recorded beside its call. What each landed in is the canvas README's slice table.

- **20n** — U, follow the boat: the pass's "Share with whoever is waiting for you", a public route
  per boat per day carrying the trip's line with the crew's stage word and its time only, the
  storefront's Right now with a line per boat, a Settings switch off by default. Waits on 20h and
  H-71 j.
- **20o** — Y, try it with your boats: the homepage's hero takes the shop, a boat and a departure
  and redraws as the visitor's first Today in a colour derived from their name; the onboard door
  already filled; the storefront in miniature and the four pictures beneath. Waits on 20l's S.
- **20p** — T, the shop's year: the year page over the log, the year card in the shop's face (no
  money), the homepage's proof band for shops that said yes. Waits on 20j and H-71 k.
- **20q** — W, give a dive: "Book for someone else" on the trip page, the gift pass with the giver's
  line and a claim link, the giver's read-only thread, the blow-out refund to the giver, the counted
  buddy seat on the postcard's back. Waits on 20i, 20k and H-71 l.
- **20r** — V, the living reef: Seen on the crew's dive log from the shop's species list, the site
  page's "Seen here this month" dated, the storefront's site-card sentence, sunrise, sunset and the
  moon as ticks on the tide line. Waits on 20k and H-71 n.
- **20s** — X, the shop on paper: Settings › Print with the dock sign, the boat card by day and by
  night, the window sticker, the paper pass, the site briefing card and the year poster; the print
  sheet as a kit specimen. Waits on 20i and H-71 o.
- **20t** — Z, the diver's shelf: a diver-at-shop token scope, the shelf page, the storefront's
  greeting for a known phone, the sizes write, "Forget this phone", the row on the diver record.
  Waits on 20i, 20k and H-71 m.

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
- Retrying a `stripe_invoice_snapshot` or `stripe_checkout_session_snapshot` erasure obligation, if
  Stripe ever exposes an API that clears the identity snapshot a finalized invoice or a Checkout
  Session holds —
  [20260803-processor-erasure-obligations](../../architecture/decisions/20260803-processor-erasure-obligations.md).
- A free-text companion field for `certification_agency`'s `other` value. CMAS, RAID, GUE and BSAC
  now have their own enum values (2026-08-06), but a diver holding an IANTD, SEI, ANDI, ACUC, PSAI or
  NASE card still records as bare "Other agency" with nowhere to write which one — confirm the list
  with a `dive-domain-expert` review before widening a safety-adjacent enum further, or add the
  free-text companion instead of another enum value. Carried out of the archived
  [2026-08-02 review](../archive/comprehensive-review-20260802.md), DOM-L1.

## Deferred from the 2026-09-07 idea review

The thirty-five ideas the owner marked **After pilot** in
[../assessments/improvement-ideas-20260907.md](../assessments/improvement-ideas-20260907.md)'s
decision register, carried here so each one survives without the report. *After pilot* is a
deferral, not a rejection — the five the owner refused (N-05, N-27, N-28, N-34, N-58) stay in the
register and are deliberately **not** repeated here. **Nothing in this section is sequenced**: an
item leaves it by earning a numbered slot above and whatever ADR, domain review or human decision
its line names.

Effort letters and review needs are the report's own estimates, made against the tree as it stood
on 2026-09-07 — re-verify before planning from any of them, and check
[../shipped.md](../shipped.md) first, since the twenty-two *Build now* siblings that landed
alongside them moved several of these prerequisites.

### The worst day, and the boat as a machine

- **N-07 Missing-diver mode.** One act on the manifest, "Diver unaccounted", starts an elapsed
  timer, captures last seen (time, site, depth, buddy), lays the shop's own EAP prose and emergency
  lines under it, and records each step the crew taps (called shore, called Coast Guard, searching,
  found) as append-only events with a time. Ends in "Found" or "Handed to authorities". Nothing
  here gates; the roll-call sentence from ADR 20260828 is where it starts. *Build:*
  `missing_diver_events` table, `src/lib/missing-diver.ts`, a boat-mode surface under the manifest
  and the offline copy; the incident export gains the trail. *Effort:* L. *Needs:* domain,
  security, ADR.
- **N-08 Safety kit as register units.** O2 kit, AED, first-aid kit and flares become `gear_items`
  kinds with the service clocks the register already has (O2 cylinder hydro, AED pad and battery
  expiry, kit inspection), so the pre-departure check can say "AED pads expire in 12 days" beside
  the shop's own safety line. Opt-in by presence, like the rest of the register. *Build:* new
  `gear_item_kind` values + service-event kinds, one line in `pre-departure-check.ts`. *Effort:* M.
  *Needs:* domain.
- **N-09 Drill log.** A shop records an emergency drill (missing diver, O2 administration,
  man-overboard) as a dated event with who took part. Renders on Reports and feeds N-46. *Build:*
  `shop_drills` table, one Settings inset. *Effort:* S.
- **N-10 Boat clocks.** Engine hours and fuel per departure (the crew enters both at *Home*), Coast
  Guard inspection, registration and hull-insurance dates, and the safety-equipment expiries that
  belong to the vessel rather than a kit. Renders as one "Boat" panel with the register's
  service-clock sentences. Never touches capacity authority — the proposed boat-resource ADR owns
  that. *Build:* `boat_log_entries` + `boat_clocks`, a stage-event hook, one page under Settings or
  the gear shelf. *Effort:* M.

### Regulators and paper

- **N-12 Float plan filed on Underway.** When the crew taps *Underway*, DiveDay sends the shop's
  shore contact a float plan (vessel, souls aboard by name, sites, planned return, captain), and
  sends "All home, 14 souls" on *Home*. Both ride `trip_stage_events` and the emergency reference's
  `shoreContact`; the message is the manifest facts and nothing else. *Build:* a `float_plan`
  notification kind, a stage-event listener, one Settings switch. *Effort:* M. *Needs:* domain,
  security (a manifest leaves the tenant).
- **N-13 Captain's hours.** Sum of a captain's assigned departure durations per day and rolling
  week against a shop-set ceiling (many small passenger vessels run a 12-hour rule). One line on
  the staffing week when it is exceeded; informs only, like credential clocks (H-59). *Build:*
  `src/lib/crew-hours.ts` over `tripAssignments`, one line in `staffing-week.ts`. *Effort:* S.
  *Needs:* domain.
- **N-14 Manifest retention as a declared window.** Passenger records carry a legal retention
  expectation; `RETENTION_DAYS` should name the manifest's window explicitly and the export should
  say it. *Effort:* S. *Needs:* owner (H-02).

### Money beyond the ticket

- **N-11 Break-even on the board.** A shop states fuel, crew day-rate and mooring or park fees per
  departure; the week cell says "6 seats to break even" and Reports adds a margin line per month.
  Display arithmetic only, never accounting. *Build:* `shops.departure_cost_defaults` jsonb +
  `trips.cost_override`, `src/lib/break-even.ts`, one figure on the cell and Reports. *Effort:* M.
  *Needs:* owner call on money appearing on the board.
- **N-15 Chargeback evidence pack.** On `charge.dispute.created`, assemble the booking's evidence
  (the policy shown at checkout, the waiver signature time, check-in, the roll-call *aboard* event,
  the recap opened) into one PDF and a pre-filled Stripe dispute submission; Today shows "Dispute ·
  respond by Friday". *Build:* webhook branch, `src/lib/payments/dispute-evidence.ts`, a Today row,
  an owner-only download. *Effort:* M. *Needs:* security.
- **N-16 Seat transfer.** A paid diver hands their seat to a named friend from the thread: the
  friend gets a claim link, waiver-on-join, and is gated on their own evidence; the money stays
  with the payer, and the original booking becomes `transferred` with a trail. *Build:* extends
  `seat-claims.ts` with a transfer origin, one thread action, a `booking_transfers` trail.
  *Effort:* M. *Needs:* domain, security.
- **N-17 Damage deposit hold on rentals.** An optional manual-capture Stripe hold on the rental
  line, released at gear return or captured with a reason. *Effort:* M. *Needs:* owner policy
  (H-07).
- **N-18 Cash and tip reconciliation at close-out.** The evening block counts cash taken at the
  counter and card tips for the day and records "matches" or "short by 20" as an act in
  `day_closeouts`. *Build:* one closeout fact + one input. *Effort:* S.
- **N-19 Pay your own share.** Each claimant on a party booking pays their own seat at claim time
  through Checkout; the organizer pays only their own. No credit ledger needed. *Build:*
  `seat-claims.ts` + `checkouts.ts`, a per-seat `bookingPayments` row. *Effort:* M. *Needs:* owner
  (H-07, H-61).

### The lobby, sound, and hands-free capture

- **N-25 Lost and found.** "Left aboard" on a departure with a photo and a claimant; the diver's
  thread says "We have your mask." *Build:* `lost_items` + one thread line. *Effort:* S.
- **N-26 A rationed sound layer.** Opt-in per device beside boat mode, three sounds and no more:
  the roll-call tick, the refusal, the head count reaching the brim. Unlocked by the first tap (the
  iOS WebAudio rule), off under any silent switch it can detect, never the only carrier of a state.
  *Build:* `src/components/sound.ts` beside `haptics.ts`, three short synthesized tones, no asset.
  *Effort:* S. *Needs:* a design ADR amendment (principles §2).
- **N-29 Scan then discard for cards.** [ai-ml.md](ai-ml.md)'s cert-card OCR idea, re-shaped after
  ADR 20260804 removed the stored photo: a capture that proposes agency, level and number and keeps
  nothing. *Effort:* M. *Needs:* domain, and an ADR for the first LLM dependency — the owner
  refused N-28 (voice to conditions), which was the other candidate to carry that ADR, so this item
  now has to justify it alone.

### Courses, groups and the traveller

- **N-30 Skills ledger.** Per enrollment, the course template's standard skill list (mask clearing,
  CESA, buoyancy…) signed off one tap at a time by the instructor; the student's thread shows
  progress; nothing issues a card. *Build:* `course_skill_templates` + `enrollment_skills`, a
  roster inset, one thread step. *Effort:* M. *Needs:* domain, H-08.
- **N-31 Referral handoff.** A student who finishes knowledge and confined water here and does open
  water elsewhere gets a referral document generated from N-30's ledger, in the agency's field
  layout; an incoming referral is a course inquiry with the paperwork attached. *Effort:* M.
  *Needs:* domain, H-08.
- **N-32 The organizer's ledger.** The organizer's link shows every seat's state (claimed, signed,
  paid, ready) with one nudge per person and a group deadline; a group hold ("8 seats until
  Friday") releases itself when the deadline passes. *Build:* `booking_holds` with expiry, a cron
  sweep beside minimum-seats, an organizer view on `/claim`. *Effort:* M. *Needs:* owner (H-61),
  security.
- **N-33 The club's Thursday.** A recurring series with a standing organizer and a hold each
  occurrence, for the dive club that takes the same boat monthly. *Effort:* S after N-32.
- **N-35 The diver's passport.** A diver-held record (which shop verified which card and when, a
  waiver on file, fit sizes) presented by consent at another DiveDay shop through a link; the
  receiving shop sees "verified by Blue Mantis, 2026-08-12" and decides for itself. No profile
  page, no feed, so the non-goal on social networks holds. *Effort:* L. *Needs:* ADR, security,
  owner (H-26).

### Languages

- **N-36 pt-BR as the third diver locale.** Drafted by the translation script
  [ai-ml.md](ai-ml.md) scopes, reviewed by a human, with the same terminology README `es-ES` has.
  *Effort:* M. *Needs:* owner (whether Brazil is a target market).
- **N-37 The briefing in the reader's language.** Shop prose is the shop's own words and is never
  rewritten; the diver's page may offer a machine rendering labelled as such below the original.
  *Effort:* M. *Needs:* ADR (translation provider), owner (whether a shop's words may be machine-
  rendered at all).

### Minors, families and adaptive diving

- **N-39 Junior ceilings at booking.** Where the stated card is a junior rating, the departure page
  says which dive exceeds its depth before the seat is sold, using `depth-ceiling.ts`. *Effort:* S.
  *Needs:* domain. (N-38, guardian co-signature, shipped — this is its sibling.)
- **N-40 Adaptive-diving readiness.** Adaptive programs (HSA, DDI) set buddy counts by level; the
  ratio math reads the support-need record, the staffing week says "adaptive-trained crew aboard"
  from a new credential kind, and the departure page can state "adaptive-capable" when the shop
  says so. *Effort:* M. *Needs:* domain, owner (scope).

### The crew

- **N-41 Crew skills matrix on the staffing week.** A shop states which credential kinds a
  departure needs (oxygen provider, captain, instructor for a course session); the week says "No
  oxygen provider on the 1 pm boat" from `staffCredentials`. Informs, per H-59. *Build:*
  `shops.departure_crew_requirements`, `src/lib/crew-coverage.ts`, one gap line. *Effort:* S.
- **N-42 First shift.** A new staff account's first sessions get one sentence per surface from the
  same registry the palette's answer card reads, dismissed forever after the third visit; first
  light did this for the shop, this does it for the person. *Effort:* M. *Needs:* a copy-restraint
  pass — this is the shape of feature that grows into a tour nobody wants.
- **N-44 The season letter.** At the shop-set season end, an owner-facing page: dive days run,
  divers, first-timers who returned, most-run site, blow-outs, no-show rate, exported as a PDF or
  image. Never a send to divers. *Build:* `src/lib/season-letter.ts` over Reports' readers.
  *Effort:* M.

### Trust as evidence

- **N-46 Insurer renewal pack.** Owner-only PDF from real data: roll-call completion,
  pre-departure check completion, drills logged (N-09), credential coverage, waiver-before-arrival
  rate, incidents, with the period stated. Builds on `incident-export.ts`. Claims policy: a
  document for a renewal conversation, never a marketing claim. *Effort:* M. *Needs:* security.
- **N-47 The public safety record.** The brainstorm's page, made concrete as the opt-in public half
  of N-46 at `/s/<slug>/safety`, honest numbers only. *Effort:* S after N-46. *Needs:* owner.

### Software talking to software

- **N-51 A shop's MCP server.** A token-scoped Model Context Protocol endpoint over the export
  schema, read-only first, so an owner's own assistant answers "who is not ready for Saturday's
  wreck boat" from DiveDay's facts. This is [ai-ml.md](ai-ml.md)'s ops assistant with no chat UI to
  build, and the read API's first customer. *Build:* `src/app/api/mcp/`, scoped `api_tokens`, tools
  named after the export tables. *Effort:* M read-only. *Needs:* ADR, security.

### The founder's cockpit

- **N-56 The north star from real data.** "Dive days run end-to-end per week" computed as
  [../rollout.md](../rollout.md) defines it, per shop, with the activation timeline (signup, first
  trip, first booking, first waiver, first roll call), in a founder-only page and a Monday email to
  the alert mailbox. *Build:* `src/lib/north-star.ts`, a platform reader, one cron. *Effort:* M.
  *Needs:* security (a cross-tenant reader is its own risk class).
- **N-57 What's new.** An in-app page and a monthly note derived from
  [../shipped.md](../shipped.md), so a shop learns what changed under it. *Effort:* S. *Needs:* i18n for the frame; the notes land
  in both locales.
- **N-59 Self-serve billing.** Stripe Billing for the $99: trial to subscription, invoices,
  cancel-with-export. *Effort:* M. *Needs:* owner (H-12's open half).

### The reef itself

- **N-62 Sightings to science.** Opt-in per shop, observed-species logs export in REEF survey and
  iNaturalist CSV shapes; the storefront's conservation panel then has a real fact ("your divers
  logged 40 turtle sightings this season"), which is what D39 (#1199) waits on. *Effort:* S–M.

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
