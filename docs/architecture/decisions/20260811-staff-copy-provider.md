# 20260811-staff-copy-provider — A staff provider replaces hand-typed word props

- **Status:** Accepted
- **Date:** 2026-11-03
- **Supersedes:** the "no `StaffIntlProvider`" decision in [20260730-staff-copy-localization](20260730-staff-copy-localization.md) (point 1 only; the ratchet, the codes-not-sentences rule and the proof surfaces stand)

## Context

That ADR kept staff copy server-side for two reasons: `useTranslations()` types against one global `AppConfig.Messages` (the diver bundle), and staff copy has no business in an anonymous visitor's JavaScript. The cost was a prop-drilling pattern: 173 staff `.tsx` files reference `StaffTranslator`, and a client component such as the calendar panel took a 24-field hand-typed `Copy` object that the page filled one `t()` call at a time (issue #2771).

## Decision

Both reasons are met by mechanism instead of prohibition.

1. **`StaffIntlProvider`** (`src/i18n/StaffIntlProvider.tsx`) carries only the staff namespaces it is given, explicit config like `DiverIntlProvider`.
2. **`useStaffTranslations(namespace)`** (`src/i18n/use-staff-translations.ts`) is typed against the staff bundle, so a missing key is a type error. It is the only place the cast from next-intl's diver-typed hook lives, which leaves `AppConfig.Messages` untouched.
3. **A guard** (`pnpm check:architecture`) refuses both names outside `src/app/shop/**` and `src/app/offline-manifest/**`, so an anonymous page cannot mount a staff namespace.

Server Components keep `staffTranslator`. A client component converts when it is next touched; the hand-typed copy types and `copy={{ }}` assemblies go with each conversion. `CalendarFeedPanel` is the first.

## Alternatives considered

- **Keep the props.** Safe, and what ships today, but every staff client component pays 24 hand-typed fields and a page that assembles them, and the pattern never shrinks.
- **Widen `AppConfig.Messages` to include staff keys.** Every diver `t()` call would then accept keys its provider cannot resolve; refused in the original ADR and still refused.
- **One provider with a `staff` section and a runtime check.** A runtime miss renders a key; the import-level guard fails the build instead.

## Consequences

- Staff copy for a namespace now ships to the client of the page that mounts its provider. That page is behind a staff session, as `/offline-manifest` already is.
- A namespace missing from `namespaces` renders as its key, the same silent failure the diver provider has.
- Nothing is lost on conversion: the bundles, keys and Spanish are unchanged.
