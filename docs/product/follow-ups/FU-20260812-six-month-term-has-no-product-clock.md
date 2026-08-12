# FU-20260812-six-month-term-has-no-product-clock — Decide what the hand-sold six-month free term looks like inside the product

- **Status:** Open
- **Raised:** 2026-08-12 — adding `docs/product/pilot-kit/cold-email-template.md`, which states the term to a stranger in writing
- **Kind:** question
- **Effort:** M
- **Touches:** `src/lib/trial.ts`, `src/i18n/locales/en-US/staff/settings.json`, `src/app/pricing/page.tsx`, `docs/product/human-decisions.md`, `docs/product/pilot-kit/cold-email-template.md`

## What I noticed

H-12's 2026-08-12 amendment authorizes six free months for shops the founder recruits by hand. The
product knows nothing about it.

`TRIAL_DURATION_DAYS = 21` (`src/lib/trial.ts:21`) is the only free-period concept in the codebase,
it is measured from `shops.created_at`, and there is no column, flag, or per-shop override anywhere
near it. So a shop that was told "six months" and signs itself up reads its own Settings on day 22
and finds the trial-ended card — `staff/settings.json`'s "Your trial ended {endDate}. Everything
you've set up keeps working." Expiry is soft, so nothing breaks; what breaks is that DiveDay's own
screen contradicts, in writing, the term the founder gave them three weeks earlier. `/pricing` says
three weeks too, which is what any recipient who forwards the email and clicks through will read.

Second, smaller, and entirely unresolved: **nobody has decided when the six months starts.** Signup,
concierge import, and first real trip are all defensible and they can be weeks apart. The email
currently says "if it ever came to that", which dodges it. The first shop to ask a direct question
will get whatever answer is improvised on the call, and the second shop will get a different one.

## Why it isn't already done

Both halves need a product-owner call I can't make. Whether the trial constant becomes per-shop
state is a schema question with a pricing decision underneath it (H-12 still lists billing cadence
and the contract flow as open, and there is no paid/entitlement state in the schema at all yet), and
picking the start event is a commercial choice, not an implementation detail.

It is also genuinely reasonable to do nothing for now: at a hand-countable number of shops the
founder can honor the term from memory, and building entitlement state before a single shop has
paid is the kind of speculative machinery this repo deliberately avoids. The cost of that choice is
just that it stays undocumented and answered differently each time — which is what this entry is
for.

## Proposed change

Pick one, in the order I'd recommend:

1. **Write the term down and leave the code alone.** Decide the start event, put one sentence in
   H-12 naming it, and make the cold-email template's clause say it the same way every send. Costs
   nothing, closes the "second shop gets a different answer" problem, leaves the day-22 card wrong.
2. **Add a per-shop free-until date.** One nullable `shops.free_until` timestamp that
   `trialEndsAt()` prefers when set, so Settings and `/pricing` tell a hand-sold shop the truth.
   Smallest change that removes the contradiction; still no entitlement model, still soft expiry.
3. **Reconcile the published trial length upward.** Only if the six months is meant to become the
   standard offer rather than a founder-sold one, which is a different decision than the one H-12
   recorded.

I am specifically **not** proposing a paid/entitlement state, a billing integration, or a
self-serve path that grants the six months — all three are ahead of H-12's open cadence/contract
decision.

## Prompt

```text
Read docs/product/human-decisions.md's H-12 row (the 2026-08-12 amendment at its end),
src/lib/trial.ts, src/i18n/locales/en-US/staff/settings.json's trial keys, and
docs/product/pilot-kit/cold-email-template.md's "Flagged" section.

The founder is authorized to sell a six-month free term by hand, but the product has only a fixed
21-day trial measured from shops.created_at, so a shop told "six months" sees "Your trial ended"
in Settings on day 22, and nobody has decided whether the six months starts at signup, at
concierge import, or at the shop's first real trip.

This needs a product-owner answer before code. Ask which of these they want:
  (1) document the start event in H-12 and change no code;
  (2) add a nullable shops.free_until that trialEndsAt() prefers when set, so Settings and
      /pricing tell a hand-sold shop the truth (schema-change skill; soft expiry stays);
  (3) raise the published trial length, which is a different commercial decision.

Under (1): edit H-12 and the cold-email template's offer clause so both name the same start event,
run pnpm check:docs.
Under (2): follow the schema-change skill, keep expiry soft, add unit tests for a shop with and
without free_until, update every surface that renders the trial state, and run pnpm check.
Do not build paid/entitlement state or a self-serve path that grants the term — both are ahead of
H-12's still-open billing-cadence and contract decisions.

Done when the chosen option is implemented, H-12 records the start event in words, and
docs/product/pilot-kit/cold-email-template.md's "Flagged" section no longer lists the resolved
items. Delete docs/product/follow-ups/FU-20260812-six-month-term-has-no-product-clock.md as part
of the change.
```
