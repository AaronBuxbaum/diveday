# Finance, payments & tax — stakeholder playbook

Money moves in two separate systems and only one is built: **shops' diver payments** run through
Stripe Connect on shop-owned accounts (shipped), while **DiveDay's own $99/location/month
subscription billing** has no mechanism yet. This playbook covers the Stripe platform
application, the CPA engagement, and the open policy scraps. Status of record:
[human-decisions.md](../human-decisions.md) rows **H-07** (remaining payment policy), **H-12**
(remaining commercial terms), and **H-18** (entity — the CPA co-owns that decision with counsel,
see [legal.md](legal.md#the-entity-decision-h-18)).

## Why this blocks rollout

- The live Stripe Connect platform application (`STRIPE_CONNECT_CLIENT_ID`) is a Phase-0 gate
  with a review queue DiveDay doesn't control — an unsubmitted application is the classic
  self-inflicted pilot blocker ([rollout 0.2](../rollout.md#02-operational-ownership-h-04-h-09-credentials-h-07-credentials)).
- Phase 2 charges real shops. No billing mechanism, cadence, or tax posture is decided (H-12's
  open half), and the founding-cohort terms already published (price lock, support SLA) need
  contract and invoice reality behind them.

## Who to talk to

| Stakeholder | About | When |
| --- | --- | --- |
| Stripe (Connect platform review) | Live platform application, production webhook secret, loss-liability posture of Standard accounts | **Submit this week** — long lead |
| CPA / accountant | Entity structure input to H-18, S-corp interaction, SaaS sales-tax posture, bookkeeping setup | First call within two weeks (before entity formation) |
| Bank | Account for the DiveDay entity once H-18 resolves | After formation |

## Stripe — the platform application

**What to have prepared:**

- Entity details and EIN (H-18 dependency — if formation is pending, ask Stripe support whether
  to apply under the existing entity and migrate, or wait; do not guess).
- Business description that matches reality: B2B SaaS for dive shops; payments flow on
  **Standard connected accounts owned by the shops** — DiveDay is the platform, takes **no
  platform fee** (recommended posture per
  [rollout 0.2](../rollout.md#02-operational-ownership-h-04-h-09-credentials-h-07-credentials);
  final call is H-07's), and the connected account bears chargeback/loss liability under the
  Standard model ([Stripe Connect ADR](../../architecture/decisions/20260719-stripe-connect-orders.md)).
- Live site URL, support email on the production domain, expected volumes (honest pilot-scale
  numbers).
- Webhook configuration: the production `STRIPE_WEBHOOK_SECRET`, subscribed to the
  `checkout.session.*` events already required (see H-07's row).

**Questions for Stripe (support/review, as they come up):** platform-fee changes later (adding
one after launch), and whether the no-fee Standard posture changes any review requirement.

## CPA — the engagement

**What to have prepared:** Pseudorandom LLC facts (S-corp election, current lines of business),
DiveDay's model (subscription SaaS, $99/location/month, founding cohort ≤25 shops, no platform
fee on shops' payment volume), the launch plan (Florida shops, founder's home state), and the
[entity questions from legal.md](legal.md#the-entity-decision-h-18).

**Question list:**

- Entity structure (with counsel): sibling LLC vs. subsidiary of the S-corp; payroll/QBI
  mechanics; which state to form in and whether Florida foreign qualification is needed.
- Is the $99 SaaS subscription taxable in Florida and in the founder's home state? At what point
  does selling to shops in other states create sales-tax nexus, and should Stripe Tax (or
  equivalent) be in the billing design from day one?
- How should shop payments be treated in DiveDay's books given they never touch DiveDay's
  accounts (Standard Connect)? Confirm 1099-K responsibility sits with Stripe/the shops' own
  accounts, not the platform.
- Bookkeeping and deductibility hygiene for the pilot phase (boat days, DEMA, travel).

## Open policy to close (owner decisions, informed by the above)

These are the **policy** halves of rows whose mechanisms already shipped — closing them is
recording a choice, not building anything:

- **H-07 remainder:** guidance values for deposits and cancellation windows (DiveDay ships no
  defaults — [deposit/cancellation ADR](../../architecture/decisions/20260721-deposit-cancellation-policy.md)),
  tax treatment on trip payments, whether a platform fee ever exists, whether unpaid bookings
  auto-expire, and percentage deposits (mechanism deferred by owner request).
- **H-12 remainder:** billing cadence (monthly card on file is the obvious default), the
  invoice/receipt mechanism for DiveDay's own subscription (likely Stripe Billing on DiveDay's
  **own** account — a separate thing from Connect; if built, it needs an ADR and a roadmap
  entry), taxes/fees presentation, and the public contract/contact intake flow
  ([commercial-and-industry.md](commercial-and-industry.md) owns the intake conversation).

## Where outcomes land

- H-07 and H-12 rows updated; pricing display changes go through the
  [pricing boundary](../marketing.md#pricing-boundary) (`src/lib/marketing.ts` is the source of
  truth — never edit a price in page copy).
- A subscription-billing mechanism, if chosen, enters [roadmap.md](../roadmap.md) with an ADR
  (new runtime dependency rule).
- Entity/tax outcomes land in H-18 with [legal.md](legal.md).
