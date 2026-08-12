# FU-20260812-no-privacy-or-terms-page — Publish a privacy policy and terms, because the site that stores divers' medical flags currently publishes neither

- **Status:** Open
- **Raised:** 2026-08-12 — assessing paid acquisition channels (`docs/product/assessments/paid-acquisition-assessment.md`); every ad platform requires a published privacy policy, and checking whether DiveDay had one found that it does not
- **Kind:** risk
- **Effort:** M
- **Touches:** `src/app/`, `src/components/MarketingFooter.tsx`, `src/i18n/locales/en-US/diver.json`, `src/i18n/locales/es-ES/diver.json`, `scripts/route-coverage.json`, `docs/product/human-decisions.md`

## What I noticed

There is no `/privacy`, no `/terms`, and no legal route anywhere under `src/app/` — the public page
list is `/`, `/product`, `/pricing`, `/about`, `/onboard`, `/sign-in`, `/forgot-password`, and the
`/switching/*` family. `MarketingFooter.tsx` links to none, and the only occurrence of the word
"privacy" in any user-facing string is `seatClaim.privacyNote`, which is a one-line reassurance on
the seat-claim page about who can see a claimed seat.

Two separate consequences, and the second is the one that matters:

**The mechanical one.** Google Ads and Meta both effectively require a published privacy policy for
a site that collects personal data, and `/onboard` creates an account from an email address. Any
paid channel is blocked on this before a single ad can be reviewed. That is how this was found, but
it is the smaller half.

**The real one.** DiveDay's whole positioning is that it is a safe custodian — the export ZIP, the
shop's own Stripe account, the append-only roll-call ledger. The product stores signed waivers,
medical answers, and certification evidence for other people's customers. A shop owner evaluating it
at 11pm (persona 13, Victor — "burned by lock-in before") can read the pricing FAQ's answer about
leaving, and cannot read a single sentence about what DiveDay does with his divers' medical flags,
how long they are kept, or who can reach them. `docs/product/marketing.md`'s claims policy says the
pages are "a truthful sales surface for the product that exists today"; the absence here is not a
false claim, but it is the one question a careful buyer asks that the site cannot answer at all.

Related open rows this touches but does not resolve: **H-02** (retention/deletion policy for waivers
and medical flags — currently defaulting to indefinite on medical data), **H-09** (the two-paragraph
consent/copy policy for sending), and **H-18** (the entity decision — a privacy policy names a legal
entity, and `marketing.md` says the corporate entity stays off the pages until that closes).

## Why it isn't already done

Out of the scope I was given, which was an advertising assessment, not a legal surface. And it is
genuinely not a drive-by: a privacy policy is not prose an agent should invent. It states what data
is collected, where it is processed (Neon, US-East), who it is shared with (Stripe, AWS SES/SNS, Meta
Cloud API for WhatsApp, Vercel, CloudWatch RUM), how long it is kept (`RETENTION_DAYS` in
`src/lib/retention.ts` is the current answer for the append-only tables, and it is HD-11's call), and
what rights a data subject has. Several of those are open human decisions, and getting one wrong in
public is worse than the current silence.

There is also a real sequencing question I should not answer alone: whether this waits for the H-01–H-03
counsel engagement that `rollout.md` puts on the critical path anyway — the same lawyer reviewing the
waiver text is the natural author of the retention statement — or ships first as a plain-language
statement of current behaviour, with counsel reviewing it alongside everything else. My recommendation
is the second: current behaviour is knowable today from the code, and a truthful description of what
the system does now is not a legal opinion. But it is the product owner's call, not mine.

## Proposed change

1. Two routes, `src/app/privacy/page.tsx` and `src/app/terms/page.tsx`, each with `loading.tsx` and
   `export const instant = true` per the standing rule, both listed in `scripts/route-coverage.json`.
2. Words in both locale bundles (`marketing.privacy.*`, `marketing.terms.*`) — never inline. Note the
   scale of this: a privacy policy is a lot of prose and it lands in **every** locale in the same
   change, which `pnpm check:locale` enforces. Budget for that or scope the first version tightly.
3. Footer links in `MarketingFooter.tsx`, and a link from `/onboard`'s reassurance card, which is
   where the question is actually being asked.
4. Set `summary` rather than `summary_large_image` on both if they ship without a link-preview image,
   per the Twitter-card policy in `marketing.md`.
5. Record in `human-decisions.md` which of H-02/H-09/H-18 this consumed and which it left open —
   this should narrow those rows, not silently pre-empt them.

I am specifically **not** proposing: inventing a retention period that contradicts
`src/lib/retention.ts`, naming a legal entity before H-18 closes, or copying a generic SaaS privacy
template — the interesting content here is medical and certification evidence belonging to a third
party (the shop's diver), which a boilerplate template will not describe correctly.

## Prompt

```text
Read docs/product/human-decisions.md rows H-02, H-09 and H-18; src/lib/retention.ts (RETENTION_DAYS);
src/app/observability-client.tsx and src/app/observability.ts (what telemetry leaves the app, and the
capability-URL redaction); and docs/product/marketing.md's claims policy and Twitter-card policy.

DiveDay has no /privacy and no /terms route and no footer link to either, while storing signed
waivers, medical answers and certification evidence belonging to shops' divers. Add both pages.

Constraints that make this non-obvious:
- All copy goes in src/i18n/locales/<locale>/diver.json under marketing.privacy.* and
  marketing.terms.*, in EVERY locale in the same change (pnpm check:locale enforces coverage). This
  is a lot of prose — scope the first version to what is true today rather than a comprehensive
  policy.
- Describe only current, verifiable behaviour: read the sub-processors off the code (Neon US-East,
  Stripe Connect, AWS SES/SNS, Meta Cloud API for WhatsApp, Vercel Analytics, CloudWatch RUM), and
  the retention windows off src/lib/retention.ts. Do not invent a retention period for medical data —
  H-02 is open; state what the system does now and say the policy is under review if that is true.
- Do not name a legal entity: H-18 is open and marketing.md keeps the corporate entity off the pages
  until it closes.
- Each page needs a loading.tsx and `export const instant = true`, plus a row in
  scripts/route-coverage.json.
- Set twitter card to `summary` if the pages ship without a link-preview image.
- Link both from src/components/MarketingFooter.tsx and from the /onboard reassurance card.

Done when: pnpm check green, pnpm check:locale green, pnpm e2e marketing.spec.ts green, both pages
looked at in light and dark on phone and desktop, and human-decisions.md records which of H-02/H-09/
H-18 this narrowed and which stay open. Get a security-reviewer pass on the data-handling
description before merge. Delete docs/product/follow-ups/FU-20260812-no-privacy-or-terms-page.md as
part of the change.
```
