---
name: switching-pages
description: Add or edit a competitive switching guide (/switching, /switching/[competitor], /switching/spreadsheet) — new incumbent guide, coexist-led channel guide, or edits to an existing one. Use whenever the task names an incumbent (EVE, DiveShop360, Smartwaiver, FareHarbor, Rezdy, Checkfront, …) or touches src/lib/migration-guides.ts.
---

# Switching-guide work

Switching guides are the sharpest edge of the positioning spine — "safe to leave" made concrete
for one named incumbent, and our highest-intent, lowest-competition SEO surface ("leaving
&lt;incumbent&gt;" searches). They are marketing pages first: everything in the `marketing-page`
skill's claims policy, voice, and verify steps applies here too. This skill is the added procedure
specific to a guide — read `marketing-page` first if you haven't.

## Before writing

1. Read `docs/product/marketing.md` §"Where the words live" (switching-guide section) — the rules
   this skill implements.
2. Read [assessments/competitive-strategy.md](../../../docs/product/assessments/competitive-strategy.md)
   for why portability is the chosen battleground and the legal guardrail (a shop migrates from
   files *it* exports itself — a guide never tells anyone to hand over a competitor login, and
   DiveDay never reaches into another system).
3. Check [assessments/switching-guide-landscape.md](../../../docs/product/assessments/switching-guide-landscape.md)
   for which incumbents/channels are surveyed and which is next — don't add an unsurveyed one
   without product-owner sign-off on its claims.
4. If the incumbent is a booking/distribution **channel** rather than a records system (today:
   FareHarbor, Rezdy — general tours engines), read
   [assessments/fareharbor-positioning.md](../../../docs/product/assessments/fareharbor-positioning.md)
   for the coexist-led pattern before drafting.

## Two guide shapes

| Shape | When | Structure |
| --- | --- | --- |
| **Leave-it** (records system) | EVE, DiveShop360, Smartwaiver, Checkfront, … | Incumbent's own export click-path → `IMPORT_HONESTY_TABLE` verbatim → demo CTA |
| **Coexist-led** (booking channel) | FareHarbor, Rezdy | Opens "keep the storefront and its network, run the dive day it can't" → `runsInDiveDay` jobs → same export/scope/import mechanics → clean-leave option |

`/switching/spreadsheet` is a third, static case: no vendor, no export click-path, no `sources`.
Its *content* is not a template for an incumbent guide — but its **shape is the same one**, see
below.

## One composition, three surfaces

Every guide page renders the same guided path from `src/app/switching/_components/guide.tsx`:

`GuideHero` (eyebrow, headline, lede, the demo/trial pair, and the four shared answers a switcher
arrives with) → the guide's own "what changes" prose, with `DividedList` where it has items →
`MidCta` at the hinge between the argument and the mechanics → `MovePath`, one numbered rail of
`MovePhase`es (`StepList`, `PhaseNotes`, and the shared `ScopePhase` / `ImportPhase`) →
`SwitchingConcierge` → `ClosingCta` → `SourcesFootnote`.

An incumbent guide runs four phases (export → scope → import → cutover); the spreadsheet guide
runs three (ready your sheet → scope → import), because there is no incumbent to cut over from.
**Add a section to that file, not to one page** — the two files were a duplicated 500-line card
grid each before 2026-08-13, and every fix had to be made twice. Everything is `max-w-4xl`: one
measure down the whole page.

## Where to edit

| Change | File |
| --- | --- |
| Guide content (steps, scope notes, `coexist` block, `sources`) | `src/lib/migration-guides.ts` — one `MigrationGuide` entry per incumbent |
| The shared guide composition (hero, move rail, scope/import phases, CTAs, sources) | `src/app/switching/_components/guide.tsx` |
| Which phases a guide renders, and its own prose sections | `src/app/switching/[competitor]/page.tsx`, `src/app/switching/spreadsheet/page.tsx` |
| Words every guide shares (the rail, the scope table, the importer walkthrough, the CTAs) | `switching.common.*` in the diver bundles |
| Hub page (the guide index) | `src/app/switching/page.tsx` |
| Import scope table (never paraphrase it) | `IMPORT_HONESTY_TABLE` in `src/lib/import.ts` |

A guide is a **live page only** — registering a `MigrationGuide` entry publishes it immediately,
there is no draft/planned state. Only add one once its incumbent's export path is actually
verified.

## Guardrails specific to this surface

- Every incumbent claim needs its own `sources` (rendered on the page) and must be documented
  fact — the incumbent's own pages, FAQs, or pricing. Never speculate about a competitor.
- Coexist-led guides only: never imply an integration or live sync (`bridgeNote` states the CSV
  import is the only bridge); never state a competitor's unpublished fee as their published price
  (mark reported-only figures as "reported at around X%", cite and date any figure taken from a
  live pricing page).
- The scope table renders from `IMPORT_HONESTY_TABLE` verbatim — editing guide copy to soften or
  restate it, instead of fixing the importer, is a claims-policy violation.
- Safety-adjacent scope copy (waiver/cert/medical claims about what imports) gets
  `dive-domain-expert` review, same as any other safety-adjacent copy.
- Prefer contrasting with the buyer's fear (setup fees, export limits, per-seat math) over digging
  at the incumbent by name outside of documented, sourced facts.

## Verify (in addition to marketing-page's verify steps)

1. `pnpm e2e marketing.spec.ts --reporter=line` — covers `/switching`, `/switching/[competitor]`
   routing (including the 404 case for an unregistered slug), and existing guides.
2. New guide → add its hub-and-detail coverage to `e2e/marketing.spec.ts` and visual snapshots
   (light + dark) to `e2e/visual.spec.ts`, following the existing `switching-*` capture names.
3. Screenshot the new/changed route and look at the PNGs:
   `pnpm e2e:build && npx playwright test e2e/visual.spec.ts -g 'public surfaces' --reporter=line`
   writes them to `e2e/screenshots/` (gitignored), `switching-*` among them.
