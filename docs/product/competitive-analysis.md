# Competitive analysis — the buyer's view

> A buyer-perspective assessment of DiveDay against the dive-shop software market, written 2026-07-20
> from external research (vendor sites, pricing pages, ScubaBoard buyer threads) plus a hands-on pass
> through the running product (public pages, demo shop, staff surfaces, manifest). Companion to
> [product-space-investigation.md](product-space-investigation.md), which reads the product from the
> inside; this document reads it from the outside — as a shop owner comparing us to
> [DiveAdmin](https://diveadmin.com/en), EVE, DiveShop360, Bloowatch, and the generic booking
> platforms. An assessment, not a commitment; items that survive review move to
> [roadmap.md](roadmap.md).

## The market in one table

| Product | Segment | Pricing (advertised) | What buyers say |
| --- | --- | --- | --- |
| **DiveAdmin** | Dive centers/schools, resort-flavored | $39 / $59 / $119 per month by staff count; $3,495 lifetime; no commission | Young, thin review footprint; broadest modern feature list (booking widgets, waivers, WhatsApp/SMS inbox, equipment + maintenance, payroll, multi-branch, REST API + MCP/AI, 15 languages) |
| **EVE** (ISSYS) | PADI retail stores | Sales-gated license + modules | The PADI endorsement is the moat, not the product: "crappy UI," "kludge," "support almost nonexistent" (ScubaBoard); Windows desktop; acquired by DiveShop360 in 2023 — assume sunset |
| **DiveShop360** | US retail-heavy stores (Rain POS base) | Startup ~$149–199/mo; Core/Plus quote-only (Plus historically ~$299/mo + ~$3k setup) | Happiest incumbent user base; POS-first — strong retail/PADI eLearning/air cards, weaker boat-day ops; pricing opacity |
| **Bloowatch** | EU dive/watersports schools | €49 / €79 / €119 per month, zero commission | Closest dive-ops rival: ratios, live manifests, cert matching — but waivers are a paid add-on (€0–250/mo) and manifests start at Pro |
| **Generic platforms** (FareHarbor, Rezdy, Checkfront, Xola, TrekkSoft, Bookeo) | Any activity operator | $0–100/mo **plus 2–6% of online volume** (Bookeo flat $40–80 is the exception) | Win on checkout, lose on dive: no certs, no medical logic, no manifests, no gear sizes. Fee resentment is loud (FareHarbor's 6% consumer fee) |
| **Agency ecosystems** | — | PADI Adventures widget: no commission, 4.9% service charge; SSI mySSI: free training records/e-signatures with affiliation | PADI is pulling the *booking relationship* toward itself; SSI gives training admin away, setting the bar for "student management" |

A small shop's realistic all-in budget is **$50–200/month**. The long tail (ScubaOffice,
DiveCentres, original Bookadive) is a graveyard — vendor-longevity fear is a real buying factor, and
so is lock-in: owners on ScubaBoard stay on software they hate because migration hurts.

## What a buyer likes about DiveDay

Verified hands-on against the demo shop, not from our own marketing:

- **The daily loop is real and nobody else has it.** Today ("1 departure today. 9 divers still
  can't board"), the blocker queue, one-screen check-in with readiness re-checked at the boarding
  tap. Every competitor makes staff assemble this picture by hand; DiveAdmin's equivalent is lists
  and pipelines, EVE's is a desktop kludge. This is the "40% less admin" claim, actually embodied.
- **Fail-closed readiness is a genuine category difference.** Verified-vs-claimed cards, stricter-of
  trip/site requirements, medical fail-closed to physician review, nitrox re-checked at every read.
  Competitors store certs as text fields; Bloowatch's "certification matching" is the nearest claim
  and it is nowhere near a typed safety boundary. No one else can honestly say "unknown evidence
  never boards."
- **The manifest is a safety document, not a printout.** Per-dive roll-call checkpoints, append-only
  history with staff attribution, encrypted offline copy with explicit freshness and reconciliation,
  emergency contacts on the card. The market's state of the art is "print the PDF."
- **The diver never needs an account.** Sub-minute public booking, token waiver links with saved
  progress, the no-login readiness page. This attacks the most-complained-about workflow in the
  category — chasing signatures at the dock — from the diver's side too.
- **Honest, flat packaging.** One price, waivers and manifests in every tier, external processing
  fees stated plainly. Against Bloowatch's waiver add-on, TrekkSoft's triple fee stack, and
  FareHarbor's 6% consumer fee, "no add-ons, no commission" is a clean wedge.
- **Instant demo with role switching** (owner → captain → diver) and self-serve trial. Most rivals
  gate evaluation behind a sales demo; letting a buyer feel the product is itself differentiating.

## What blocks the purchase

In rough order of how often it would kill the deal:

1. ~~**We don't take the diver's money.**~~ ✅ **Closed 2026-07-21** — the public flow now hands the
   diver the shop's own hosted Stripe Checkout right after the seats commit
   ([ADR](../architecture/decisions/20260721-checkout-at-booking.md)), and the **deposit + declarative
   cancellation-window mechanisms** now ship on top of it (opt-in, off by default,
   [ADR](../architecture/decisions/20260721-deposit-cancellation-policy.md)). Remaining from the
   buyer's chair is now *policy, not mechanism*: the deposit/window values shops should be guided
   toward and live Connect platform credentials in production (all H-07). Refunds inside a stated
   window now automate through the shop's Stripe account
   ([ADR](../architecture/decisions/20260721-automated-cancellation-refund.md)).
2. **Messages** (H-09). Booking confirmation, the waiver link, and the wait-list freed-seat invite go
   through one `notify()` seam and send for real once Resend is configured — degrading to a
   copyable/mailto composer when it isn't. The remaining channel/cadence scope is now built: SMS and
   WhatsApp through a Twilio `notifySms()` seam
   ([ADR](../architecture/decisions/20260721-sms-whatsapp-notifications.md)) and scheduled 7-day/
   24-hour pre-trip reminders via an idempotent cron endpoint
   ([ADR](../architecture/decisions/20260721-scheduled-reminder-cadence.md)), both off until their
   env is set. Still open: the H-09 consent/copy/sender ownership policy.
3. **No equipment inventory or service tracking.** Rental *fit* (sizes) is genuinely useful, but
   "who has what, what's due for service" is table stakes for gear-heavy shops — DiveAdmin,
   Bloowatch, DiveShop360, and EVE all have it. We removed it (M5). For dive *charter* ops we can
   position around it; for the classic shop it is a disqualifier. A lightweight who-has-what +
   service-due register (not a POS) is likely the minimum re-entry.
4. **No agency-ecosystem hooks.** Buyers ask "does it talk to PADI?" DiveShop360 sells PADI
   eLearning code integration; DiveAdmin advertises a mySSI connection. We have a cert-verification
   seam no agency can fill (H-10 — no such API exists) and no eLearning/roster hooks. The honest
   near-term version is course rosters and student progress that *feel* agency-aware, plus painless
   CSV/export interop — not speculative API plumbing.
5. **No owner reporting.** The buyer is often the owner; "how's my month" (bookings, revenue,
   fill rate, waiver completion) has no surface. Even a modest dashboard removes a checklist zero.
6. **Trust signals are thin.** No case study, no production track record, and the safety
   differentiator (offline manifest) is field-unvalidated (V-02). In a market scarred by vendor
   deaths and acquisitions, "new + unproven + niche" is the objection; the counter is easy data
   export (attack lock-in fear head-on) and a founding-shop program that names real shops.

Explicitly fine to *not* have, despite competitors: retail POS/barcode inventory (non-goal —
DiveShop360 owns it), marketing campaigns/CRM blasts, channel-manager/OTA plumbing, staff payroll,
multi-location (say "not yet" honestly, as the pricing FAQ already does).

## Pricing: $249 is upside-down

The provisional `$249 per location / month` ([marketing.md](marketing.md#pricing-boundary)) sits
**2–6× above the specialist tier** (DiveAdmin tops out at $119, Bloowatch at €119, DiveShop360's
POS-inclusive Startup is ~$149–199) while missing checkout, equipment, and agency hooks. Premium
pricing needs either the POS-suite story (we don't want it) or a proven safety/ops story (V-02 still
open). Two coherent postures:

- **Meet the market:** land at **$79–129 flat, everything included, zero commission** — undercuts
  nothing we need and makes "no add-ons" the headline against Bloowatch/TrekkSoft nickel-and-diming.
- **Earn the premium:** keep ~$199–249 only after checkout-at-booking ships, notifications send by
  default, and the manifest is field-proven — and sell it as "the safety-first operating system,"
  with the 6%-of-volume math versus FareHarbor as the anchor (a shop doing $300k/yr online pays
  $9–18k/yr in generic-platform fees; $249/mo is $3k).

Either is defensible; the current combination (premium price, table-stakes gaps, unproven claims) is
not. This needs a product-owner decision before any customer-facing publication (H-07 territory).

## Critical vs. differentiator

| Capability | Market status | DiveDay today | Verdict |
| --- | --- | --- | --- |
| Online booking w/ real-time capacity | Universal | ✅ Best-in-class flow | Critical — done |
| **Payment/deposit at booking** | Universal | ✅ Hosted Stripe Checkout at booking ([shipped 2026-07-21](../architecture/decisions/20260721-checkout-at-booking.md)); deposit + cancellation-window mechanisms shipped opt-in ([ADR](../architecture/decisions/20260721-deposit-cancellation-policy.md)); only the policy *values* remain H-07 | Critical — mechanism done; policy open |
| Digital waivers + medical, auto-sent | Universal (often add-on) | ✅ Versioned, immutable, included | Critical — done; needs sending to be real |
| Course/student management | Universal, agency-aware | ⚠️ Sessions + prerequisites; no rosters/progress/eLearning | Critical — partial |
| Trip scheduling + manifest | Universal (as printouts) | ✅ Far beyond market | Critical — done, and a differentiator |
| Customer records (certs, sizes, history) | Universal | ✅ Person-spine is stronger than market | Critical — done |
| Rental equipment tracking | Universal | ❌ Sizes only, no inventory/service | Critical — gap |
| Notifications (email min., SMS/WhatsApp rising) | Universal | ⚠️ Email sends for real through one seam (confirmation, waiver, wait-list invite), composer fallback when unconfigured; no SMS/WhatsApp, no scheduled cadences | Critical — email done; SMS + policy open |
| Owner reporting | Expected | ❌ | Critical-lite — gap |
| Cloud + phone-first at the dock | Now disqualifying to lack | ✅ | Critical — done |
| Fail-closed readiness engine | **No one has it** | ✅ | **Differentiator #1** |
| Offline roll call w/ reconciliation | No one has it | ✅ (field-unproven, V-02) | Differentiator — prove it |
| No-login diver arc (book/sign/readiness) | No one has it end-to-end | ✅ | Differentiator |
| Today/blocker daily loop | No one has it | ✅ | Differentiator |
| Delight/UX | Open flank (EVE is the anti-model) | ✅ Visibly ahead | Differentiator |
| Flat transparent pricing, no add-ons | Rare (Bookeo, DiveAdmin) | ⚠️ Posture right, number wrong | Differentiator if repriced |
| Open API / AI / easy export | Only DiveAdmin | ❌ | Watch — DiveAdmin is claiming the "modern/AI" flag with MCP + REST; an export-first anti-lock-in story is the cheap counter |

## Implications for the queue

Consistent with the [breadth→depth pivot](product-space-investigation.md#recommendation-three-moves-in-order),
with one material re-ranking from the buyer's chair:

1. ✅ **Elevate checkout-at-booking (H-07) from P2 to the front of P1** — shipped 2026-07-21: the
   public flow now ends on the shop's own hosted Stripe Checkout, webhook confirmed
   ([ADR](../architecture/decisions/20260721-checkout-at-booking.md)), and the deposit +
   declarative-cancellation mechanisms now layer on it opt-in
   ([ADR](../architecture/decisions/20260721-deposit-cancellation-policy.md)). Still open from the
   buyer's chair, and now *policy not mechanism*: the deposit/window values, whether refunds
   automate, and live Connect platform credentials (H-07).
2. ✅ **Real notifications (H-09)** — the wait-list freed-seat invite sends through the same
   `notify()` seam as booking confirmations and waiver links, and the remaining channel/cadence scope
   is now built too: SMS/WhatsApp via a Twilio `notifySms()` seam and scheduled 7-day/24-hour pre-trip
   reminders via an idempotent cron endpoint (both off until their env is set). Remaining is policy,
   not mechanism: the H-09 consent/copy/sender ownership decision.
3. Field-validate the manifest (V-02) before marketing leans on safety.
4. Decide the pricing posture (owner decision) before publishing beyond the trial surface.
5. Re-scope a *minimal* gear register (who-has-what + service-due, not POS) as the answer to the
   equipment disqualifier — an ADR-worthy reversal of the M5 removal, deliberately smaller.
6. Keep the cut list cut: dive-site CMS/global catalog and per-agency verification plumbing add
   nothing a buyer asks for; DiveAdmin's feature breadth is not the model to chase.
