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
  section below (one of the three has since shipped; two remain).
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
  the API half remains). The Proposed
  [20260815-outbound-integration-webhooks-and-zapier](../../architecture/decisions/20260815-outbound-integration-webhooks-and-zapier.md)
  already sketches the `gear_item.*` events. **One-directional by design** — DiveDay emits, it never
  consumes another system's API; a direct competitor (DiveShop360) has no reason to build the
  receiving end itself, so the intended shape is DiveDay's webhooks feeding a no-code bridge (a
  published Zapier/Make integration) a shop or its own tooling wires to whatever it already runs
  (Shopify, QuickBooks, ...) — not a bespoke DiveDay-built connector per target system.

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
| **The home becomes the shop's day** | Today absorbs counter Check-in (provably the by-departure view filtered oppositely — both read `operational-window.ts`) and Close-out (already "Today's evening mirror" by its own docstring); the home leads with the phase the clock is in, with a visible way to any phase | Do it, in two slices: Close-out-as-evening-view first (M), the Check-in fold second (L) | Route 308s, `?view=` contract, large e2e/visual churn |
| **Check-in = boarding's first rung** | `bookings.status = checked_in` and the manifest's "boarded" are two staff-recorded arrival facts that can disagree; make arrival a two-rung state (arrived → aboard) on the departure's first checkpoint | Do it *with* the Check-in fold above, not before — it is the data half of the same merge | Schema migration, counter surface, Today rows, reports |
| **One "your trip" link per diver** | Promote `/ready/[token]` to the single capability page (waiver step, prep, recap as states over time); retire the trip page's `?booking=` confirmation branch and the second booking-time email | Do it; the strongest diver-facing simplification found | Checkout return URLs, email templates, capability-purpose mapping, recap-token reconciliation for the post-trip state |
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
§3. **One of the three shipped (2026-08-02); the other two remain deliberately not built**:
the product owner ruled out touching the success/warning and placeholder color values, because it
would fight the current color guide. Pick those two up once that guide decision is made, not
before — re-verify the computed ratios against `globals.css` first, since token values may have
drifted. `e2e/a11y.spec.ts`'s axe scan **still excludes** the `color-contrast` rule, and stays that
way until both remaining items land: the rule fires app-wide on exactly these token values, so
turning it on now would just paint CI red. Re-include it once this section is cleared.

Until then, nothing in the repo may claim WCAG AA conformance — see
[design/principles.md](../../design/principles.md#tokens-the-mechanics) for the wording that is
actually true, and keep any new claim in sync with this section.

The focus-indicator item that used to head this section **shipped on 2026-08-02** and has moved to
[../shipped.md](../shipped.md) with its measured before/after ratios; `--focus-ring` now clears
WCAG 1.4.11's 3:1 in all six light/dark palettes. The two items below are what remains.

### Raise tinted status-banner text above 4.5:1

- **Priority**: medium
- **Effort**: S
- **Prompt**: Light-mode success and warning text on their 10% tinted fills fails AA for the small text sizes used: `--success` #15803d on `bg-success/10` over white computes to 4.38:1 and `--warning` #b45309 on `bg-warning/10` to 4.39:1. Concrete instances: the waiver "progress saved" banner (`text-sm font-medium text-success` on `bg-success/10`, `src/app/waivers/[token]/page.tsx`), the payment-received panel (`text-success` on `bg-success/10`, `src/app/shop/[shopSlug]/schedule/[id]/_components/BookingConfirmation.tsx`), and warning-tinted notices/`ShopNotice tone="warning"` surfaces. Fix at the token level in `src/app/globals.css`: darken light-mode `--success` to ~#166534 and `--warning` to ~#92400e (the values boat-mode already uses), then re-verify every existing light-mode use of `text-success`/`text-warning` on `bg-surface`, `bg-background`, and the /10 tints clears 4.5:1. Dark mode already passes (7.5–8:1) — do not touch it.
- **Verification**: Node contrast script over the new hex values against `#ffffff`, `#faf9f6`, `#f1efe9`, and each color mixed at 10% over white, all ≥4.5:1; `pnpm visual` and review the diffs (an intentional token darkening, explained in the PR per the visual-triage skill); light/dark screenshots of the waiver saved banner and booking payment panel.

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
