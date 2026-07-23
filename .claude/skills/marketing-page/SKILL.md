---
name: marketing-page
description: Write or edit the public marketing pages (/, /product, /pricing, /onboard, /switching/*) — copy, positioning, SEO metadata, feature claims, or pricing display. Use whenever a task touches public-page copy or when a shipped feature changes what a buyer should be told.
---

# Marketing page work

The public pages are product surface: copy is code, tested and reviewed like code. The rulebook —
positioning spine, claims policy, voice, SEO conventions — is
`docs/product/marketing.md`; this skill is the procedure. If they disagree, fix the stale one in
the same PR.

## Before writing

1. Read `docs/product/marketing.md` end to end. It is short and every rule in it is load-bearing.
2. Know what's actually shipped: `docs/product/shipped.md` (claims are shipped-only, demonstrable
   in the live demo — never roadmap marketing).
3. If the change is positioning-level (hero, section order, new page), read
   `docs/product/assessments/marketing-review.md` for the current case and task list (M1–M8).

## Where to edit

| Change | File |
| --- | --- |
| Claim shared across pages | `src/lib/marketing.ts` → `productFeatureGroups` |
| Price / plan / included list | `src/lib/marketing.ts` → `earlyAccessPrice` — the ONLY place the number exists |
| Page narrative copy | `src/app/page.tsx`, `src/app/product/page.tsx`, `src/app/pricing/page.tsx`, `src/app/onboard/page.tsx` |
| Illustrated mockup copy | `src/components/MarketingScreenFallbacks.tsx` |
| Nav / footer | `src/components/MarketingNav.tsx`, `src/components/MarketingFooter.tsx` |

Layout stays inside the design system: semantic tokens only, `buttonClass()` for button-shaped
things, `<Field>`/`<FieldGrid>` for forms.

## Copy checklist (apply to every changed sentence)

- Outcome in the buyer's world, not a category label. Test: could a rival paste this sentence
  truthfully onto their site? If yes, sharpen it.
- Shipped-only; no "coming soon"; no unprovable superlatives ("everything", "complete").
- No software jargon ("operating system", "platform", "solution") — name the whiteboard, the
  clipboard, the counter, the boat.
- No fabricated proof of any kind (testimonials, counts, logos, ratings).
- Offline wording in captain's words; implementation words (sync, cache, encryption, fail-closed)
  never appear.
- Price never restated outside `src/lib/marketing.ts` — prose, JSON-LD, and images included.
- Safety-adjacent copy (readiness, manifest, medical, certs, nitrox) → launch `dive-domain-expert`
  review before commit.

## SEO checklist (for new pages or metadata changes)

- Read the bundled Next docs first (`node_modules/next/dist/docs/` — metadata conventions differ
  from training data).
- Page-level `metadata`: buyer-worded title, description, canonical, Open Graph + Twitter card.
- New public page → add to the sitemap; tokened/private pages stay `robots: noindex`.
- Structured data values read from `src/lib/marketing.ts`, never literals.

## Verify (the definition of done)

1. `pnpm check` green.
2. `pnpm e2e -- marketing.spec.ts --reporter=line` — update its pinned headline/price assertions
   deliberately when copy changes; a red marketing spec on a copy change is the test working.
3. Screenshot every touched route and **look at the PNGs**, light + dark, desktop + phone:
   `node scripts/screenshot.mjs / /product /pricing`
4. Run the `design-review` skill for anything beyond a copy tweak; new sections or pages get an
   Argos snapshot in `e2e/visual.spec.ts` (see `e2e-and-argos`).
5. If claims, positioning, or page inventory changed: update `docs/product/marketing.md` in the
   same PR.
6. After push: schedule the Argos check-in and run `argos-triage` — marketing pages are visual
   surfaces; their diffs need decisions like any other.
