# 20260729-diver-copy-localization — next-intl for the diver-facing surface

- **Status:** Accepted
- **Date:** 2026-07-29
- **Supersedes:** the locale-ready copy slice in
  [20260729-staffing-waiver-audit-and-localized-copy](20260729-staffing-waiver-audit-and-localized-copy.md)

## Context

That earlier ADR shipped a `LocalizedCopy` primitive (`string | Record<locale, string>`) and two small
dictionaries covering about a dozen strings, under the heading "localization-ready capability copy."
The primitive was sound; the coverage was not. Essentially every diver-facing component still had
English compiled into its JSX, and — more damaging in practice — twenty call sites passed a literal
`"en-US"` into `Intl` formatters, so a shop in Cozumel or the Costa Brava would have rendered US date
order and US number grouping forever regardless of what `shops.default_locale` said.

The brainstorm entry this traces to asks for public and capability copy that is "ready for
multilingual shops without hard-coding English into data models." A dictionary nobody reads from is
not that.

## Decision

**next-intl, not a bespoke resolver.** Message bundles are JSON per locale
(`src/i18n/locales/<locale>/diver.json`), Server Components translate with `createTranslator`
(`diverTranslator`, `src/i18n/messages.ts`), and the handful of Client Components on the booking form
use `useTranslations` under a `DiverIntlProvider`. Keys are typed against the English bundle through
next-intl's `AppConfig` augmentation, so a typo is a compile error rather than a key rendered to a
diver.

**The language is negotiated, never asked for.** There is no language switcher, no `/es/` URL
segment, and no next-intl routing middleware. `requestLocale` (`src/i18n/request.ts`) reads the
visitor's `Accept-Language` header and renders the best locale DiveDay carries, falling back to the
shop's own `shops.default_locale` and then to English. Matching is two-pass — exact tag, then primary
subtag — so `es-MX`, `es-419`, and bare `es` all reach `es-ES`; requiring an exact `es-ES` would
leave a Mexican diver reading English on a Cozumel shop's page. The `*` wildcard is ignored, because
"anything" is not a preference and should not outrank the shop's own default.

A switcher is deliberately not built yet. The header is what the diver's own device already says
about them, so the common case needs no interaction at all; a switcher is worth building when
someone reports the negotiated answer being wrong, not before. Because the explicit-locale APIs are
used throughout (`createTranslator`, `NextIntlClientProvider` with an explicit `locale`), adding one
later is a change of input to one function, not a re-architecture.

**ICU, so plurals are the translator's problem.** "1 review" / "2 reviews" and "1 opinión" /
"3 opiniones" are one message with a `plural` clause, not a ternary in a component picking between two
keys — because the number of plural forms is a property of the language, and a ternary hard-codes
English's two.

**A second real locale, not just the machinery.** `es-ES` ships fully translated. A localization
feature with exactly one locale is untested by construction, and Spanish is the language DiveDay's
own target market (Caribbean, Mediterranean) most often needs. It is a first-pass translation and is
recorded in [human-decisions.md](../../product/human-decisions.md) as needing native review before it
is offered to a shop as production-ready.

**`pnpm check:locale` enforces both halves.** It fails on a hard-coded `"en-US"` anywhere under
`src/app` or `src/components`, and on any key present in the default bundle but missing (or carrying
different ICU arguments) in another locale. Both are mechanically decidable; "is this string literal
English prose?" is not, and stays a review expectation — which is exactly why the staff-copy gap
above has to be tracked in prose rather than by a script.

**Two scopes, and they are deliberately different sizes.**

*Locale-correct formatting is app-wide, and done.* Every date, time, and money figure rendered
anywhere under `src/app` or `src/components` — staff screens included — now formats for the
negotiated locale. This was the more damaging of the two problems: 81 call sites across 32 files
passed a compiled-in `"en-US"` to `Intl`, so no amount of translation would have fixed the date order
on a staff screen. `pnpm check:locale` guards the whole UI tree against a regression.

*Translated copy is the diver-facing surface, and is not yet app-wide.* The public schedule, trip,
and course pages, the booking form, and the post-trip recap read from the message bundles. Staff
screens under `/shop/**` still have English prose compiled into them — roughly 16,000 lines of TSX
across ~89 route files and ~52 components — and extracting it is a large mechanical job that has not
been done. This is a known, stated gap, not a claim of completeness.

*The waiver body and the medical questionnaire stay English regardless.* That wording is legally
reviewed, and translating a liability release or a medical screening question is a sign-off decision,
not an engineering one (H-01/H-03). Note that the waiver *template body* is shop data
(`waiver_templates.body`), so it was never reachable by a UI dictionary anyway; the medical questions
in `src/lib/medical.ts` are code and could be extracted, but must not be translated before that
sign-off.

## Alternatives considered

- **Keep the hand-rolled `LocalizedCopy` tree** (the shape this replaces) — it worked, and a
  type-level leaf/branch discriminator made it type-safe. Rejected anyway: it had no plural support,
  no established file format a translator or a translation service can consume, and it was a bespoke
  thing to maintain where a well-supported library exists.
- **`i18next` + `react-i18next`** — the other standard option, and briefly installed. Rejected for
  this codebase: `react-i18next` is context-based and therefore Client-Component-only, so an App
  Router app needs a second, separate server path and two ways of doing the same thing. next-intl
  covers Server and Client Components with one API and one message format.
- **Locale in the URL** (`/es/shop/…`, next-intl's routing setup) — rejected. It requires the visitor
  to have made a choice before the first render, which is exactly what negotiating from
  `Accept-Language` avoids, and it splits every public page across two crawlable URLs (a real cost
  now that those pages carry canonical tags and structured data).
- **A shop-level language setting as the primary source** — built first, then removed. It made a
  shop's page one language for every visitor on earth, which is the wrong default for a dive
  destination whose divers fly in from everywhere. The column survives as the fallback for a visitor
  whose device asks for a language DiveDay does not carry: a Cozumel shop can still read Spanish to a
  German diver rather than English.
- **Machine translation at render time** — rejected. Non-deterministic output on a page that has to
  be pixel-stable for visual regression, a per-request cost on the hottest public page, and no way for
  a shop to correct a bad rendering of its own trip name.

## Consequences

Adding a language is now adding one JSON file and one entry in `DIVER_LOCALES`; every visitor whose
device asks for it gets it, with no configuration by the shop and no action by the diver. Dates,
times, and money on every diver-facing page follow that negotiated locale, which fixes a real latent
bug independent of translation.

Because the locale now varies per visitor, these pages are per-request rendered — they already were
(`connection()`, live schedule data), but a future move to caching them must key the cache on the
negotiated locale via `Vary: Accept-Language`, or two visitors will share one language.

`LocalizedCopy` (`src/lib/localized-copy.ts`) survives for the *data* case the earlier ADR was also
about — shop-authored values that may one day be stored per-locale. It is no longer used for static UI
copy.

What this makes harder: the diver bundle crosses to the client on pages with Client Components, so
adding a very large namespace would show up in the bundle. It is one small namespace today; if it
grows, split it and load per-surface. And a Spanish-reading diver currently gets Spanish public pages
but an English waiver and readiness page — a visible seam, and the honest one until the legal
translation clears.
