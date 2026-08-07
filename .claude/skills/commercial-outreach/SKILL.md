---
name: commercial-outreach
description: Draft or update pilot/founding-shop outreach and sales collateral — the design-partner one-pager, case-study interview prep, DEMA/media pitch notes, or other prep material for a stakeholder conversation in the go-to-market plan. Use whenever a task touches docs/product/rollout.md's recruiting/outreach work, docs/product/stakeholders/commercial-and-industry.md, or asks for a pitch, pilot pitch, one-pager, cold-outreach message, or case-study prep.
---

# Commercial outreach and sales collateral

DiveDay has no marketing or sales team — one founder runs every real conversation, sends every
real message, and posts to every public thread himself ([AGENTS.md](../../../AGENTS.md): AI
agents are the developers, not the sales force). This skill produces **drafts**: the design-partner
one-pager, case-study interview prep, cold-outreach message templates, pitch notes for DEMA or dive
media — material the founder personalizes and delivers in his own voice. It never sends, posts, or
signs anything on his behalf.

**Hard boundary: no autonomous outreach.** Never draft-and-send an email, never post to ScubaBoard
or a Facebook dive-industry group, never DM a journalist or DEMA contact, never submit a Capterra
listing or an ad campaign. Those are the founder's actions per the commercial-and-industry playbook's
own etiquette rule ("respond to named problems with specifics; never broadcast") — this skill's
output is always a draft artifact he reviews and sends himself.

## Before writing

1. Read [docs/product/rollout.md](../../../docs/product/rollout.md) — phases, exit criteria, the
   offer, and the "next 30 days" list this collateral supports.
2. Read [docs/product/stakeholders/commercial-and-industry.md](../../../docs/product/stakeholders/commercial-and-industry.md)
   — the per-stakeholder playbook (design partners, DEMA, dive media, founding-shop references)
   this skill's artifacts are "what to have prepared" for.
3. Read `docs/product/marketing.md`'s claims policy in full — it governs this collateral exactly
   as it governs the public pages. A pilot offer is a claims surface: "anything promised to a
   pilot in writing must already exist in the claims policy or get added there."
4. Check [human-decisions.md](../../../docs/product/human-decisions.md) H-12 for what commercial
   terms are actually authorized to promise today (founding price, two-year lock, founder-direct
   same-day support) versus still open (contract/intake flow, billing cadence, taxes/fees).

## Shape of a draft

A leave-behind or pitch note is a surface like any other, and the same holistic bar applies
(`docs/design/principles.md` §10–11, in prose form): one argument per artifact, stated in the
first lines — the founder's reader decides in the first ten seconds whether to keep reading;
answer the questions the reader predictably arrives with (what does it cost, what happens if I
leave, what do you want from me) where they arise instead of making them hunt; end on **one**
clear ask, never a menu of asks; and cut until removing the next line would lose the argument.
A one-pager that needs its sections explained is a template filled in, not a draft worth
handing over.

## Claims policy, applied to private collateral

Everything in `marketing-page`'s claims policy applies here, plus:

- **Shipped-only, no fabricated proof** — a case study is drafted from a real shop's real words
  and real numbers, never invented or extrapolated ahead of the interview. Until a pilot exists,
  the case-study *template* (the question list) is the only artifact that can exist — not a filled
  example.
- **The price never appears as a literal figure** — reference `earlyAccessPrice` in
  `src/lib/marketing.ts` by name, the same as any other doc (`marketing.md`: "never restate the
  figure in prose, docs, JSON-LD literals, or images").
- **Service commitments need product-owner sign-off**, same as the `SwitchingConcierge` claim —
  the concierge-migration offer, the weekly call, the shared founder thread, and the two-year price
  lock are already authorized (rollout.md, H-12); a new commitment beyond what's already published
  needs the same sign-off before it goes in a draft.
- **Biography is a claim like any other** — the founder's credentials in a pitch note are limited
  to what `marketing.md`'s About-page confirmation list already authorizes. Never infer or embellish.
- **Competitor statements need documented sources**, same as a switching guide — a DEMA/media pitch
  that references EVE's acquisition or DiveShop360's pricing cites `competitive-strategy.md` or
  `competitive-analysis.md`, never speculates.

## Where the artifacts live

| Artifact | File | Feeds |
| --- | --- | --- |
| Design-partner one-pager (the offer, in leave-behind form) | `docs/product/stakeholders/design-partner-one-pager.md` | Phase 1 recruiting conversations |
| Case-study interview questions | `docs/product/stakeholders/case-study-interview-template.md` | Phase 1 exit criterion, Phase 2 founding-shop references |
| Per-stakeholder prep (DEMA, dive media, Capterra) | `docs/product/stakeholders/commercial-and-industry.md` | Phase 2–3 conversations |
| Pilot-recruiting kit index (what the founder carries into Phase 1) | `docs/product/pilot-kit/README.md` | Phase 1 recruiting |
| Ten-shop Florida call list — **template only**, rows researched by hand | `docs/product/pilot-kit/florida-call-list.md` | Phase 1 recruiting |
| First-call script (discovery written to disconfirm, not to sell) | `docs/product/pilot-kit/first-call-script.md` | Phase 1 recruiting; persona reality-check |

**Never invent a prospect.** A call list, a target-media list, or a DEMA meeting list may carry
research criteria, columns, and the public directories to source from — never a fabricated shop
name, owner, phone number, or address. A plausible-looking row gets dialled.

A new recurring outreach need (a cold-email template for the EVE pool, a DEMA meeting-request
note, an ad-copy draft for the switching funnel) gets its own file here, added to this table and
cross-linked from `commercial-and-industry.md`'s "what to have prepared" list for that stakeholder
— don't let a one-off draft live only in a chat transcript.

## Verify

1. Every fact traces to `rollout.md`, `human-decisions.md`, or an authorized `marketing.md` claim —
   if it doesn't, flag it as needing product-owner sign-off rather than drafting it as settled.
2. `pnpm check:docs` — internal links resolve.
3. For anything persuasion-shaped (the one-pager, a pitch note): launch `conversion-reviewer` —
   it reviews private sales collateral the same way it reviews public pages, and is barred from
   suggesting a fix that would violate the claims policy.
4. Safety-adjacent claims (readiness, manifest, medical, cert, nitrox) in any pitch get
   `dive-domain-expert` review, same as anywhere else.
5. Never mark a `commercial-and-industry.md` "what to have prepared" item done from drafting alone
   — prep is done when the artifact exists; the conversation, the send, and the outcome are the
   founder's to run and record in `human-decisions.md` / `rollout.md`, per the stakeholder
   playbooks' division of responsibility.
