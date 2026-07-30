# Roadmap

What is **not** built yet, and the order to build it. Sequencing guidance, not a contract; each item
ships a usable vertical slice. Re-order only with a note here explaining why.

- What already shipped is indexed in [shipped.md](shipped.md) — check there before assuming a gap.
- Human-owned approvals, provisional defaults, and validation gates are in
  [human-decisions.md](human-decisions.md); the deep buyer/rival analysis is in
  [competitive-analysis.md](assessments/competitive-analysis.md) and
  [competitive-strategy.md](assessments/competitive-strategy.md).
- When an item here ships, **move it to [shipped.md](shipped.md)** (compress to a line, link its ADR)
  rather than leaving it marked done — that pollution is what this file exists to avoid.
- This tracks the substantial open work; small per-feature follow-ons may also live in the ADR that
  introduced the feature (grep the ADR's *Consequences* for "follow-up").

## Where we are

Milestones M0–M7 are built: the five pillars (bookings, waivers, cert checks, rental-fit prep, boat
manifests), Stripe Connect payments with checkout-at-booking and deposits, multi-channel
notifications with scheduled reminders, the Today work queue, owner reporting, and full-shop export
— plus the UX arc that made those surfaces *act* (one-tap sends, transactional `/ready`, command
palette). See [shipped.md](shipped.md).

The next arc is **not new pillars.** It is finishing the data-portability wedge, closing the
production-readiness gaps, and answering the buyer objection that still loses deals (no gear
register — owner reporting shipped 2026-07-23). Breadth is done; depth and proof are the work.

## Open work, in priority order

### 1. Data-portability follow-ons (the wedge)

Export, the diver/customer CSV importer, and the public migration guides have shipped (see
[shipped.md](shipped.md)); the rest of the "switching is safe" story is greenfield. Sequenced in
[competitive-strategy.md](assessments/competitive-strategy.md#the-build-plan-in-order).

- **Scheduled backup export** to shop-owned storage (weekly bundle; `.ics` trip feeds ride along).
- **Read API + webhooks**, every tier — token-scoped reads over the export schema plus
  booking/waiver/manifest events. **ADR required** before building.

### 2. Third-party e-signature adapter (M3 follow-up)

The waiver signature is still in-house typed consent (`src/lib/signatures.ts` — local + in-person
providers only). A vendor adapter behind the existing `SignatureProvider` seam is follow-up work,
gated on the H-01/H-03 legal decisions
([waiver-signature-retention](../architecture/decisions/20260718-waiver-signature-retention.md)).

### 3. Minimal gear register (an M5 reversal, deliberately smaller)

M5 removed equipment inventory on purpose, but "who has what, what's due for service" is table stakes
for gear-heavy shops and a disqualifier for the classic retail shop
([competitive-analysis.md](assessments/competitive-analysis.md#what-blocks-the-purchase) #3). The re-entry is a
lightweight who-has-what + service-due register — **not** a POS, and **not** the deleted assignment
model. **ADR required** (it reverses a shipped decision).

### 4. Nitrox fill / analysis log (open question)

The analyzed-fill log was retired with gear inventory (it referenced a tracked cylinder). Whether a
fill/analysis record should return in some tank-free form is genuinely open, gated on the nitrox
policy decision — V-05 and H-11 in [human-decisions.md](human-decisions.md).

### 5. Multi-boat / multi-shop configuration

Multi-shop tenancy exists (`shop_id` everywhere); there is **no boat entity** — a trip is the
boat-day. Per-boat configuration and multi-location operating views are unbuilt, and their
provider/policy decisions are open. Deliberately deferred until a real operator needs it.

### 6. Staff-surface copy extraction (finishing localization)

Locale-correct *formatting* is app-wide and done; translated *copy* currently covers only the
diver-facing surface (see
[diver-copy-localization](../architecture/decisions/20260729-diver-copy-localization.md)). Staff
screens under `/shop/**` still carry inline English — roughly 16,000 lines of TSX across ~89 route
files and ~52 components. Extracting them into `src/i18n/locales/<locale>/diver.json` (or a second
`staff` namespace) is mechanical but large, and is what "the whole app is localized" actually
requires. The waiver body and medical questionnaire stay out until H-01/H-03 clear.

## Delight backlog

Cross-cutting quality to fold into slices as they're touched, not defer to a final "polish" pass.
Empty right now — the last open list shipped 2026-07-23 (see [shipped.md](shipped.md)). Fold new
cross-cutting quality in here as it arises.

## Production-readiness gates (human-owned)

These block real operations regardless of code completeness; owners and evidence live in
[human-decisions.md](human-decisions.md), and the per-discipline playbooks for clearing them
(who to talk to, with what prepared) live in [stakeholders/](stakeholders/README.md):

- **V-02 — field-validate the offline manifest** on a phone, outdoors, wet hands, airplane-mode.
  Until it passes, the safety differentiator is unproven and unclaimable.
- **Pricing posture** — the public price is **approved for now** (`src/lib/marketing.ts`,
  early-access and still moving; H-12, 2026-07-24). H-12 also closed the founding-cohort terms —
  a **two-year price lock** and **founder-direct, same-day support** — both now published on the
  pricing and home pages. Billing cadence, taxes/fees, and the contract flow remain open. See
  [competitive-analysis.md](assessments/competitive-analysis.md#pricing-posture).
- **Legal / policy sign-off** for waivers, medical, retention, course rules, nitrox parameters, and
  notification consent — H-01…H-11.

## Standing rule

If a slice can't be demoed in the browser, it isn't done. Every milestone ends with a design review
against [design/principles.md](../design/principles.md).
