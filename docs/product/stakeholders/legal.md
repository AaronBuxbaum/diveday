# Legal & liability — stakeholder playbook

The longest-lead discipline and the rollout's critical path. Nothing here is legal advice; it is
the preparation that makes the counsel engagement short and cheap. Status of record:
[human-decisions.md](../human-decisions.md) rows **H-01** (jurisdiction + waiver/medical
templates), **H-02** (retention/deletion), **H-03** (e-signature sufficiency), **H-17** (imported
waiver acceptance — decided, but counsel should see it), **H-18** (corporate footing + SaaS
contract set), and **V-03** (flow review against the approved policies).

**Working assumptions (owner-confirmed 2026-07-24):** the launch jurisdiction planned around is
**Florida** (H-01 records the final choice with counsel); the owner's existing entity is
**Pseudorandom LLC** (S-corp election; current business: software contracting and mentorship) —
see [the entity decision](#the-entity-decision-h-18).

**Two attorneys, not one (owner-confirmed 2026-07-24):** the owner already has a generalist
attorney and prefers to default to her — reaching for the scuba-liability specialist only where the
exposure is genuinely dive-specific, with room to "upgrade" a Tier 1/2 item to specialist review if
it turns out closer to the line than expected. The full tier-by-tier split, written as a document
ready to send the generalist as her engagement brief, is
[legal-engagement-scope.md](legal-engagement-scope.md). This page below still covers *finding* and
*briefing* the specialist (who is not yet engaged) — the deliverables list and question list here
are scoped to her Tier 3 work plus the Tier 2 items she signs off on, not the whole engagement.

## Why this blocks rollout

- The waiver/medical flow is a core pillar shipped on [provisional
  baselines](../human-decisions.md#provisional-implementation-defaults--verify-before-production)
  — PADI-*shaped*, not counsel-approved. A pilot shop sending a real release on unapproved
  language converts the differentiator into the founder's personal liability.
- Phase 1 cannot start without a pilot agreement to sign, and no agreement can be signed without
  knowing which entity signs it (H-18).
- The published founding-cohort claims (two-year price lock, same-day support) are binding
  commercial commitments that need contract language behind them (H-12's open contract flow).

## Who to talk to

| Stakeholder | Role | Status | How to find them |
| --- | --- | --- | --- |
| The owner's existing generalist attorney | Tier 1 (entity, SaaS contract set, H-17 sanity check) and Tier 2 first drafts (H-02 retention, the general half of H-03) — full scope in [legal-engagement-scope.md](legal-engagement-scope.md) | **Already have her** — send the scope memo, no search needed | — |
| Recreational-liability attorney with scuba release experience, licensed in Florida | Tier 3: H-01's waiver/medical template and minors' release, and Tier 2 sign-off on H-02/H-03 | **Not yet engaged** — find and brief her | DAN's risk-mitigation program refers; dive-industry insurance brokers (the PADI-endorsed broker, historically Vicencia & Buckley / HUB International) work with these attorneys daily and will name names; DEMA member legal resources; Florida Bar referral filtered to recreational/sports liability |
| CPA | Tax half of the entity decision (S-corp interaction) | See [finance-and-tax.md](finance-and-tax.md) | Run H-18 past both the generalist and the CPA before forming anything |

Selection bar for the liability specialist: has drafted or defended scuba/dive-charter releases
in Florida, is comfortable opining on electronically signed exculpatory releases, and will quote
a flat-fee **review** engagement (the provisional baselines exist precisely so this is a review,
not drafting from scratch).

## When

- **This week:** send the generalist the [engagement scope memo](legal-engagement-scope.md) —
  no search needed, she's already engaged. In parallel, shortlist 2–3 specialist candidates and
  send the specialist engagement request with the briefing packet below. This is item 1 on the
  rollout's [30-day list](../rollout.md#the-next-30-days-in-order).
- **Before any pilot agreement is signed (~early Sept):** H-18 entity direction chosen, pilot
  agreement template done, E&O/cyber bound ([insurance.md](insurance.md)).
- **Before any real shop sends a real waiver:** H-01–H-03 outcomes recorded and V-03 performed.

## The specialist's engagement — deliverables to request (one engagement, in writing)

The generalist's Tier 1/2 scope (entity, SaaS contract set, H-17 sanity check, first drafts of
H-02/H-03) is in [legal-engagement-scope.md](legal-engagement-scope.md) and does not need to be
asked of the specialist. What the specialist's engagement should produce:

1. **H-01:** approved Florida waiver template + medical questionnaire, including the
   minor/guardian flow (the glossary's Junior-certification rules and Discover Scuba Diving
   participants are the hard cases).
2. **H-02 sign-off:** confirm the generalist's draft retention window actually matches what the
   release needs to hold up evidentially, and that the immutability model satisfies spoliation
   expectations.
3. **H-03 sign-off:** a written opinion on whether typed name + explicit consent + timestamp is a
   sufficient assurance level for *this specific* Florida release, or the criteria a specialist
   e-signature provider must meet (the `SignatureProvider` seam exists; if required it becomes
   the one Phase-0 engineering task, per the rollout's
   [pre-decided responses](../rollout.md#risks-and-pre-decided-responses)).
4. **A written opinion** on whether the release/medical/consent flow, taken as a whole, is likely
   enforceable for scuba-specific claims in Florida.

## Briefing packet — have this assembled before the first call

Everything already exists; the packet is links and screenshots, not new writing:

- The [waiver signature/retention ADR](../../architecture/decisions/20260718-waiver-signature-retention.md)
  and the [provisional waiver/signature defaults](../human-decisions.md#waiver-and-signature)
  (form shape, sources, and what is explicitly *not* claimed).
- The evidence model in one paragraph: immutable versioned templates, typed full name + explicit
  consent + timestamp, expiring private completion links (the URL is the capability — see the
  [capability telemetry runbook](../../engineering/capability-telemetry-runbook.md)), append-only
  roll-call ledger.
- The [imported-waiver ADR](../../architecture/decisions/20260724-import-waiver-acceptance.md)
  (H-17) and the [person email-uniqueness ADR](../../architecture/decisions/20260723-person-email-uniqueness.md)
  (H-13 identity handling) — the two decided-but-review-worthy postures.
- Screenshots or a live walkthrough of the signing flow (`/waivers/[token]`), the medical-flag
  blocker a staff member sees, and the export bundle (records leave with the shop —
  [full-shop export ADR](../../architecture/decisions/20260722-full-shop-export.md)).
- The published claims that carry legal weight: two-year price lock, same-day support,
  "cancel anytime with the export button" (see [marketing.md](../marketing.md)'s claims policy).

## Question list for the liability specialist

- Is a Florida recreational scuba release enforceable with our evidence model, and does the
  platform (DiveDay's entity) need to appear in the released-parties language, or is the release
  strictly shop↔diver?
- Minors: does Florida's parental pre-injury release statute cover a dive shop's activities, what
  statutory language is mandatory, and how must the guardian flow capture it?
- What limitations period (plus tolling for minors) should set the H-02 retention floor, and does
  our immutability model satisfy spoliation expectations? (Confirming the generalist's draft, not
  originating it — see [the scope memo](legal-engagement-scope.md#tier-2--generalist-drafts-specialist-blesses-before-it-goes-live).)
- Is typed-name consent sufficient under Florida's UETA adoption / federal E-SIGN for *this
  specific* exculpatory release, or is identity-assurance (e.g. specialist provider) required
  (H-03)? (The general UETA/E-SIGN question is the generalist's; this is the narrower
  adventure-sport-scrutiny layer on top.)
- Medical questionnaire: what duty does *collecting* medical flags create for the shop and for
  DiveDay, and what handling/access boundary does that imply (feeds H-02 and the privacy policy)?

The indemnification and post-churn evidence-custody questions that used to live here are Tier 1
generalist work — see [legal-engagement-scope.md](legal-engagement-scope.md#tier-1--generalist-no-specialist-needed).

## The entity decision (H-18)

**Question:** run DiveDay inside Pseudorandom LLC (S-corp; software contracting + mentorship), or
form a dedicated entity?

**Tier 1 — the generalist's call, no specialist needed. Recommendation to take into the
generalist/CPA conversation: form a dedicated DiveDay LLC before any pilot agreement is signed.**
Rationale:

- **Risk pooling.** DiveDay is safety-adjacent (manifests, medical flags, waivers) and holds
  medical data. A claim or breach against DiveDay should not reach Pseudorandom's consulting
  revenue and reputation — and a consulting dispute should not threaten DiveDay.
- **The S-corp election ages badly here.** If DiveDay ever takes investment or is sold, S-corp
  shareholder restrictions (no entities, no preferred) force a restructuring at the worst time.
  A separate LLC keeps the option of a clean conversion.
- **Contract clarity.** Shops sign with an entity; the price lock and support SLA become that
  entity's obligations. "Pseudorandom LLC d/b/a DiveDay" on a dive-industry contract is
  explainable but weaker than a dedicated entity, and migrating signed pilots later is friction.
- **Cost is trivial** relative to the exposure — formation plus an annual report fee.

Open questions for the generalist + CPA (do not decide these unilaterally):

- Sibling LLC owned personally vs. subsidiary of Pseudorandom (isolation is cleaner as a sibling;
  tax/payroll mechanics may argue otherwise given the S-corp).
- Formation state: home state vs. Florida vs. Delaware, and whether soliciting/operating with
  Florida shops requires Florida foreign qualification regardless.
- Interim posture: if pilots start before formation completes, is signing under Pseudorandom
  d/b/a DiveDay acceptable *with E&O/cyber bound* (H-19), or do pilot agreements wait?

**Record the outcome in H-18** ([human-decisions.md](../human-decisions.md#decision-register)).

## Where outcomes land

- H-01, H-02, H-03, H-18 rows updated with owner, outcome, date, and linked evidence.
- Approved template text replaces the provisional shape in the product's waiver templates;
  if H-03 demands a vendor, the `SignatureProvider` adapter becomes a
  [roadmap](../roadmap.md) item with an ADR.
- V-03 performed against the approved policies; evidence recorded in the
  [verification queue](../human-decisions.md#human-verification-queue).
- Contract set filed where the owner keeps executed documents; the terms-of-service obligations
  feed [marketing.md](../marketing.md)'s claims policy (claims must match the contract).
