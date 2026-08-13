# FU-20260813-per-location-price-has-no-location — Decide what a two-location shop actually buys, because the price already says "per location"

- **Status:** Open
- **Raised:** 2026-08-13 — branch `claude/follow-up-decisions-xgj9o3`, a sweep of the codebase for
  policy questions the product currently answers by accident rather than by decision.
- **Kind:** question
- **Effort:** L
- **Touches:** `src/i18n/locales/en-US/diver.json`, `src/i18n/locales/es-ES/diver.json`,
  `src/lib/marketing.ts`, `src/app/pricing/page.tsx`, `docs/product/marketing.md`

## What I noticed

DiveDay publishes a per-location price for a product that has no concept of a location, and the same
repository elsewhere forbids saying anything about multi-location operation.

Three statements, all currently true:

- **The price is per location.** `src/i18n/locales/en-US/diver.json` renders the pricing cadence as
  "per location / month", and the pricing FAQ answers the billing question with "Month to month, per
  location. Cancel whenever you like…". Both are live on `/pricing`.
- **Multi-location claims are banned.** `docs/product/marketing.md`'s claims policy states that
  multi-location operation is out of scope and must not be claimed. The Florida call list repeats it
  as an explicit "unclaimable" for anyone on a sales call.
- **The product has no location.** A `shops` row is a shop: one slug, one timezone, one diver
  database, one staff list (`src/db/schema.ts`). `docs/product/features/roadmap.md` calls
  multi-location operating views unbuilt, and the boat-resource ADR
  (20260804-boat-resource-model) deliberately declines to spend a location dimension.

A shop with two storefronts therefore has one route: two entirely separate DiveDay shops. Two slugs,
two logins, two sets of staff, two diver databases — and a regular who dives out of both is two
unrelated `people` rows, with their certifications verified twice and their waiver signed twice.
That may be a perfectly acceptable answer. It is not an answer anybody wrote down, and it is not the
answer a buyer reading "per location" would predict: that phrasing implies locations are a thing the
product knows about and prices, in the way a per-seat price implies seats exist.

H-12 is where this should have landed. Its question text names "multi-location policy" as part of
what the row covers. Its recorded outcome — closed 2026-07-24, $99 flat per location, then amended
several times through 2026-08-12 — settles the price, the cadence, the term, the support promise and
the trial, and never returns to the multi-location half of its own question.

## Why it isn't already done

Because the cheap fix and the honest fix are different sizes, and choosing between them is a
commercial call.

Rewording `/pricing` is an afternoon. Building a location dimension is a large feature that touches
tenancy, the staff destination registry, the diver record, and every scoped query in `src/db` — and
the boat-resource ADR already looked at an adjacent dimension and deliberately deferred it, so
reversing that is not an engineering decision.

There is also a live commercial argument for keeping the words exactly as they are. "Per location"
prices a two-shop operator at $198 rather than $99 and sets that expectation before anyone signs,
which is much easier than raising it later. If that is the intent, the phrase is doing real work and
should stay — it just needs a plain sentence next to it saying what a second location gets you.

I am wary of one specific wrong turn: quietly rewording the price to "per shop" to remove the
contradiction. That reads as tidier and is a pricing change made by an agent to resolve a
documentation inconsistency, which is exactly backwards.

**Recommendation: answer the words now, leave the feature to the roadmap.** Keep per-location
pricing, and add one honest line — a second location is a second DiveDay shop, billed separately,
with its own schedule and its own diver records. That closes the published contradiction today
without pre-committing to a feature.

## Proposed change

The owner picks one of three:

1. **Two shops, priced separately (recommended).** No product change. `/pricing` gains a plain
   sentence and a matching FAQ entry saying what a second location means in practice — separate
   schedule, separate divers, separate login — and `docs/product/marketing.md`'s claims policy is
   amended so this sentence is explicitly *allowed* rather than caught by the existing ban. Copy
   lands in both locale bundles; the pricing constants in `src/lib/marketing.ts` do not move.
2. **A real location dimension.** A roadmap item with its own ADR, not something to start from a
   follow-up. It would need to state, at minimum, how a diver is shared across locations, whether
   staff roles are per-location, and what a manifest at one location shows about the other. Read the
   boat-resource ADR's alternatives section first — it declined a `location`/marina dimension with
   reasons that apply directly.
3. **Retire per-location pricing.** Flat per shop, `/pricing` reworded. Simplest to say and a real
   revenue decision for any multi-site prospect, so it is the owner's alone.

Whichever is chosen, record it on the H-12 row in `docs/product/human-decisions.md` as the answer to
the multi-location half of that row's own question, so the next person reading it can see the half
was answered rather than dropped.

Do **not** change the published figure or the cadence as a side effect of clearing this up.

## Prompt

```text
Resolve the published contradiction around per-location pricing: /pricing charges "per location /
month" while the claims policy forbids multi-location claims and the product has no location concept
at all.

Read first:
  - docs/product/follow-ups/FU-20260813-per-location-price-has-no-location.md (the full write-up;
    its "Proposed change" section lists the three answers and what each costs)
  - src/i18n/locales/en-US/diver.json — search for "per location / month" and the pricing FAQ answer
  - docs/product/marketing.md — the claims policy, including the multi-location ban
  - src/lib/marketing.ts — the pricing constants, which are the source of truth for the figure
  - the H-12 row in docs/product/human-decisions.md, whose question names "multi-location policy"
    and whose recorded outcome never answers that half
  - docs/architecture/decisions/20260804-boat-resource-model.md, alternatives section, which already
    declined a location/marina dimension with reasons that apply here
  - the marketing-page and i18n-copy skills

The constraint: this is a COMMERCIAL decision, not a documentation cleanup. Do not reword the price
from "per location" to "per shop" to make the inconsistency go away — that is a pricing change, and
it belongs to the product owner. Ask which of the three answers they want before writing anything.

If the recommendation is taken (keep per-location pricing, explain what a second location means),
done means: one plain sentence and a matching FAQ entry on src/app/pricing/page.tsx saying a second
location is a second DiveDay shop with its own schedule, divers and login; the claims policy in
docs/product/marketing.md amended so that sentence is explicitly allowed; copy in BOTH locales under
src/i18n/locales/; the figure and cadence in src/lib/marketing.ts unchanged.

Run pnpm check, and pnpm check:copy in particular since this touches marketing copy. Look at
/pricing in light and dark before calling it done.

Delete docs/product/follow-ups/FU-20260813-per-location-price-has-no-location.md as part of the
change.
```
