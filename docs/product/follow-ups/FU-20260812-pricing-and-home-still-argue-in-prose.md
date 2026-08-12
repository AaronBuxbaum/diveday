# FU-20260812-pricing-and-home-still-argue-in-prose — Give `/pricing` and the homepage's four-card band something to look at

- **Status:** Open
- **Raised:** 2026-08-12 — the marketing review on `claude/marketing-pages-review-qzh3gd`, which added
  `ImportPreviewFallback` to `/switching` and the captain phone to `/about` but stopped there
- **Kind:** improvement
- **Effort:** M
- **Touches:** `src/app/pricing/page.tsx`, `src/app/page.tsx`,
  `src/components/MarketingScreenFallbacks.tsx`, `src/lib/marketing.ts`,
  `src/i18n/locales/en-US/diver.json`, `src/i18n/locales/es-ES/diver.json`,
  `docs/product/marketing.md`

## What I noticed

Two surfaces still make their argument entirely in prose, and both are places a buyer is close to
deciding.

**`/pricing` has no product visual anywhere on the page.** Scroll it top to bottom: an eyebrow, a
price card, the fee-anchor rows, four summary cards, eleven FAQ rows. The fee anchor is genuinely
strong — it is concrete, cited, and it puts the flat number next to the per-booking model it
replaces — but the page's other big claim, "you can leave with your records any day", is the FAQ
row `marketing.pricing.faq.dataIfNotWorking`, and it is a paragraph. The export ZIP is a real
screen (Settings → Data export) and the importer's preview is now a real mockup, so the page is
arguing in words about something the repo can already show.

**The homepage's "The whole shop, one place" band is four assertions with no evidence.** It renders
`FeatureGroupsGrid` at `featuresPerGroup={1}`, so each of the four cards is one summary sentence —
"A live schedule divers book themselves", "Waivers signed from home", and so on. It sits directly
below the moments section, which is the page's best show-don't-tell (two real mockups), and the
contrast is visible: the reader goes from looking at the product to reading claims about it.

## Why it isn't already done

Scope. The review I was given was copy, structure, and the apologetic register; adding a second new
mockup component plus its bilingual copy plus a visual-spec capture is its own change, and the one
mockup I did add (`ImportPreviewFallback`) went where the gap was widest — `/switching` had *zero*
visuals and its entire promise is "we show you exactly what comes across".

There is also a real design question underneath the homepage half that I did not want to answer
unilaterally: the four-card band exists to give breadth in one glance and to hand the reader off to
`/product`. Replacing it with imagery could cost the breadth. That is a judgment about what the
homepage's midpoint is *for*, and it deserves a look at the funnel tags (`home-mid` fires from the
CTA directly beneath it) rather than a guess.

## Proposed change

For `/pricing`: add an `ExportBundleFallback` to `src/components/MarketingScreenFallbacks.tsx`
mirroring the real Settings → Data export surface the way `ImportPreviewFallback` mirrors the
import wizard — the file list with its documented CSV names, the photos-as-real-files line, the
download control. Render it beside the data-exit FAQ, or as a small band between the fee anchor and
the included list. Follow the rule in `docs/product/marketing.md` ("A mockup is a claim, so it
mirrors a real screen element for element"): read `src/db/export.ts` and the export page before
drawing anything, and keep the unflattering parts.

For the homepage: measure before redesigning. Read the `demo_entered` / `trial_started` pair for
`home-mid` first (`docs/product/marketing.md`, "Measuring which story converts"). If that door is
converting, the band is doing its job and the right change is small — a mockup beside the four
cards rather than instead of them. If it is not, the band is a candidate for replacement by a third
moment card in the section above it, which is the composition that is already working on that page.

**Not proposed:** a third rendering density for `productFeatureGroups`. There are three already
(`1`, `4`, and the full `productCapabilityIndex`), and the rulebook now warns against adding a
fourth copy of the same inventory.

## Prompt

```text
Two marketing surfaces still argue in prose where the repo could show a screen. Read
docs/product/follow-ups/FU-20260812-pricing-and-home-still-argue-in-prose.md, then
docs/product/marketing.md (all of it — especially "Product visuals" and the show-before-describing
bullet in Voice), then the .claude/skills/marketing-page skill.

Do the /pricing half first, since it needs no judgment call: add an `ExportBundleFallback` to
src/components/MarketingScreenFallbacks.tsx that mirrors the real Settings -> Data export surface
element for element. Read src/db/export.ts and src/app/shop/[shopSlug]/settings/export/ before
drawing it, and keep the parts that make DiveDay look less capable — that is what makes a mockup a
claim rather than an illustration. Render it on src/app/pricing/page.tsx beside the data-exit FAQ
(`marketing.pricing.faq.dataIfNotWorking`) or as a band between the fee anchor and the included
list; pick by sketching both in prose first and choosing the one the content shapes.

Constraints that make this non-obvious: every word lives in src/i18n/locales/<locale>/diver.json
and BOTH locales change in the same commit (pnpm check:locale fails otherwise; read
src/i18n/locales/es-ES/README.md for register and terminology before writing Spanish). The price
figure may never be restated outside `earlyAccessPrice` in src/lib/marketing.ts — not in the
mockup, not in a filename, not in alt text. Semantic tokens only, no raw hex or palette-scale
Tailwind classes. Sample names and raw column headers are the only i18n-exempt literals, and they
need the comment that says so.

For the homepage half, do NOT redesign on instinct. Read the funnel-tag guidance in
docs/product/marketing.md ("Measuring which story converts") and say in the PR what evidence you
have about the `home-mid` door before touching the four-card band. If there is no evidence to read,
leave the band alone and say so — that is a complete answer.

Done means: pnpm check green; `pnpm e2e marketing.spec.ts --reporter=line` green with any pinned
assertions updated deliberately; a capture for the new mockup added to e2e/visual.spec.ts's public
surfaces; screenshots of /pricing in light and dark, desktop and phone, actually looked at; and
docs/product/marketing.md's "Product visuals" table updated with the new component in the same PR.
Delete docs/product/follow-ups/FU-20260812-pricing-and-home-still-argue-in-prose.md as part of the
change.
```
