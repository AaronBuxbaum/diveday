# Stakeholder playbooks — who to talk to, with what in hand

Per-discipline playbooks for every human conversation the [rollout plan](../rollout.md) depends
on: exactly who to contact, when in the sequence, what to have prepared before the call, what each
conversation gates, and where its outcome gets recorded. Written 2026-07-24 against the Phase-0
state of the rollout.

## Division of responsibility (read this before editing anything)

Three documents cooperate; each owns one thing, so updates land in exactly one place:

| Document | Owns | Never holds |
| --- | --- | --- |
| [rollout.md](../rollout.md) | **When** — phases, sequencing, the stakeholder register snapshot | prep material, agendas |
| [human-decisions.md](../human-decisions.md) | **Status** — the decision register (H-rows) and verification queue (V-rows) of record | how to run the conversation |
| These playbooks | **Who and how** — contacts, briefing packets, agendas, question lists | status. No "done" marks here, ever |

When a conversation happens, record its outcome in the relevant H-/V-row (and, if it clears a
gate, in the rollout plan) — not here. Update a playbook only when the *play* changes: a new
stakeholder, a sharper question list, a lesson learned about how to run the meeting. That is what
keeps the three documents from drifting.

## The playbooks

| Discipline | Playbook | Primary stakeholders | Rollout timing | Gates |
| --- | --- | --- | --- | --- |
| Legal & liability | [legal.md](legal.md) | The owner's existing generalist attorney (engaged); a scuba-liability specialist (FL, not yet found); CPA (entity input). Tier split for who does what: [legal-engagement-scope.md](legal-engagement-scope.md) | Phase 0, **book this week** — longest lead | H-01, H-02, H-03, H-17, H-18, V-03 |
| Insurance | [insurance.md](insurance.md) | Startup commercial broker (DiveDay's own E&O/cyber); dive-industry brokers + DAN (shop-side underwriting answer) | Phase 0, parallel with legal | H-19; the underwriting one-pager sales asset |
| Finance, payments & tax | [finance-and-tax.md](finance-and-tax.md) | Stripe (Connect platform review), CPA, bank/bookkeeper | Phase 0 — **submit Stripe application immediately** | H-07 (remaining policy), H-12 (remaining terms) |
| Privacy & communications | [privacy-and-communications.md](privacy-and-communications.md) | Privacy counsel, Twilio (A2P 10DLC), Resend (sender domain) | Phase 0 — **submit A2P immediately** (days-to-weeks) | H-02, H-04 (incident response), H-09 |
| Dive operations & safety | [dive-operations.md](dive-operations.md) | Dive operations lead, friendly charter captain, gas-blending authority, `dive-domain-expert` reviewer | Phase 0 → first pilot boat day | H-05, H-06, H-08, H-11, V-01, V-02, V-04, V-05 |
| Commercial & industry | [commercial-and-industry.md](commercial-and-industry.md) | Design-partner shops (3 profiles), DEMA, Scubanomics, dive media, Capterra | Recruit now; DEMA decision by early Sept; media Phase 2–3 | V-04, H-12 (contract flow), phase exits |

## The critical path

Four clocks start ticking on contact, not on need — start all four in the same week:

1. **The attorney engagement** ([legal.md](legal.md)) — the rollout's longest lead; H-01–H-03
   block every real waiver. Split across two attorneys: the generalist already engaged (send her
   [the scope memo](legal-engagement-scope.md)) and a scuba-liability specialist still to find.
2. **The Stripe Connect platform application** ([finance-and-tax.md](finance-and-tax.md)) —
   Stripe reviews platforms on their own schedule; it also needs the entity answer (H-18).
3. **Twilio A2P 10DLC registration** ([privacy-and-communications.md](privacy-and-communications.md))
   — US carrier registration takes days to weeks; no legal SMS sending without it.
4. **A boat day for V-02** ([dive-operations.md](dive-operations.md)) — needs weather, a captain,
   and a hull; the offline-manifest claim stays off every surface until it passes.

Two dependencies cut across disciplines and should be resolved first because other stakeholders
ask for their outputs:

- **H-18 (corporate footing)** — the entity name goes on the pilot agreement, the insurance
  policy, the Stripe application, and the terms of service. Analysis and recommendation in
  [legal.md](legal.md#the-entity-decision-h-18).
- **H-19 (DiveDay's own E&O/cyber)** — the pilot agreement should be able to reference coverage,
  and binding it needs the entity. See [insurance.md](insurance.md).

## First two weeks, by discipline

The rollout plan's [30-day list](../rollout.md#the-next-30-days-in-order) is the master sequence;
this is the same work cut by discipline so each playbook can be executed independently:

- **Legal:** send the generalist [her scope memo](legal-engagement-scope.md) and take the entity
  question (H-18) to her + the CPA in the same call; in parallel, shortlist specialist candidates
  via the referral paths and send the specialist engagement request with the briefing packet.
- **Finance:** submit the Stripe Connect platform application; book the CPA conversation
  (entity structure input, SaaS sales-tax posture).
- **Privacy & comms:** submit Twilio A2P registration; verify the Resend production sender;
  draft the H-09 consent policy for counsel review.
- **Insurance:** request tech E&O + cyber quotes (needs the H-18 direction); open the
  underwriting conversation with one dive-industry broker.
- **Ops:** run V-01 in the browser; script and schedule the V-02 boat day.
- **Commercial:** finalize the design-partner one-pager; open five shop conversations across the
  three profiles; decide DEMA posture by early September.

## Maintenance

- A gate changing state → update [human-decisions.md](../human-decisions.md) and, if it clears a
  phase criterion, [rollout.md](../rollout.md) — in the same change, per the standing rule there.
- A playbook that a real conversation proved wrong (missing question, wrong contact path) → fix
  the playbook in the same change that records the outcome.
- A new stakeholder or discipline → add the playbook here and a register row in the rollout plan.
