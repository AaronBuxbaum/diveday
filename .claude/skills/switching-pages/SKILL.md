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

`/switching/spreadsheet` is a third, static case: no vendor, no export click-path, no `sources` —
don't use it as a template for an incumbent guide.

## Where to edit

| Change | File |
| --- | --- |
| Guide content (steps, scope notes, `coexist` block, `sources`) | `src/lib/migration-guides.ts` — one `MigrationGuide` entry per incumbent |
| Guide page rendering | `src/app/switching/[competitor]/page.tsx` |
| Hub page (guide list) | `src/app/switching/page.tsx` |
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

1. `pnpm e2e -- marketing.spec.ts --reporter=line` — covers `/switching`, `/switching/[competitor]`
   routing (including the 404 case for an unregistered slug), and existing guides.
2. New guide → add its hub-and-detail coverage to `e2e/marketing.spec.ts` and visual snapshots
   (light + dark) to `e2e/visual.spec.ts`, following the existing `switching-*` capture names.
3. Screenshot the new/changed route: `node scripts/screenshot.mjs /switching /switching/<slug>`.
