# FU-20260812-marketing-suspense-swap-discards-interaction — A marketing page throws away whatever the visitor did before its localized body streams in

- **Status:** Open
- **Raised:** 2026-08-12 — PR #473, chasing a CI-only failure in `e2e/marketing.spec.ts`
- **Kind:** risk
- **Effort:** M
- **Touches:** `src/app/product/page.tsx`, `src/app/page.tsx`, `src/app/pricing/page.tsx`,
  `src/components/MarketingScreenFallbacks.tsx`, `e2e/marketing.spec.ts`

## What I noticed

Every marketing page renders its body **twice**. `ProductPage` is the clearest case:

```tsx
<Suspense fallback={<ProductBody locale={DEFAULT_DIVER_LOCALE} />}>
  <LocalizedProductBody />
</Suspense>
```

The fallback is not a skeleton — it is the whole page in the default locale, which is what makes
these routes paint instantly (ADR 20260804-instant-navigation). When `LocalizedProductBody`
resolves (it awaits `requestLocale()`), React replaces that subtree with the negotiated-locale one.

For an en-US visitor the two renders are identical copy, so the swap is invisible — **except that a
replaced subtree does not carry DOM state over.** The capability index on `/product` is a native
`<details>`. A visitor who clicks "The full list" before the swap lands watches it snap shut, with
nothing on screen explaining why and no way back except clicking again. On a fast warm connection
the window is milliseconds; on hotel wifi, or a phone on a boat's LTE, it is seconds.

I hit the test-shaped version of this: `e2e/marketing.spec.ts`'s "public marketing pages lead to
the product and pricing details" failed on CI (shard 3/4 of run 31549005047) asserting a heading
inside that disclosure, with `element(s) not found` — the signature of a **closed** `<details>`,
whose contents sit outside the accessibility tree, rather than `not visible`. It passed 10+ times
locally and has never failed on `main`, which is what a load-dependent race looks like.

**I could not reproduce it.** I wrote a throwaway spec that delayed the `?_rsc=` payload by 2.5s to
widen the window and the disclosure survived — almost certainly because Next had already prefetched
the route, so the delay never applied to the payload the navigation actually used. So: the
mechanism above is the best explanation the evidence supports, not a proven one. What *is* certain
is that the assertion ran against a closed `<details>`.

## Why it isn't already done

Two reasons.

The **test** was fixed in PR #473 (the disclosure is now exercised after a load-gated
`page.goto("/product")`, with the click-through assertion kept above it), so nothing is red. That
fix does nothing for real visitors — it only stops the test standing in the window.

The **product** fix is a change to how every marketing route renders, which is an
instant-navigation architecture decision (ADR 20260804-instant-navigation) and much bigger than the
UI-cleanup pass that surfaced it. It also needs a call I can't make: whether the instant
default-locale paint is worth keeping at all, given it also means a Spanish visitor reads English
and then watches it flip.

## Proposed change

Pick one, deliberately:

1. **Make the fallback a skeleton** (the shape `loading.tsx` already uses everywhere else), so
   there is nothing interactive to click before the real body arrives. Costs the
   "instant, real content" quality these pages were built for.
2. **Drop the double render**: make the body render once, and let the segment's `loading.tsx` cover
   the request-scoped read. Same cost, less machinery.
3. **Keep the swap, keep interaction**: hoist the disclosure's open state above the Suspense
   boundary (a small client component with the state in context, or `?list=open` in the URL) so a
   replaced subtree restores it. Narrowest fix, and it only covers the one control that has state
   today — a future interactive marketing control would reintroduce the bug.

Check the other marketing routes for the same shape before choosing: `/`, `/pricing`, and the
switching guides all use the fallback-is-the-body pattern, and any of them that grows an
interactive control inherits this.

What I am **not** proposing: making the e2e suite wait longer, or retrying the click. Both were
available and both hide a defect a real visitor can hit.

## Prompt

```text
Fix (or deliberately accept) a bug where DiveDay's marketing pages discard visitor interaction
that happens before their localized body streams in.

Read first:
- docs/product/follow-ups/FU-20260812-marketing-suspense-swap-discards-interaction.md (this file —
  it has the mechanism, the evidence, and the three options with their costs)
- src/app/product/page.tsx — the `<Suspense fallback={<ProductBody locale={DEFAULT_DIVER_LOCALE} />}>`
  around `LocalizedProductBody`, which is the whole of it
- docs/architecture/decisions/20260804-instant-navigation.md — why the fallback is a full body
- e2e/marketing.spec.ts — the disclosure block, and the comment explaining why it now uses a
  load-gated goto
- src/app/page.tsx, src/app/pricing/page.tsx, src/app/switching/[competitor]/page.tsx — check
  whether they share the pattern

The constraint that makes this non-obvious: the fallback and the real body render IDENTICAL copy
for an en-US reader, so the swap is invisible in every screenshot, every en-US assertion, and every
local run — and it still tears down and rebuilds the DOM, dropping `<details>` open state and any
other uncommitted interaction. Do not "verify" a fix by checking the page looks the same.

Done means: a visitor who opens `/product`'s "The full list" disclosure as early as the browser
allows still has it open once the localized body lands, proven by an e2e test that widens the
window deterministically (intercept the RSC payload with `page.route` AND disable prefetch for that
link, or navigate with prefetch off — the naive interception alone does nothing, because Next has
usually already prefetched). If option 1 or 2 is chosen, update ADR 20260804-instant-navigation
with what changed and why. Delete this follow-up file as part of the change.

Checks: pnpm check, pnpm e2e e2e/marketing.spec.ts --reporter=line, and a visual run — options 1
and 2 change what these routes paint first, so baselines will move.
```
