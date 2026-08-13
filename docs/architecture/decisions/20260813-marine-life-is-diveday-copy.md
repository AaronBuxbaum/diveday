# 20260813-marine-life-is-diveday-copy — A shop chooses which species its field guide shows; DiveDay writes them, in every language

- **Status:** Accepted
- **Date:** 2026-08-13
- **Amends:** 20260813-dive-site-briefings-are-the-shops-own-words, for the field guide only. That
  ADR's decision — every *sentence about this reef* comes off the shop's own row, and the staff form
  can write all of them — stands for the fit line, the landmark notes, the dive plan, the tips
  heading, and the site templates. This record reverses one of its five bullets and the
  message-bundle alternative it rejected.

## Context

The field guide is the row of species cards on a dive-site briefing: a photo, a common name, a
category, one line about what it looks like, and one about how to actually see one.

The 2026-08-13 briefing work gave shops a way to edit that list for the first time, and made it work
the way `course-templates.ts` does: picking "Stoplight parrotfish" out of DiveDay's 93-species
catalog **copied** its four strings onto `dive_site_creatures`, where the shop then owned and edited
them. Nothing was read back at render, so a later correction to the catalog could never rewrite what
a shop had published.

The same day's review filed the hole that reasoning leaves
(`FU-20260813-marine-life-catalog-has-no-spanish`): `src/db/marine-life-catalog.ts` is English only,
and copy-at-pick-time means a Spanish-speaking shop that picks a species and saves — the overwhelmingly
common path, since the whole point of a starting catalog is that most shops keep what it gives them
— publishes an English card inside a Spanish briefing. The picker's own chrome was translated. Its
contents were not. And there was no way to have both languages from one row: the row held one string
per field, so whichever language it was typed in was the language every diver got.

The follow-up offered three options — leave it, translate the catalogs and still copy at pick time,
or translate only the names. All three keep the shop as the author. A fourth was not on the list and
is the one taken here: stop making the shop the author of this particular thing.

## Decision

**A field guide is a selection. `dive_site_creatures` stores which catalog species a site shows and
in what order, and nothing else. Every word on the card is DiveDay's, held in both locales'
message bundles, and resolved for whoever is reading.**

- `src/db/marine-life-catalog.ts` becomes a key registry — slug, Latin binomial, category code. No
  prose. The 93 × 3 strings move to `marineLife.species.<slug>` in `diver.json`, English and Spanish,
  with the 18 category words under `marineLife.kinds.<code>`.
- `MARINE_LIFE_CATALOG` is `as const`, so `MarineLifeSlug` is a union of the 93 slugs and
  `src/i18n/marine-life-labels.ts` can build `marineLife.species.${slug}.name` as a **typed** key.
  A species added without its copy, in either locale, is a compile error — not a slug rendered at a
  diver.
- `parseFieldGuideSelection` (`src/lib/dive-site-field-guide.ts`) replaces
  `parseDiveSiteCreatures`: a posted guide is a list of catalog slugs, deduped, capped at eight,
  with anything the catalog does not carry dropped at the boundary. It still reads the old
  `{ slug, name, … }` shape — for the slug only — so a stale open tab degrades rather than fails.
- The staff editor is a picker: search, add, reorder, remove, and a read-only preview card showing
  the words a diver will see. It resolves them through the **diver** translator in the staffer's own
  locale, because showing a staffer different words than the briefing renders would be the bug.
- The words are the same on every surface that shows a species — the diver briefing, the trip-prep
  "ready" page, the staff form's picker, and the published-template preview all call
  `marineLifeCard`.

**Where the line now sits.** The distinction is authorship, not localization convenience:

| The shop's own words | DiveDay's words |
| --- | --- |
| the dive plan, the fit note, the current note | what a stoplight parrotfish looks like |
| a landmark's note, the "slow down" tips heading | how to actually see one |
| the site's name, description, marine-life summary | the category word over the name |

A dive plan for Molasses Reef is the shop's to write and no two shops' are the same. What a species
looks like is the same sentence for every shop in the Caribbean, and writing it 400 times, once per
shop, in one language each, is not shop autonomy — it is unpaid work with a worse result.

`dive-site-templates.ts` and `course-templates.ts` are **unchanged** and stay copy-at-pick-time.
They describe a *place* and a *course a shop teaches*, which are exactly the things a shop rewrites.

## Alternatives considered

**Translate the catalog and keep copying at pick time** (option 2 in the follow-up). Every existing
guarantee survives and Spanish-speaking shops get Spanish starting text. Rejected on what happens
*after* the pick: the row still holds one language, so the shop's *diver* still reads whatever
language the staffer's browser was in when they clicked. It fixes the staffer's experience and not
the diver's, which is the one that matters, and it costs the same 280 strings.

**Species names only.** Named in the follow-up as probably the worst option, and that is right: a
card with a Spanish name over an English description reads as a bug rather than as a limitation.

**Leave it and say so in the picker.** Honest, and cheapest. Rejected because "the catalog is in
English" is a sentence a shop reads once and every one of its divers lives with, and because DiveDay
sells to the Caribbean, where the operating language is frequently not English.

**Keep the text fields but let a shop override per row.** The version of this that preserves the
escape hatch: DiveDay's words by default, the shop's if it typed any. Rejected for this change
because it is not one model but two, and the surface has to explain both — a card that is sometimes
translated and sometimes not is the half-translated guide again, arrived at one row at a time. It is
also a strictly additive change later, which is why the register carries it as a decision rather
than a regret (`FU-20260813-field-guide-has-no-escape-hatch`).

**Join the guide to a catalog table in the database** — rejected in the amended ADR because it made
DiveDay's words live on a shop's published page. That objection is now the *intent*, so it does not
apply; the reason the catalog is still a TypeScript module rather than a table is only that a
constant needs no migration and no query.

## Consequences

- One migration, and a deliberately incomplete one: `dive_site_creatures.name` and `.kind` drop
  their `NOT NULL`, and the five text columns stay. Dropping them in this release would break the
  previous one, which is still serving while the migration applies and still selects them
  (ADR 20260806-destructive-migration-guard). The contract half is
  `FU-20260813-drop-field-guide-text-columns`.
- **Existing rows a shop typed itself are lost from the guide.** A row with no `catalog_slug` — a
  species DiveDay never carried, added through the old "Add a blank one" button — has no words in
  any bundle, and every reader skips it. Rows imported or picked from the catalog, which is all of
  the seeded data and all of the published templates, carry their slug and are unaffected.
- `diver.json` grows ~25 KB per locale. It is imported statically and server-side, and `marineLife`
  is its own top-level namespace, so no `DiverIntlProvider` ships it to a browser.
- The CSV export keeps its column shape and fills the word columns from the shop's default locale.
  `catalog_slug` is the column that is now the record; the rest is a rendering, and the file note
  says so.
- The staff bundle loses seven `diveSites.form.fieldGuide.*` keys (the per-field labels and
  placeholders) and rewrites three more. There is no longer a "not in the catalog, added with the
  name you typed" path, so that string becomes a refusal.
