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

Export shipped; the rest of the "switching is safe" story is greenfield. Sequenced in
[competitive-strategy.md](assessments/competitive-strategy.md#the-build-plan-in-order); the importer is
**safety-critical** (boring code, adversarial tests, `dive-domain-expert` review).

- **Diver/customer CSV importer** with a published honesty table (what imports fully / partially /
  never). Imported certs land **claimed, never verified**; medical flags import fail-closed. Reuses
  the export's CSV schemas as the contract.
- **Public migration guides** — "Switching from DiveShop360 / EVE / DiveAdmin / Smartwaiver", each an
  exact export click-path + scope table + the importer. Live on the marketing surface
  ([marketing.md](marketing.md)); "Switching from EVE" first.
- **Scheduled backup export** to shop-owned storage (weekly bundle; `.ics` trip feeds ride along).
- **Read API + webhooks**, every tier — token-scoped reads over the export schema plus
  booking/waiver/manifest events. **ADR required** before building.

### 2. Third-party e-signature adapter (M3 follow-up)

The waiver signature is still in-house typed consent (`src/lib/signatures.ts` — local + in-person
providers only). A vendor adapter behind the existing `SignatureProvider` seam is follow-up work,
gated on the H-01/H-03 legal decisions
([waiver-signature-retention](../architecture/decisions/20260718-waiver-signature-retention.md)).

### 3. Owner reporting

The buyer is often the owner, and "how's my month" (bookings, revenue, fill rate, waiver completion)
has no surface today — a recurring deal-blocker
([competitive-analysis.md](assessments/competitive-analysis.md#what-blocks-the-purchase) #5). Even a modest
dashboard over data that already exists removes the objection.

### 4. Minimal gear register (an M5 reversal, deliberately smaller)

M5 removed equipment inventory on purpose, but "who has what, what's due for service" is table stakes
for gear-heavy shops and a disqualifier for the classic retail shop
([competitive-analysis.md](assessments/competitive-analysis.md#what-blocks-the-purchase) #3). The re-entry is a
lightweight who-has-what + service-due register — **not** a POS, and **not** the deleted assignment
model. **ADR required** (it reverses a shipped decision).

### 5. Nitrox fill / analysis log (open question)

The analyzed-fill log was retired with gear inventory (it referenced a tracked cylinder). Whether a
fill/analysis record should return in some tank-free form is genuinely open, gated on the nitrox
policy decision — V-05 and H-11 in [human-decisions.md](human-decisions.md).

### 6. Multi-boat / multi-shop configuration

Multi-shop tenancy exists (`shop_id` everywhere); there is **no boat entity** — a trip is the
boat-day. Per-boat configuration and multi-location operating views are unbuilt, and their
provider/policy decisions are open. Deliberately deferred until a real operator needs it.

### 7. Loose ends

- **Remove the dead `buddyPreference` column** — WP-5 specced its deletion but the field survives in
  `src/db/schema.ts` (and is still read in `src/db/bookings.ts`, `src/db/export.ts`). Delete beats
  hedging a field nothing renders.

## Delight backlog

Cross-cutting quality to fold into slices as they're touched, not defer to a final "polish" pass.
The done items (global command/search, thoughtful demo data, accessible motion) moved to
[shipped.md](shipped.md); what remains open:

- **generic undo** for reversible staff actions (beyond the manifest re-tap and inverse actions that
  exist today) instead of confirmation dialogs;
- **optimistic interaction** where rollback is safe — boarding already shows a server-authoritative
  pending state; extend the pattern (a true `useOptimistic` path) where it helps;
- **visible keyboard shortcuts** beyond ⌘K;
- **saved filters/views** for common shop roles;
- **performance budgets** for staff pages on ordinary phones and weak marina Wi-Fi;
- **event instrumentation** for abandonment, blocker frequency, and staff recovery paths (only
  page-level analytics exists today);
- a **DAN / dive-insurance field** — the glossary calls it "worth a field"; not captured yet.

## Production-readiness gates (human-owned)

These block real operations regardless of code completeness; owners and evidence live in
[human-decisions.md](human-decisions.md):

- **V-02 — field-validate the offline manifest** on a phone, outdoors, wet hands, airplane-mode.
  Until it passes, the safety differentiator is unproven and unclaimable.
- **Pricing posture** — the public price is provisional (`src/lib/marketing.ts`, currently
  early-access) and awaits the H-12 commercial decision; see
  [competitive-analysis.md](assessments/competitive-analysis.md#pricing-posture).
- **Legal / policy sign-off** for waivers, medical, retention, course rules, nitrox parameters, and
  notification consent — H-01…H-11.

## Standing rule

If a slice can't be demoed in the browser, it isn't done. Every milestone ends with a design review
against [design/principles.md](../design/principles.md).
