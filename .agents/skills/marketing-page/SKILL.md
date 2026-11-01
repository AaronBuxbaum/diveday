---
name: marketing-page
description: "Write or edit the public marketing pages (/, /product, /pricing, /onboard) — copy, positioning, SEO, claims, pricing. Use when a task touches public-page copy or a shipped feature changes what a buyer should be told."
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
4. Any new demo CTA gets a funnel tag from the registry in `src/lib/funnel.ts` —
   `<FunnelTag source="…">` on the form. The "Get set up" door is a mail and carries none; there
   is no self-serve sign-up to link to (ADR 20260925-shops-are-set-up-by-hand). A new page adds its tag there first. See
   "Measuring which story converts" in `docs/product/marketing.md`.
5. If the task is a new or edited `/switching/*` guide, use the **switching-pages** skill instead
   — it layers the incumbent-specific procedure (guide shapes, `IMPORT_HONESTY_TABLE`, coexist
   framing) on top of this one.

## Reference

- [where-to-edit.md](where-to-edit.md) — which file owns each page's copy, prices, metadata and visuals — read it before the first edit.
- [seo.md](seo.md) — the SEO checklist, for a new page or a metadata change.

## Copy checklist (apply to every changed sentence)

- Outcome in the buyer's world, not a category label. Test: could a rival paste this sentence
  truthfully onto their site? If yes, sharpen it.
- Written in the page's register (`docs/design/brand.md`, "The two registers of the public
  pages"): the selling register everywhere (a heading that says what the shop gets, the screen that
  proves it with builder's notes under twenty words each naming one visible thing and its reason or
  limit, never an evaluation, and a demo door that opens on that screen as that role), and speech
  on `/about` (every heading the owner's question repeated back without a mark). Reads as a person, not a model. No em-dash in prose, no "not a project, a
  file" contrast, no "No X. No Y. No Z." run, no *actually*/*genuinely*/*plainly*, no "Here's how",
  no aphorism or rhetorical question as a heading, no closing flourish, no mirrored pair, no
  triplet for rhythm, no tag sentence, no phrase reused on a third page. The list, with
  before/after, is "What gives us away" in `docs/design/brand.md`; `pnpm check:voice` refuses the
  mechanical half, the four shapes included, in the bundles and in route `metadata`.
- Shipped-only; no "coming soon"; no unprovable superlatives ("everything", "complete").
- No software jargon ("operating system", "platform", "solution") — name the whiteboard, the
  clipboard, the counter, the boat.
- No fabricated proof of any kind (testimonials, counts, logos, ratings).
- Offline wording in captain's words; implementation words (sync, cache, encryption, fail-closed)
  never appear. `pnpm check:voice` refuses them; "encrypted" passes only on the privacy keys it names.
- No engineering-process vocabulary either — "ADR," "requirements," spec, or ticket never appear;
  those are internal artifacts, not something a buyer reads about.
- Price never restated outside `src/lib/marketing.ts` — prose, JSON-LD, and images included.
- Safety-adjacent copy (readiness, manifest, medical, certs, nitrox) → launch `dive-domain-expert`
  review before commit.

## Verify (the definition of done)

1. The local gate green — `pnpm check:repo`, `pnpm lint`, `pnpm typecheck`
   (`pnpm check:voice` is the fast first pass for a copy change); the whole `pnpm check` runs on CI.
2. `pnpm e2e marketing.spec.ts --reporter=line` — update its pinned headline/price assertions
   deliberately when copy changes; a red marketing spec on a copy change is the test working.
3. Screenshot every touched route and **look at the PNGs**, light, desktop + phone (dark too only
   for colour work). The visual spec writes them, so a filtered run is the fastest way in:
   `pnpm e2e:build && pnpm e2e:run e2e/visual-front-door.spec.ts --grep 'light mode public the' --reporter=line`,
   then read the images it wrote under `e2e/screenshots/` (gitignored).
4. Run the `design-review` skill for anything beyond a copy tweak; new sections or pages get a
   visual snapshot in `e2e/visual-front-door.spec.ts` (see `e2e-and-visual`).
5. Launch the `conversion-reviewer` agent for anything beyond a copy tweak — CTA clarity, funnel
   logic, and objection-handling are easy to lose while satisfying the claims policy; it reviews
   for persuasion the way `design-critic` reviews for delight.
6. If claims, positioning, or page inventory changed: update `docs/product/marketing.md` in the
   same PR.
7. After push: watch for `e2e/visual-front-door.spec.ts` failures and run `visual-triage` — marketing pages
   are visual surfaces; their diffs need decisions like any other.
