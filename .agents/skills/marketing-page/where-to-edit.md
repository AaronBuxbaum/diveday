# Marketing page: where to edit

Part of the **marketing-page** skill ([SKILL.md](SKILL.md)). Read it before changing any public page, to find the file that owns the copy, price, metadata or visual.

## Where to edit

| Change | File |
| --- | --- |
| A shipped capability line | `src/lib/marketing.ts` → `productCapabilityIndex`, under the group of the feature page a shop would look for it on |
| The list of feature pages on `/` and `/product` | `FeatureDirectory` in `src/components/MarketingSections.tsx`, which reads the registry `src/lib/feature-pages.ts`; never a page-by-page list |
| Price / plan / included list | `src/lib/marketing.ts` → `earlyAccessPrice` — the ONLY place the number exists |
| Page narrative copy | `src/app/page.tsx`, `src/app/product/page.tsx`, `src/app/pricing/page.tsx`, `src/app/onboard/page.tsx` |
| A feature page (`/product/<feature>`) | the registry `src/lib/feature-pages.ts`, the one template `src/app/product/_components/FeaturePageBody.tsx`, words in `marketing.featurePages.<page>`; its checklist is that page's group of `productCapabilityIndex` |
| Illustrated mockup copy | `src/components/MarketingScreenFallbacks.tsx`; a feature page's screen in `src/components/MarketingFeatureScreens.tsx` |
| Nav / footer | `src/components/MarketingNavView.tsx`, `src/components/MarketingFooter.tsx` |

Layout stays inside the design system: semantic tokens only, `buttonClass()` for button-shaped
things, `<Field>`/`<FieldGrid>` for forms — but inside those mechanics, compose for the argument
(`docs/design/principles.md` §10–11): before building a new page or section, state its one idea in
a sentence and sketch at least two compositions in prose, picking the one shaped by the content —
the hero-plus-card-stack is the fallback, not the target. Surface the facts a buyer predictably
wants (price, what's included, how leaving works) where the question arises rather than behind a
click, and keep one primary CTA per screen — before adding a button, ask whether the layout could
make it unnecessary. A new page's one argument and one ask go in
[`docs/design/surfaces.md`](../../../docs/design/surfaces.md), which is where the holistic pass is
written down.
