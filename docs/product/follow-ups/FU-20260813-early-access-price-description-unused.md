# FU-20260813-early-access-price-description-unused — `earlyAccessPrice.descriptionKey` is rendered nowhere; drop it from the registry and both bundles

- **Status:** Open
- **Raised:** 2026-08-13 — branch `claude/design-pricing-page`, after the pricing page's bordered plan card was replaced by the price-as-hero composition
- **Kind:** cleanup
- **Effort:** S
- **Touches:** `src/lib/marketing.ts`, `src/i18n/locales/en-US/diver.json`, `src/i18n/locales/es-ES/diver.json`

## What I noticed

`earlyAccessPrice` in `src/lib/marketing.ts` declares a `descriptionKey`
(`marketing.price.description`, "One clear price for the whole shop — every role, every workflow,
no per-seat math."). Nothing renders it any more.

It had exactly one consumer: the bordered plan card on `/pricing`, which printed it under the
figure. That card is gone — the price is now the page's hero and the sentence beneath it is
`marketing.pricing.heroDescription`, which says something different and page-specific. The
homepage's closing band uses `earlyAccessPrice.price` and `cadenceKey` and never touched
`descriptionKey`.

So the key is dead in both locale bundles and the field is dead on the registry, and neither
`pnpm check:locale` nor `pnpm check:copy` notices: coverage checks that every key exists in every
locale, not that every key is read.

Nothing is broken today. The cost is that the next person to render "the plan's description" picks
up a string that duplicates the current `heroTitle` ("One flat price for the whole shop.") and puts
near-identical copy on the screen twice.

## Why it isn't already done

`src/lib/marketing.ts` was read-only for my unit — it is a shared registry the other marketing-page
scopes render from, and deleting a field from it while a sibling branch may be adding a consumer is
how two sessions collide. It wants doing once, deliberately, after the marketing-surface work has
landed.

There is also a real second option worth a moment's thought before deleting: give the field a
consumer instead. The homepage's price band currently renders `marketing.home.priceLine` and could
arguably use the registry's own description. I do not recommend it — the two say the same thing and
the homepage's version interpolates the figure, which is the better shape — but whoever picks this
up should look at `src/app/page.tsx` around the closing band before reaching for delete.

## Proposed change

Delete `descriptionKey` from the `earlyAccessPrice` object **and** from its
`satisfies` type in `src/lib/marketing.ts`, then delete `marketing.price.description` from
`src/i18n/locales/en-US/diver.json` and `src/i18n/locales/es-ES/diver.json` in the same change (a
key present in one bundle and not the other fails `pnpm check:locale`).

Not proposed: deleting the other `marketing.price.*` entries. `item1`–`item6` are the pricing
hero's "What the price covers" list and `name`/`cadence` are read by both `/` and `/pricing`.

## Prompt

```text
In the DiveDay repo, `earlyAccessPrice` in src/lib/marketing.ts carries a `descriptionKey`
(`marketing.price.description`) that no surface renders any more — its only consumer was the
bordered plan card on /pricing, which was replaced by a price-as-hero composition. Remove it.

Read first: src/lib/marketing.ts (the `earlyAccessPrice` block and its `satisfies` type),
src/app/pricing/page.tsx and src/app/page.tsx (the two consumers of the registry — confirm for
yourself that neither reads `descriptionKey`; `grep -rn descriptionKey src/` should find only the
declaration and the type).

Before deleting, glance at the homepage's closing price band in src/app/page.tsx: it renders
`marketing.home.priceLine` with the figure interpolated. Confirm you agree the registry's
description is redundant rather than a better source for that line; if you disagree, wire it up
there instead of deleting and say so in the PR.

Do this: drop `descriptionKey` from the object and from the `satisfies` type in
src/lib/marketing.ts, and delete the `"description"` entry under `marketing.price` from BOTH
src/i18n/locales/en-US/diver.json and src/i18n/locales/es-ES/diver.json — a key in one bundle and
not the other fails pnpm check:locale.

Done means `pnpm check` is green (typecheck proves nothing still reads the field, check:locale
proves the bundles still match). No visual change is expected, so no new captures are needed.

Delete docs/product/follow-ups/FU-20260813-early-access-price-description-unused.md as part of the
change.
```
