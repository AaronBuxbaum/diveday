# FU-20260813-feature-groups-grid-has-one-density-left — 26 feature claims are translated into two locales and rendered nowhere

- **Status:** Open
- **Raised:** 2026-08-13 — the `/product` design pass, in code review of the diff
- **Kind:** cleanup
- **Effort:** M
- **Touches:** `src/components/MarketingSections.tsx`, `src/lib/marketing.ts`,
  `src/i18n/locales/en-US/diver.json`, `src/i18n/locales/es-ES/diver.json`,
  `docs/product/marketing.md`

## What I noticed

`FeatureGroupsGrid` has two branches and only one of them can run.

`featuresPerGroup === 1` sets `summaryOnly` and renders a single paragraph; anything higher renders
the checklist `<ul>`. Both remaining callers pass `1`:

- `src/app/page.tsx:264` — `<FeatureGroupsGrid locale={locale} columns={4} featuresPerGroup={1} />`
- `src/app/pricing/page.tsx:349` — `<FeatureGroupsGrid locale={locale} columns={2} featuresPerGroup={1} />`

`/product` was the third, at `featuresPerGroup={4}`, and it is gone — its 30 bullets sat about a
thousand pixels above a disclosure holding 46 better-organized ones covering the same ground, so
the middle density went and the capability index became the page's flat spec sheet.

The consequence nobody has swept: **only `item1` of each of the four `productFeatureGroups` is
reachable.** The other 26 keys under `marketing.features.*` render on no page in the app, in either
locale — 52 bundle entries that `pnpm check:locale` will keep demanding translations for, and that
the next person editing feature copy will keep carefully wording. The checklist branch and its `✓`
markers are dead code sitting under a live component.

## Why it isn't already done

`productFeatureGroups` is a shared registry: the product-page pass that surfaced this owned
`/product` and its own keys, and was explicitly told not to restructure the shared registries,
whose consumers are two pages it did not own. Deleting 26 keys and a component branch across `/`
and `/pricing` from a product-page branch is how two design branches collide.

It also wants a decision rather than a delete. Three of the four kept `item1`s were written as the
*first* line of a checklist, not as a summary — reading `marketing.features.welcome.item1` alone as
a card paragraph is thinner than a sentence written for the job would be. So the honest options
are: promote a real summary line per group and drop the rest, or bring a checklist density back
somewhere it earns its place.

## Proposed change

Decide one, then make the code and the bundles agree:

1. **Summary-only.** Give `FeatureGroupKeys` an explicit `summary: DiverMessageKey` (four new
   strings, written as summaries), drop `features` down to nothing or keep it as documentation of
   the claim set, delete the `featuresPerGroup`/`summaryOnly` branch and the `columns` plumbing
   that only exists to make the checklist fit, and delete the 26 orphaned keys from both locales.
2. **Keep a checklist density** and give it a home — the pricing page's "what's included" is the
   only plausible one — then keep the keys and note in `docs/product/marketing.md` which page owns
   which density.

Either way, update the "Show the screen before describing it" rule in `docs/product/marketing.md`:
it was rewritten on 2026-08-13 to say two densities, and option 1 makes it one.

Not proposed: leaving the branch in "for when someone needs it". It has been unreachable since the
`/product` change, and an unreachable branch with 52 translated strings behind it is a maintenance
bill nobody is paying down.

## Prompt

```text
`FeatureGroupsGrid` in src/components/MarketingSections.tsx has an unreachable branch. Both
remaining callers — src/app/page.tsx:264 and src/app/pricing/page.tsx:349 — pass
featuresPerGroup={1}, which sets summaryOnly and renders a paragraph, so the checklist <ul> never
renders. As a result only item1 of each of the four groups in productFeatureGroups
(src/lib/marketing.ts) is reachable, and the other 26 marketing.features.* keys are translated in
both locales and rendered nowhere.

Read first: src/components/MarketingSections.tsx (the component), src/lib/marketing.ts (the
registry and its keys-not-copy doc comment), and the "Show the screen before describing it" bullet
in docs/product/marketing.md, which records why /product's middle density was removed.

Pick one deliberately and say why in the commit: (a) make the grid summary-only — add an explicit
`summary` key per group written as a summary rather than reusing item1, delete the
featuresPerGroup/summaryOnly branch, and delete the 26 orphaned keys from BOTH locales in the same
change; or (b) give the checklist density a page that earns it and keep the keys. Do not leave the
branch unreachable.

Update docs/product/marketing.md's density rule to match whatever you chose.

Done when: pnpm check is green (check:locale in particular — deleting a key from one locale and not
the other fails it), `pnpm e2e e2e/marketing.spec.ts --reporter=line` passes, and the landing and
pricing captures are read light and dark at 390 and 1280
(`E2E_WORKERS=1 npx playwright test e2e/visual.spec.ts -g 'landing|pricing' --reporter=line`).
Delete docs/product/follow-ups/FU-20260813-feature-groups-grid-has-one-density-left.md as part of
the change.
```
