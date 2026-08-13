# FU-20260813-marine-life-catalog-has-no-spanish — Decide what a Spanish-speaking shop starts from in the field-guide picker

- **Status:** Open
- **Raised:** 2026-08-13 — dive-site configurability branch (`claude/dive-site-config-ui-20u5si`)
- **Kind:** question
- **Effort:** M
- **Touches:** `src/db/marine-life-catalog.ts`, `src/db/dive-site-templates.ts`,
  `src/app/shop/[shopSlug]/dive-sites/_components/FieldGuideEditor.tsx`,
  `src/i18n/locales/es-ES/README.md`

## What I noticed

`src/db/marine-life-catalog.ts` holds 93 species and `src/db/dive-site-templates.ts` holds 34 site
briefings, both in English only, both `i18n-exempt-file` — deliberately, and on the same reasoning
`src/db/course-templates.ts` uses: picking one *copies* its words onto the shop's own row, where the
shop rewrites them in its own language, and nothing is read back at render time (ADR
20260813-dive-site-briefings-are-the-shops-own-words).

That reasoning is sound for a shop that edits. It is thin for a shop that does not. A Spanish-speaking
shop that picks "Stoplight parrotfish" from the picker and saves gets an English name, an English
description and an English tip on a diver-facing briefing — and the app around it is in Spanish. The
same shop importing a Florida site template gets an English dive plan.

The picker's own words are translated. Its *contents* are not.

## Why it isn't already done

It is a real product call, not an oversight, and the options differ in cost by an order of magnitude:

1. **Leave it.** The catalog is a starting point for the market it describes (Florida and the wider
   Caribbean), where the operating language is usually English. Cheapest, and honest as long as the
   picker says so.
2. **Translate the catalogs into es-ES** and pick by `requestLocale` at *copy time* — the shop still
   owns the words after, nothing is looked up at render. ~280 strings for the species plus ~34
   briefings; needs a native reviewer, and every future species costs two writes.
3. **Species names only.** Common names in Spanish (`pez loro semáforo`), descriptions and tips left
   in English. Cheap, and probably the worst of the three: a half-translated card reads as a bug.

My recommendation is (2) for the species catalog and (1) for the site templates — a species name is
reference vocabulary a shop keeps, while a Florida dive plan is something a Spanish-speaking shop in
Cozumel would rewrite anyway. But which markets matter is not my call.

## Proposed change

Under (2): add a `nameEs`/`descriptionEs`/`preparationTipEs` triple to `MarineLifeSpecies` (not a
separate file — the pairing is what keeps them in sync), have `marineLifeCatalogEntries()` in
`site-editor-copy.ts` select by the staff locale it already resolves, and note in
`src/i18n/locales/es-ES/README.md` that this catalog is copy-at-pick-time content rather than bundle
copy, so nobody later "fixes" it into the bundles.

Under (1): add one line to the picker's `description` key in both locales saying the catalog is
written in English and every field is editable — so a shop meets the fact before it saves, not after.

## Prompt

```text
Read ADR docs/architecture/decisions/20260813-dive-site-briefings-are-the-shops-own-words.md (the
"starting words, not app copy" decision and the message-bundle alternative it rejected),
src/db/marine-life-catalog.ts, and src/i18n/locales/es-ES/README.md. The question: a Spanish-speaking
shop picks a species from the field-guide picker and gets English on a diver-facing briefing. Ask the
human which of the three options in
docs/product/follow-ups/FU-20260813-marine-life-catalog-has-no-spanish.md to take, then implement it.
Under option 2, keep the copy-at-pick-time contract — resolve the locale in
src/app/shop/[shopSlug]/dive-sites/_components/site-editor-copy.ts where the catalog is flattened for
the picker, never at render time, or a later catalog edit starts rewriting published briefings.
Spanish goes through src/i18n/locales/es-ES/README.md's terminology rules. Run pnpm check and
e2e/dive-sites.spec.ts. Delete
docs/product/follow-ups/FU-20260813-marine-life-catalog-has-no-spanish.md as part of the change.
```
