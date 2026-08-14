# FU-20260814-remaining-fallback-is-the-body-marketing-pages — Three marketing pages still render their body twice

- **Status:** Open
- **Raised:** 2026-08-14 — fixing FU-20260812-marketing-suspense-swap-discards-interaction, which
  fixed `/`, `/product` and `/pricing` and told the next session to check the rest
- **Kind:** cleanup
- **Effort:** M
- **Touches:** `src/app/switching/page.tsx`, `src/app/switching/spreadsheet/page.tsx`,
  `src/app/about/page.tsx`, `e2e/marketing.spec.ts`,
  `docs/architecture/decisions/20260804-instant-navigation.md`

## What I noticed

`/switching`, `/switching/spreadsheet` and `/about` still pass their **entire body, in the default
locale**, as the `<Suspense>` fallback for the negotiated-locale one:

```tsx
<Suspense fallback={<SwitchHubBody locale={DEFAULT_DIVER_LOCALE} />}>
  <LocalizedSwitchHubBody />
</Suspense>
```

That is the exact shape just removed from `/`, `/product` and `/pricing`. It paints instantly, and
it means an `es-ES` visitor is served a full English page they can see, scroll, and click, which
React then tears down and rebuilds when the Spanish body resolves — carrying no DOM state, no
scroll anchor, and no in-flight interaction across. For an en-US reader the two renders are the
same words, so nothing in a screenshot or an English-pinned assertion can see it.

Today's cost on these three is scroll position and a lost click on a slow connection; the real
risk is the next interactive control anyone adds to them. `/switching/[competitor]` is already
fine (its fallback is an empty `<main>`), and so is `/sign-in` (an `EntryShellSkeleton`).

## Why it isn't already done

Scope. The session that fixed the other three owned only `src/app/page.tsx`,
`src/app/product/page.tsx`, `src/app/pricing/page.tsx` and their `loading.tsx` siblings — other
sessions were editing the switching surface in the same working directory at the time. The fix is
mechanical but it moves what each of these routes paints first, so it wants its own visual-diff
review rather than being smuggled into a change nobody was reviewing for it.

## Proposed change

Follow what `/product` and `/pricing` now do (read those two first — the reasoning is written out
in `ProductPage`'s doc comment and in `src/app/product/loading.tsx`):

1. Make the page an ordinary `async` component that `await`s `requestLocale()` once and renders its
   body a single time. Keep the separate `<Suspense>` around `MarketingNav`: it reads the
   *session* as well as the locale, and the body must not wait on that.
2. Add a body-shaped `loading.tsx` to each segment — the boundary of record per ADR
   20260804-instant-navigation — carrying `MarketingNavFallback`, bars for the body, and
   `MarketingFooterFallback`. **Nothing in it may be interactive**; that is the whole fix.
3. Extend the `Accept-Language: es` describe at the end of `e2e/marketing.spec.ts` — it already
   records, from an init script, whether default-locale body copy is ever in the document — by
   adding one entry per page to its `bodyCopy` table.

Not proposed: keeping the double render and re-anchoring scroll after the swap. That was option 3
in the original follow-up and it was rejected for the pages already fixed, because it only ever
covers the controls that exist on the day it is written.

## Prompt

```text
Three DiveDay marketing pages still render their whole body twice — once in the default locale as
a Suspense fallback, then again in the reader's negotiated locale — which discards any interaction
a visitor had with the first copy. Fix them the way `/`, `/product` and `/pricing` were fixed on
2026-08-14.

Read first:
- docs/product/follow-ups/FU-20260814-remaining-fallback-is-the-body-marketing-pages.md (this file)
- src/app/product/page.tsx and src/app/product/loading.tsx — the shape to copy, with the reasoning
  written out in the doc comments
- docs/architecture/decisions/20260804-instant-navigation.md, including its 2026-08-14 amendment
  ("a fallback holds shape, never interaction")
- e2e/marketing.spec.ts — the `Accept-Language: es` describe at the end is the regression guard

The pages: src/app/switching/page.tsx, src/app/switching/spreadsheet/page.tsx,
src/app/about/page.tsx.

The constraint that makes this non-obvious: for an en-US reader both renders are identical copy,
so the defect is invisible in every screenshot, every English assertion, and every local run — and
the subtree is still torn down and rebuilt. Do not "verify" the fix by checking the page looks the
same, and do not make an e2e test wait longer or retry (pnpm check:e2e-hygiene refuses that, and
it would hide the bug).

Done means: each page renders its body once, behind a body-shaped `loading.tsx` with nothing
interactive in it; each page keeps `export const instant = true` and still paints instantly; and
each page has an entry in the `bodyCopy` table of the `Accept-Language: es` test in
e2e/marketing.spec.ts, so an English body reaching a Spanish reader fails the suite. Delete
docs/product/follow-ups/FU-20260814-remaining-fallback-is-the-body-marketing-pages.md as part of
the change.

Checks: pnpm check, pnpm e2e e2e/marketing.spec.ts --reporter=line, and a visual run — these
routes now paint a skeleton first, so their baselines may move; account for every diff in the PR.
```
