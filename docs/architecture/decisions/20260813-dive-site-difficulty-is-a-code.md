# 20260813-dive-site-difficulty-is-a-code — A site's difficulty is one of three codes with a translated label, not the shop's adjective

- **Status:** Accepted
- **Date:** 2026-08-13
- **Extends:** 20260813-marine-life-is-diveday-copy, which drew the line between what a shop
  authors and what DiveDay does. This applies that line to the one field on the same page that was
  still on the wrong side of it.

## Context

`dive_sites.difficulty` was free text, capped at 120 characters, with a placeholder suggesting
"Calm, intermediate, advanced". It renders to a diver under an "Experience" heading on the trip
briefing, in the trip's dive-comparison table, and on the site preview grid.

Two things were wrong with that, and the Spanish work made both visible on one screen:

**It did not translate.** A Spanish-reading diver got "EXPERIENCIA / Beginner", because the demo
shop typed English into a text box. It was the last untranslated word on an otherwise fully
translated briefing, and it sat directly beside `fit_tone` — which has been a code with a translated
label since it shipped, chosen from a `<select>` on the same form. The page was inconsistent about
the same question, and the free-text half was the one that broke in Spanish.

**Nothing expressive was being lost by making it a code.** Every value any shop or any of the 34
published templates had ever stored was exactly one of `beginner`, `intermediate`, `advanced` —
lower-case, no variations. The 120-character text box was a hundred characters of freedom nobody
had used.

It was also feeding `siteFit()`, which sniffs `difficulty`, `depth_range` and `current_note` with one
regex to guess a fit tone. That put "the shop deliberately chose *advanced*" and "the shop's current
note happens to contain the word *deep*" into the same bag of evidence, at the same weight.

## Decision

**`dive_sites.difficulty_level` is a `dive_site_difficulty` enum — `beginner` / `intermediate` /
`advanced` — and null means the shop has not said.**

- `src/lib/dive-site-difficulty.ts` holds the codes and `parseDiveSiteDifficulty`, which narrows both
  a posted form value and the legacy free text. `src/i18n/dive-site-labels.ts` holds the words, in
  the shape `DiveSiteLandmarks` already uses for a landmark's `kind`.
- The staff form is a `<select>`, matching `fitTone` immediately below it. Null renders as
  "Not said — the crew will call it" and the briefing falls back to "crew-led", which is exactly
  what an empty text box already did.
- `siteFit()` reads the chosen level *before* the keyword sniff and returns outright on it. A shop
  that says beginner is believed even if its current note mentions a deep channel — the precise
  failure ADR 20260813-dive-site-briefings-are-the-shops-own-words called out and could only fix
  with a separate `fit_tone` override.
- `GlobalDiveSiteBriefing` gains `difficultyLevel` and keeps `difficulty` as legacy. Published
  versions are immutable snapshots, so the old field stays readable forever; the import narrows
  whichever is present.

**What stays the shop's.** Everything that says *why*: `fit_note`, `current_note`, `depth_range`,
`dive_plan`. A three-value scale is a reading the app can name in any language; the sentence
explaining it is the shop's and renders as typed. That is the same split the species catalog made.

## Alternatives considered

**Translate the free text.** Impossible in the model that exists — the row holds one string, so
whichever language the staffer typed is the language every diver gets. It is the identical problem
the field guide had, and the reason that ADR exists.

**Keep it free text and add a code beside it.** Two fields answering one question, and a form that
has to explain which wins. The evidence that the text box was unused is exactly the evidence that
nobody needs both.

**Four or five levels** (adding "all levels" or "expert"). Rejected as inventing a scale: three is
what shops and templates had actually written, and "all levels" is what a null already means.

## Consequences

- One additive migration: a new enum, a new nullable column, and a `WHERE`-bounded backfill that
  matches the three exact values. `dive_sites.difficulty` stays for one release, because the
  previous deployment still selects it while the migration lands (ADR
  20260806-destructive-migration-guard). `FU-20260813-drop-field-guide-text-columns` carries the
  drop alongside the field guide's.
- `DiveSitesPeek` takes a `DiverTranslator` — it rendered a stored string and now renders a label.
- `staff/diveSites.json` loses `difficultyPlaceholder` (a placeholder for a box that is now a
  picker) and gains `difficultyUnset` plus three level names, in both locales.
- A shop that had typed something outside the three words keeps that text in the legacy column and
  reads as "not said" until it opens the form. No shop is in that state today; the backfill would
  have caught them all.
