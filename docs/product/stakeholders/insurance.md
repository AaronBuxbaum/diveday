# Insurance — stakeholder playbook

Two distinct workstreams that share a discipline but not a stakeholder: **(A)** DiveDay's own
coverage, and **(B)** the shop-side underwriting answer that becomes a sales asset. Status of
record: [human-decisions.md](../human-decisions.md) row **H-19** (DiveDay's own coverage); the
shop-side one-pager is a Phase-0 deliverable named in the
[rollout plan](../rollout.md#01-legal-and-policy-h-01-h-02-h-03-v-03--start-immediately-longest-lead).

## Why this blocks rollout

- DiveDay stores medical flags and waiver evidence for a safety-adjacent activity. Holding a
  pilot shop's real data with no E&O/cyber coverage concentrates every failure mode on the
  founder personally (compounded until H-18 separates the entity — see
  [legal.md](legal.md#the-entity-decision-h-18)).
- Pilot shops will ask "does using DiveDay affect my liability coverage?" in the first
  conversation. Without a prepared answer, the sales conversation stalls exactly where the
  product is strongest (the evidence model).

## Workstream A — DiveDay's own coverage (H-19)

**Who:** a commercial insurance broker who quotes technology E&O + cyber for early-stage
software companies (digital-first brokers quote this in days; a local commercial broker works
too). Not the dive-industry brokers — this is ordinary tech insurance.

**When:** quotes this week; bound **before a pilot shop's real data is live**, and ideally before
the pilot agreement is signed so the agreement can reference coverage. Needs the H-18 entity
direction first — the policy names the insured entity.

**What to have prepared:**

- Entity details (or the H-18 plan), projected first-year revenue (modest: capped founding
  cohort at $99/location/month — see [marketing.md](../marketing.md)).
- A one-page data inventory: what is stored (waiver records with medical flags, certification
  card photos, contact details, payment references — *no card numbers; Stripe holds those*),
  where (Neon Postgres, Vercel Blob), and roughly how many records a pilot implies.
- A one-page security posture: capability-URL model and its
  [telemetry redaction runbook](../../engineering/capability-telemetry-runbook.md), encrypted
  offline manifest snapshots ([ADR](../../architecture/decisions/20260718-offline-manifest-snapshots.md)),
  [rate limiting](../../architecture/decisions/20260724-rate-limiting.md), auth model
  ([ADR](../../architecture/decisions/0006-auth.md)), backups and the named incident-response
  owner (H-04).

**Questions for the broker:**

- What limits are sane for a pre-revenue platform holding health-adjacent data for a
  recreational-diving audience? (Ask for options, not one number.)
- Does the cyber policy cover breach notification costs for medical-flag data specifically?
- Does E&O respond if a software defect contributes to an operational failure at a shop (e.g. a
  readiness blocker not shown)? What exclusions apply to bodily-injury-adjacent claims?
- What will underwriting want to see at renewal that we should start recording now?

**Record the outcome in H-19:** carrier, limits, effective date — or a written decision to
proceed uninsured (make that deliberate, never a default).

## Workstream B — the shop-side underwriting answer (sales asset)

**Who:** at least one dive-industry insurance broker (in the US, the PADI-endorsed broker —
historically Vicencia & Buckley / HUB International); DAN's risk-mitigation program as referrer
and reference; and, during Phase 1, each pilot shop's own broker if they ask.

**When:** Phase 0, in the same weeks as the legal engagement — the
[rollout plan](../rollout.md#01-legal-and-policy-h-01-h-02-h-03-v-03--start-immediately-longest-lead)
treats it as part of the same push.

**The question to get answered:** do digitally signed releases with DiveDay's evidence model meet
underwriting expectations for a dive shop's liability coverage?

**What to have prepared (same evidence-model brief as the legal packet):** immutable versioned
waiver templates, typed consent + timestamp, expiring capability links, append-only roll-call
ledger, offline snapshot policy, and the export button (records are the shop's, always —
[full-shop export ADR](../../architecture/decisions/20260722-full-shop-export.md)).

**Deliverable:** the one-page **"What your insurer will ask — and our answers"** document the
rollout plan calls for. Outline:

1. How releases are signed and what evidence exists per signature.
2. How medical disclosures are handled and who can see them.
3. How the manifest/roll call record is kept (append-only) and what the offline copy is and isn't.
4. How the shop gets every record out, any time.
5. The open items we do not claim (whatever H-01–H-03 have not yet cleared — keep this honest,
   per the [claims policy](../marketing.md)).

This asset is *marketing-adjacent*: it must obey the claims policy (no offline roll-call claims
before V-02 passes; no legal-sufficiency claims before H-03 is signed off).

## Where outcomes land

- H-19 row updated with the bound coverage.
- The one-pager becomes part of the design-partner packet
  ([commercial-and-industry.md](commercial-and-industry.md)); if it makes public claims it goes
  through [marketing.md](../marketing.md)'s claims policy first.
- Anything a broker flags as an underwriting gap feeds the legal engagement
  ([legal.md](legal.md)) or the roadmap, not a quiet workaround.
