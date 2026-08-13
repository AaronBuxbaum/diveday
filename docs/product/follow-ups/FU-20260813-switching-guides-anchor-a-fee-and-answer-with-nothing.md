# FU-20260813-switching-guides-anchor-a-fee-and-answer-with-nothing — Decide whether a switching guide may point at `/pricing`

- **Status:** Open
- **Raised:** 2026-08-13 — the `/switching` design overhaul (branch `claude/design-switching-pages`); found by the `conversion-reviewer` pass on `/switching/fareharbor` and `/switching/spreadsheet`
- **Kind:** question
- **Effort:** S
- **Touches:** `src/app/switching/_components/guide.tsx`, `src/i18n/locales/en-US/diver.json`, `src/i18n/locales/es-ES/diver.json`, `docs/product/marketing.md`

## What I noticed

The two booking-channel guides argue hard on money and then leave the reader holding it.
`/switching/fareharbor` tells a shop owner that FareHarbor "takes a fee on every booking — added to
your guest's checkout price — for as long as you use it… (third parties report around 6%)", and
that DiveDay will let them "leave the per-booking fee behind". `/switching/rezdy` does the same
with "a monthly subscription plus a cut of every online booking (3% on its current published
pricing)".

The very next thought a shop owner has is "and I pay you what?" — and no switching page answers it
or offers a door to the answer. There is no link to `/pricing` anywhere in the guide body: the only
route is the marketing nav's "Pricing" tab at the top of the page, which by the time the reader
reaches the fee paragraph is several thousand pixels above them (these guides run 6,000–8,000px
tall). The two exits the page does offer at that moment are "Try the live demo" and "Start a
trial", both of which ask for a commitment before answering the question they just provoked.

The relationship currently runs one way only: `docs/product/marketing.md` has `/pricing` carry the
fee anchor and link *back* to the guide that carries the citation (`marketing.pricing.feeAnchor.*`
→ `/switching/rezdy`, `/switching/fareharbor`). Nothing points forward.

## Why it isn't already done

It is a positioning call, not a design one, and it sits on two live constraints I should not decide
alone:

1. The claims policy is explicit that "the price renders only from `src/lib/marketing.ts`" and must
   never be restated in prose. Any fix has to be a *link*, never a number or a paraphrase of the
   model ("one flat price", "never a cut of a booking") — and whether even the model may be
   alluded to on a guide is the product owner's call.
2. `/pricing` was being actively rewritten in a parallel PR while this branch was open, so adding a
   cross-link from five guides into a page mid-redesign risked pointing at a section that no longer
   exists.

There is also a real design cost. The closing band already carries three controls (demo, trial,
"Other switching guides →"); a fourth link there is exactly the row of same-weight controls
`docs/design/principles.md` §8 forbids. So the fix is not "add a link to the CTA band" — it needs a
place chosen on purpose.

## Proposed change

Decide, then do one of:

- **Yes, link it.** Add one quiet text link, and only one, at the moment the objection lands —
  under the coexist section's leave-path box (`guide.tsx`'s `coexist.replace` render site on
  `src/app/switching/[competitor]/page.tsx`), where the page has just said the fee stops. New
  shared key `switching.common.seePricing` in both locales, worded as a destination and not a
  claim ("See what DiveDay costs →"). Leave the closing band alone.
- **No, don't.** Say so in `docs/product/marketing.md`'s switching-guide section in one sentence,
  so the next `conversion-reviewer` pass stops re-raising it and the next agent doesn't add it.

What I am **not** proposing: putting a figure, a comparison, or any savings arithmetic on a
switching guide. The claims policy rules all three out and the fee-anchor rule already bounds what
`/pricing` itself may say.

## Prompt

```text
Read docs/product/marketing.md (the claims policy section on price, and the switching-guide section
near the end), then src/app/switching/[competitor]/page.tsx and
src/app/switching/_components/guide.tsx, then src/app/pricing/page.tsx to see how the fee anchor
links back to the guides today.

The question: /switching/fareharbor and /switching/rezdy anchor hard against an incumbent's
per-booking fee and then give the reader no way to find out what DiveDay costs except the nav tab
thousands of pixels above them. Decide whether a switching guide may carry a forward link to
/pricing.

If yes: add exactly ONE text link, under the coexist leave-path box on the incumbent guide (the
`guide.coexist.replace` block in src/app/switching/[competitor]/page.tsx) — not in the closing CTA
band, which already carries three controls and would break principles.md §8's one-primary rule. The
label is a new `switching.common.seePricing` key added to BOTH src/i18n/locales/en-US/diver.json and
src/i18n/locales/es-ES/diver.json in the same change (pnpm check:locale fails on a key present in
one). It must be a destination, never a claim: no figure, no "flat price", no comparison — the price
renders only from src/lib/marketing.ts.

If no: add one sentence to docs/product/marketing.md's switching-guide section recording the
decision and why, so this stops being re-raised.

Done when: the decision is recorded in docs/product/marketing.md either way; pnpm check is green;
if the link shipped, `E2E_WORKERS=1 pnpm e2e e2e/marketing.spec.ts --reporter=line` passes (it
asserts the exact control counts on these pages) and the switching-fareharbor / switching-rezdy
visual captures are triaged in the PR. Delete
docs/product/follow-ups/FU-20260813-switching-guides-anchor-a-fee-and-answer-with-nothing.md as
part of the change.
```
