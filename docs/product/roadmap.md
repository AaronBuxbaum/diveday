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
notifications with scheduled reminders, the Today work queue, and full-shop export — plus the UX arc
that made those surfaces *act* (one-tap sends, transactional `/ready`, command palette). See
[shipped.md](shipped.md).

The next arc is **not new pillars.** It is finishing the data-portability wedge, closing the
production-readiness gaps, and answering the two buyer objections that still lose deals (no owner
reporting, no gear register). Breadth is done; depth and proof are the work.

## Open work, in priority order

### 1. Data-portability follow-ons (the wedge)

Export, the diver/customer CSV importer, and the public migration guides have shipped; the rest of
the "switching is safe" story is greenfield. Sequenced in
[competitive-strategy.md](assessments/competitive-strategy.md#the-build-plan-in-order).

- ✅ **Import waiver acceptance, export real photo files** — shipped 2026-07-24: the importer now
  trusts a row's claim that a diver already accepted a waiver (medical clearance included) at a prior
  shop, marked `imported`; the export bundle now includes every DiveDay-stored photo as a real file,
  not only a URL. See [shipped.md](shipped.md), [20260724-import-waiver-acceptance](../architecture/decisions/20260724-import-waiver-acceptance.md),
  [20260724-export-bundled-photos](../architecture/decisions/20260724-export-bundled-photos.md).

- ✅ **Public migration guides** — shipped: `/switching` hub plus a live page per named incumbent
  (EVE, DiveShop360, DiveAdmin, Smartwaiver), each an export click-path + the importer's scope table
  + the import walkthrough ([shipped.md](shipped.md), [marketing.md](marketing.md)).
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

### 6. Smaller follow-ons

All three shipped 2026-07-23 — recurring-series series-wide edit/cancel and a rolling horizon, the
Today freed-seat one-tap waitlist invite, and the post-trip recap extras (crew shout-out + diver
photos). See [shipped.md](shipped.md).

### 7. Staff role authority boundaries (H-14, decided — not yet built)

Every staff role currently reaches nearly every staff surface. The product owner decided 2026-07-24
that payment settings, refunds, waiver templates, diver deletion, and trip configuration need real
role boundaries ([human-decisions.md](human-decisions.md#decision-register) H-14). Not designed or
built yet: the actual role/permission matrix (which role(s) may reach each surface), enforcement in
`src/lib/authz.ts` and the relevant server actions, and an ADR recording the chosen matrix. Requires
`security-reviewer` and `dive-domain-expert` review before merge per AGENTS.md's hard rules.

## Delight backlog

Cross-cutting quality to fold into slices as they're touched, not defer to a final "polish" pass.
The whole open list shipped 2026-07-23 — generic undo (land-then-undo toast), a true `useOptimistic`
path (payment status), visible keyboard shortcuts beyond ⌘K, saved filters/views for shop roles, a
staff-page performance budget, custom event instrumentation, and the DAN / dive-insurance field —
alongside the earlier done items (global command/search, demo data, accessible motion). All indexed
in [shipped.md](shipped.md). Fold new cross-cutting quality in here as it arises.

## Production-readiness gates (human-owned)

These block real operations regardless of code completeness; owners and evidence live in
[human-decisions.md](human-decisions.md):

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
