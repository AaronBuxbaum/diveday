---
name: expand-content
description: Cover a new dive area with sourced sites, species and vetted photos. Use when adding a region, sites, species or content photos.
---

# Expand the starting content

The contract is ADR
[20261014-starting-content-is-measured-and-vetted](../../../docs/architecture/decisions/20261014-starting-content-is-measured-and-vetted.md).
Run the steps in this order for each area. An area is done when `pnpm content:coverage` shows it
**promised** at 80% or more, and `pnpm test src/content` and `pnpm test src/db/marine-life-catalog.test.ts`
pass.

## 1. Name the area

Add it to `src/content/dive-areas.ts`:

- `country`: ISO 3166-1.
- `subdivisions`: only where the country also holds places that are not this area, for example
  Bonaire (`BQ`) beside Saba and Statia.
- `timeZones`: only the zones that are mostly this area.

Then add a test case to `catalogAreasForShop` in `src/lib/curated-defaults.test.ts`.

## 2. Count the denominator before writing any template

Write `src/content/coverage/<area>.json` (shape in `src/content/coverage.ts`). Use the official
list where one exists: a marine-park, sanctuary or mooring list, or a government dataset. Cross it
with operators' published site lists. A site is counted when:

- it is named;
- it is recreationally divable (no cave-only or permit-only site);
- it appears on two independent lists.

Keep every site you drop, with an `excluded` reason. Write `method` so another session could repeat
the count, and set `promised: false` until step 5. Research runs best fanned out, one subagent per
area, each returning sourced rows that you check before writing.

## 3. Write the templates

One file per area: `src/content/dive-sites/<area>.ts`, joined in `src/content/dive-site-templates.ts`.
Point the denominator's `template` at each one.

- **Facts.** Every template needs at least two independent `sources`. The position must agree
  across them within about 1 km. Depth is given in metres and feet. `maxDepthMeters` is the
  deepest point a diver can reach on or off the plan, capped where the structure passes
  recreational limits. A site deeper than 30 m carries Advanced Open Water
  and Deep (`src/content/dive-site-templates.test.ts`). Drop anything you cannot verify; never
  estimate a number.
- **Words.** Write in your own words, in the brand voice
  ([docs/design/brand.md](../../../docs/design/brand.md)). Never copy a source's description.
  Landmarks and a dive plan go in only where the sources describe them.
- **Field guide.** `creatureSlugs` must be catalog slugs. Add any missing species first (step 4).
- **Correcting a published template.** Bump its `version`. `seedDiveSiteCatalog` publishes the
  new version to every database.

## 4. Add the species the area's divers meet

The denominator is REEF's Tropical Western Atlantic sighting data for the area's zones, plus the
invertebrate, coral, turtle and mammal lists named in `src/content/coverage/species-*.json`. Each
species needs:

- a row in `src/db/marine-life-catalog.ts`;
- a name, a description and a tip in both `src/i18n/locales/*/diver.json`, in the voice the
  **i18n-copy** skill describes. Run `pnpm check:voice` and `pnpm check:locale`; a name that is
  the same in Spanish goes in `DELIBERATELY_IDENTICAL`.

## 5. Photograph everything

```sh
pnpm content:photos todo --area <area>             # every subject still missing a decision
pnpm content:photos candidates <subject>          # refuses by rule, renders a numbered sheet
#   look at .content-review/<subject>/sheet.jpg
pnpm content:photos accept <subject> <n> [--crop l,t,w,h]
pnpm content:photos none site:<slug> --reason "…"  # sites only; every species needs a photo
```

Accept a frame only when it shows the right subject, alive, in the wild, large and lit. Never
accept an aquarium, studio, held, landed, drawn or skeletal subject, even when the rules let it
through. A subagent can run `candidates` and judge the sheets. Only one session at a time runs
`accept` and `none`, because they write the ledger. Run `pnpm content:photos audit` before you
push.

Then set `promised: true` and run `pnpm content:coverage`.

## 6. Review

Launch `dive-domain-expert` over the new templates (depths, certification gates, hazards, current)
and over the species copy. Fix what it finds. The PR body names the review and pastes the
coverage table.
