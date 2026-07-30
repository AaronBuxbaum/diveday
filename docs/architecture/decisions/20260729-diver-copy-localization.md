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

**No routing, no `[locale]` segment, no middleware.** This is the one place DiveDay departs from
next-intl's usual setup, and it is deliberate: the locale is a property of the **shop row**, not of
the request. A Cozumel shop's page is Spanish for every visitor, and an `/es/` path would imply a
per-visitor choice that does not exist. So the explicit-locale APIs are used throughout, and the
locale is read from `shops.default_locale` inside the page that already loaded the shop.

**ICU, so plurals are the translator's problem.** "1 review" / "2 reviews" and "1 opinión" /
"3 opiniones" are one message with a `plural` clause, not a ternary in a component picking between two
keys — because the number of plural forms is a property of the language, and a ternary hard-codes
English's two.

**A second real locale, not just the machinery.** `es-ES` ships fully translated. A localization
feature with exactly one locale is untested by construction, and Spanish is the language DiveDay's
own target market (Caribbean, Mediterranean) most often needs. It is a first-pass translation and is
recorded in [human-decisions.md](../../product/human-decisions.md) as needing native review before it
is offered to a shop as production-ready.

**`pnpm check:locale` enforces both halves.** It fails on a hard-coded `"en-US"` anywhere under the
diver-facing routes, and on any key present in the default bundle but missing (or carrying different
ICU arguments) in another locale. Both are mechanically decidable; "is this string literal English
prose?" is not, and stays a review expectation.

**Scope is the diver-facing surface, and stops short of the waiver.** Public schedule, trip, and
course pages, the booking form, and the post-trip recap are translated. Staff screens under
`/shop/**` stay English — they are an internal tool for a team that chose the software. The waiver
body and the medical questionnaire are excluded **on purpose**: that wording is legally reviewed, and
translating a liability release or a medical screening question is a sign-off decision, not an
engineering one (H-01/H-03). `/ready` is excluded with them, since its content is largely those same
readiness and medical explanations. The check script's scope encodes exactly this boundary.

## Alternatives considered

- **Keep the hand-rolled `LocalizedCopy` tree** (the shape this replaces) — it worked, and a
  type-level leaf/branch discriminator made it type-safe. Rejected anyway: it had no plural support,
  no established file format a translator or a translation service can consume, and it was a bespoke
  thing to maintain where a well-supported library exists.
- **`i18next` + `react-i18next`** — the other standard option, and briefly installed. Rejected for
  this codebase: `react-i18next` is context-based and therefore Client-Component-only, so an App
  Router app needs a second, separate server path and two ways of doing the same thing. next-intl
  covers Server and Client Components with one API and one message format.
- **Locale in the URL** (`/es/shop/…`, next-intl's routing setup) — rejected above; it models a
  per-visitor choice DiveDay does not have.
- **Machine translation at render time** — rejected. Non-deterministic output on a page that has to
  be pixel-stable for visual regression, a per-request cost on the hottest public page, and no way for
  a shop to correct a bad rendering of its own trip name.

## Consequences

Adding a language is now adding one JSON file and one entry in `DIVER_LOCALES`; a shop picks it in
Settings. Dates, times, and money on every diver-facing page follow the shop's locale, which fixes a
real latent bug independent of translation.

`LocalizedCopy` (`src/lib/localized-copy.ts`) survives for the *data* case the earlier ADR was also
about — shop-authored values that may one day be stored per-locale. It is no longer used for static UI
copy.

What this makes harder: the diver bundle crosses to the client on pages with Client Components, so
adding a very large namespace would show up in the bundle. It is one small namespace today; if it
grows, split it and load per-surface. And a shop that switches to Spanish gets Spanish public pages
but an English waiver and readiness page — a visible seam, and the honest one until the legal
translation clears.
