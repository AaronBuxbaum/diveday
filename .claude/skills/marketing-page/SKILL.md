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
3. If the change is positioning-level (hero, section order, new page), the spine and its reasoning
   are in `docs/product/marketing.md`; the 2026-07-23 review that argued for it is delivered and
   archived at `docs/product/archive/marketing-review-20260723.md` — read it for *why*, never as a
   task list.
4. Any new CTA gets a funnel tag from the registry in `src/lib/funnel.ts` — `<FunnelTag source="…">`
   on a demo form, `trialHref("…")` on a trial link. A new page adds its tag there first. See
   "Measuring which story converts" in `docs/product/marketing.md`.
5. If the task is a new or edited `/switching/*` guide, use the **switching-pages** skill instead
   — it layers the incumbent-specific procedure (guide shapes, `IMPORT_HONESTY_TABLE`, coexist
   framing) on top of this one.

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
- No engineering-process vocabulary either — "ADR," "requirements," spec, or ticket never appear;
  those are internal artifacts, not something a buyer reads about.
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
2. `pnpm e2e marketing.spec.ts --reporter=line` — update its pinned headline/price assertions
   deliberately when copy changes; a red marketing spec on a copy change is the test working.
3. Screenshot every touched route and **look at the PNGs**, light + dark, desktop + phone. The
   `@visual`-tagged tests write them, so a filtered run is the fastest way in:
   `pnpm e2e:build && npx playwright test e2e/marketing.spec.ts -g 'marketing surfaces' --reporter=line`
   (or `-g 'switching guides'` for a switching page), then read the images it wrote under
   `e2e/screenshots/` (gitignored).
4. Run the `design-review` skill for anything beyond a copy tweak; new sections or pages get a
   `@visual`-tagged capture in `e2e/marketing.spec.ts` (see `e2e-and-visual`).
5. Launch the `conversion-reviewer` agent for anything beyond a copy tweak — CTA clarity, funnel
   logic, and objection-handling are easy to lose while satisfying the claims policy; it reviews
   for persuasion the way `design-critic` reviews for delight.
6. If claims, positioning, or page inventory changed: update `docs/product/marketing.md` in the
   same PR.
7. After push: watch for a `reg-suit visual regression` report and run `visual-triage` — marketing
   pages are visual surfaces; their diffs need decisions like any other.
