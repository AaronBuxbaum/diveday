# FU-20260812-pricing-has-no-product-visual — Give `/pricing` something to look at, and decide the homepage four-card band on evidence

- **Status:** Open
- **Raised:** 2026-08-12 — the marketing review on `claude/marketing-pages-review-qzh3gd` (PR #491),
  which put `ImportPreviewFallback` on `/switching` and the homepage records band but left `/pricing`
  untouched
- **Kind:** improvement
- **Effort:** M
- **Touches:** `src/app/pricing/page.tsx`, `src/app/page.tsx`,
  `src/components/MarketingScreenFallbacks.tsx`, `src/i18n/locales/en-US/diver.json`,
  `src/i18n/locales/es-ES/diver.json`, `docs/product/marketing.md`

## What I noticed

**`/pricing` has no product visual anywhere on the page.** Scroll it top to bottom: an eyebrow, the
price card, the fee-anchor rows, four summary cards, eleven FAQ rows. The fee anchor is genuinely
strong — concrete, cited, and it puts the flat number beside the per-booking model it replaces —
but the page's other big claim, "you can leave with your records any day", is the FAQ row
`marketing.pricing.faq.dataIfNotWorking` and it is a paragraph. The export ZIP is a real screen
(Settings → Data export), so the page is arguing in words about something the repo can show. This
is now the only marketing page with nothing to look at.

**The homepage's four-card "whole shop, one place" band is still four assertions with no evidence.**
It renders `FeatureGroupsGrid` at `featuresPerGroup={1}`, so each card is one summary sentence. It
sits between the moments section (two real mockups) and the records band (which, as of PR #491, has
two more), so it is now the only band on that page that asks the reader to take a claim on trust.

## Why it isn't already done

`/pricing` was scope: PR #491 built one new mockup and spent it where the gap was widest — the
switching surface had *zero* visuals and its whole promise is "exactly what comes across". A second
mockup plus bilingual copy plus a baseline is its own change.

The homepage band is a genuine open question rather than unfinished work. The band exists to give
breadth in one glance and to hand the reader to `/product`; replacing it with imagery could cost
that breadth, and the honest answer depends on whether the `home-mid` door beneath it is converting.
That is a judgment about what the page's midpoint is *for*, and it should be made against the funnel
pair rather than taste. PR #491 deliberately left it alone and said so.

## Proposed change

For `/pricing`: add an `ExportBundleFallback` to `src/components/MarketingScreenFallbacks.tsx`
mirroring the real Settings → Data export surface the way `ImportPreviewFallback` mirrors the import
wizard — the documented CSV file list, photos as real files, the download control. Render it beside
the data-exit FAQ, or as a band between the fee anchor and the included list. Follow the rule in
`docs/product/marketing.md` ("A mockup is a claim, so it mirrors a real screen element for
element"): read `src/db/export.ts` and the export page before drawing anything, and keep the
unflattering parts.

For the homepage: read the `demo_entered` / `trial_started` pair for `home-mid` first
(`docs/product/marketing.md`, "Measuring which story converts"). If that door converts, the band is
working and the right change is small — a visual beside the four cards, not instead of them. If it
does not, the band is a candidate for replacement by a third moment card in the section above,
which is the composition already working on that page. **If there is no funnel data to read yet,
leaving the band alone and saying so is a complete answer.**

**Not proposed:** a fourth rendering density for `productFeatureGroups`. There are three already
(`1`, `4`, and the full `productCapabilityIndex`), and the rulebook warns against another copy of
the same inventory.

## Prompt

```text
/pricing is the last marketing page with no product visual, and the homepage's four-card band is
still four assertions. Read docs/product/follow-ups/FU-20260812-pricing-has-no-product-visual.md,
then docs/product/marketing.md (especially "Product visuals" and the show-before-describing bullet
in Voice), then the .claude/skills/marketing-page skill.

Do the /pricing half first, since it needs no judgment call: add an `ExportBundleFallback` to
src/components/MarketingScreenFallbacks.tsx that mirrors the real Settings -> Data export surface
element for element. Read src/db/export.ts and src/app/shop/[shopSlug]/settings/export/ before
drawing it, and keep the parts that make DiveDay look less capable — that is what makes a mockup a
claim rather than an illustration. Render it on src/app/pricing/page.tsx beside the data-exit FAQ
(`marketing.pricing.faq.dataIfNotWorking`) or as a band between the fee anchor and the included
list; sketch both in prose first and pick the one the content shapes.

Constraints that make this non-obvious: every word lives in src/i18n/locales/<locale>/diver.json
and BOTH locales change in the same commit (pnpm check:locale fails otherwise; read
src/i18n/locales/es-ES/README.md for register and terminology first — a previous pass wrote "buzo"
where that bundle says "buceador" throughout). The price figure may never be restated outside
`earlyAccessPrice` in src/lib/marketing.ts — not in the mockup, not in alt text. Semantic tokens
only. Sample names and raw column headers are the only i18n-exempt literals and need the comment
saying so.

For the homepage half, do NOT redesign on instinct. Read the funnel-tag guidance in
docs/product/marketing.md ("Measuring which story converts") and state in the PR what evidence you
have about the `home-mid` door before touching the band. If there is none to read, leave it and say
so — that is a complete answer, not a punt.

Done means: pnpm check green; `pnpm e2e marketing.spec.ts --reporter=line` green with any pinned
assertions updated deliberately; screenshots of /pricing in light and dark, desktop and phone,
actually looked at; visual diffs triaged and explained in the PR (the /pricing baselines will move);
and docs/product/marketing.md's "Product visuals" table updated in the same PR. Delete
docs/product/follow-ups/FU-20260812-pricing-has-no-product-visual.md as part of the change.
```
