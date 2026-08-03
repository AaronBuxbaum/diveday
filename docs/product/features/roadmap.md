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

The next arc is **not new pillars.** It is finishing the data-portability wedge, closing the
production-readiness gaps, and answering the buyer objection that still loses deals (no gear
register). Breadth is done; depth and proof are the work.

## Open work, in priority order

### 1. Data-portability follow-ons (the wedge)

Export, the diver/customer CSV importer, and the public migration guides have shipped (see
[../shipped.md](../shipped.md)); the rest of the "switching is safe" story is greenfield. Sequenced
in [competitive-strategy.md](../assessments/competitive-strategy.md#the-build-plan-in-order).

- **Scheduled backup export** to shop-owned storage (weekly bundle; `.ics` trip feeds ride along).
- **Read API + webhooks**, every tier — token-scoped reads over the export schema plus
  booking/waiver/manifest events. **ADR required** before building.

### 2. Third-party e-signature adapter (M3 follow-up)

The waiver signature is still in-house typed consent (`src/lib/signatures.ts` — local and in-person
providers only). A vendor adapter behind the existing `SignatureProvider` seam is follow-up work,
gated on the H-01/H-03 legal decisions
([waiver-signature-retention](../../architecture/decisions/20260718-waiver-signature-retention.md)).

### 3. Minimal gear register (an M5 reversal, deliberately smaller)

M5 removed equipment inventory on purpose, but "who has what, what's due for service" is table stakes
for gear-heavy shops and a disqualifier for the classic retail shop
([competitive-analysis.md](../assessments/competitive-analysis.md#what-blocks-the-purchase) #3). The re-entry is a
lightweight who-has-what + service-due register — **not** a POS, and **not** the deleted assignment
model. **ADR required** (it reverses a shipped decision).

### 4. Nitrox fill / analysis log (open question)

The analyzed-fill log was retired with gear inventory (it referenced a tracked cylinder). Whether a
fill/analysis record should return in some tank-free form is genuinely open, gated on the nitrox
policy decision — V-05 and H-11 in [../human-decisions.md](../human-decisions.md).

### 5. Multi-boat / multi-shop configuration

Multi-shop tenancy exists (`shop_id` everywhere); there is **no boat entity** — a trip is the
boat-day. Per-boat configuration and multi-location operating views are unbuilt, and their
provider/policy decisions are open. Deliberately deferred until a real operator needs it. The
private/buyout charter workflow below blocks on this same modeling — design the two together, not
separately.

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
  [§5 above](#5-multi-boat--multi-shop-configuration) already holds open, and should be designed
  together with it rather than as a separate effort. **ADR required.**

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
   surfaces and a first empty state are captured; systematic coverage of the rest is not.
4. **A real-Postgres CI job.** Everything runs on PGlite today, which cannot exhibit the races the
   schema is designed against: the `FOR UPDATE` oversell guard in `src/db/bookings.ts` is dead code
   under test, and committed `drizzle/` migrations first meet a real server during the production
   deploy. A service-container job should apply the migrations from empty *and* from the previous
   release's schema, then run the booking/payments/payment-operations suites with genuinely
   concurrent connections — two transactions racing for the last seat, asserting exactly one wins.
   Nightly or gated on `src/db/**`; the spend choice is HD-19 in the
   [2026-08-02 review](../assessments/comprehensive-review-20260802.md#human-decision-register).
   Carried out of that review (TEST-2 / DATA-L1 / OPS-2) as the highest-value enablement item open.

### P2 — when parallelism or scale proves the need

1. Shard feature/entity docs and generate optional aggregates rather than maintaining a
   merge-conflict-prone central catalog. Split only after collisions prove the need.
2. Serialize migration finalization if concurrent schema PRs collide repeatedly.
3. Add a machine-readable task manifest for external orchestrators — a structured list of safe
   paths, invariants, and validation commands, generated from the same data `pnpm task:context`
   reads.
4. Add automated PR scope/collision warnings based on changed paths and declared ownership.
5. **Make the remaining prose invariants executable.** Carried out of the
   [2026-08-02 review](../assessments/comprehensive-review-20260802.md#2-architecture--code-quality)'s
   recurring theme that only ratcheted rules hold: fix `check-architecture.mjs`'s side-effect-import
   blind spot and add `src/i18n`/`src/components` to its forbidden table (ARCH-2); a
   `scripts/check-tokens.mjs` failing raw hex and palette-scale classes so ADR-0004 ratchets like
   copy and clock (I18N-4); a static walk from each `useTranslations()` call site to a
   `DiverIntlProvider` declaring that namespace, turning both documented silent failure modes into a
   gate (I18N-2); and a scheduled check watching Next 16.3 GA, drizzle 1.0 stable and next-auth v5
   stable, which the ADRs commit to migrating to promptly with nothing tracking them (ARCH-4, HD-20).

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
