---
name: switching-pages
description: "Add or edit a competitive switching guide (/switching/*, src/lib/migration-guides.ts). Use when a task names an incumbent (EVE, DiveShop360, Smartwaiver, FareHarbor, Rezdy, Checkfront, …)."
---

# Switching-guide work

Switching guides help a shop try a better-prepared dive day and understand the work of bringing
its records across. Product proof leads; accurate transfer scope and records control support the
decision. They also serve high-intent searches for a current system. They are marketing pages first: everything in the `marketing-page`
skill's claims policy, voice, and verify steps applies here too. This skill is the added procedure
specific to a guide — read `marketing-page` first if you haven't.

## Before writing

1. Read `docs/product/marketing.md` §"Where the words live" (switching-guide section) — the rules
   this skill implements.
2. Read the current [switching review](../../../docs/product/switching-review-20261111.md) before the archived research. Read [assessments/competitive-strategy.md](../../../docs/product/archive/assessments/competitive-strategy.md)
   for historical positioning context and the legal guardrail (a shop migrates from
   files *it* exports itself — a guide never tells anyone to hand over a competitor login, and
   DiveDay never reaches into another system).
3. Check [assessments/switching-guide-landscape.md](../../../docs/product/archive/assessments/switching-guide-landscape.md)
   for which incumbents/channels are surveyed and which is next — don't add an unsurveyed one
   without product-owner sign-off on its claims.
4. If the incumbent is a booking/distribution **channel** rather than a records system (today:
   FareHarbor, Rezdy — general tours engines), read
   [assessments/fareharbor-positioning.md](../../../docs/product/archive/assessments/fareharbor-positioning.md)
   for the coexist-led pattern before drafting.

## Two guide shapes

| Shape | When | Structure |
| --- | --- | --- |
| **Leave-it** (records system) | EVE, DiveShop360, Smartwaiver, Checkfront, … | Product proof → sourced export instructions or qualified sample review → `IMPORT_HONESTY_TABLE` verbatim → demo CTA |
| **Coexist-led** (booking channel) | FareHarbor, Rezdy | Product proof → keep or replace the current booking channel after a trial → manual handover and import scope |

`/switching/spreadsheet` is a third, static case: no vendor, no export click-path, no `sources`.
Its *content* is not a template for an incumbent guide — but its **shape is the same one**, see
below.

## One composition, three surfaces

Every guide page renders the same guided path from `src/app/(marketing)/switching/_components/guide.tsx`:

`GuideHero` (eyebrow, headline, lede, demo/setup pair and shared answers) → `GuideProof`
(the existing Today screen, feature links and a demo opening on Today) → the guide's own fit
and tradeoff prose → `MovePath`, one numbered rail of
`MovePhase`es (`StepList`, `PhaseNotes`, and the shared `ScopePhase` / `ImportPhase`) →
`SwitchingConcierge` → `ClosingCta` → `SourcesFootnote`.

An incumbent guide runs four phases (export → scope → import → cutover); the spreadsheet guide
runs three (ready your sheet → scope → import), because there is no incumbent to cut over from.
**Add a section to that file, not to one page** — the two files were a duplicated 500-line card
grid each before 2026-08-13, and every fix had to be made twice. Everything is `max-w-4xl`: one
measure down the whole page.

## Where to edit

- [where-to-edit.md](where-to-edit.md) — the file that owns each part of a guide (`src/lib/migration-guides.ts` and the rest); read it before the first edit.

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
- Lead with the crew's work and the screen that proves it, not fear about the current vendor.
  Keep exit assistance in the dedicated records-control block. The shared close invites a sample
  and a review of the move, without repeating departure assistance or promising a turnaround.
- Never imply importing history books future seats or prepares departures automatically.

## Verify (in addition to marketing-page's verify steps)

1. `pnpm e2e marketing.spec.ts --reporter=line` — covers `/switching`, `/switching/[competitor]`
   routing (including the 404 case for an unregistered slug), and existing guides.
2. New guide → add its hub-and-detail coverage to `e2e/marketing.spec.ts` and visual snapshots
   (light + dark) to `e2e/visual-front-door.spec.ts`, following the existing `switching-*` capture names.
3. Screenshot the new/changed route and look at the PNGs:
   `pnpm e2e:build && pnpm e2e:run e2e/visual-front-door.spec.ts --grep 'mode public the' --reporter=line`
   writes them to `e2e/screenshots/` (gitignored), `switching-*` among them.
