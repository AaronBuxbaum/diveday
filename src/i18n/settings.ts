/**
 * Locale configuration for the diver-facing surface (docs ADR
 * 20260729-diver-copy-localization).
 *
 * Scope is deliberately the **diver-facing** pages: the public schedule, trip,
 * and course pages, and the post-trip recap. Staff screens under `/shop/**`
 * stay in English, and the waiver body and medical questionnaire are excluded
 * on purpose — that wording is legally reviewed, so translating it is a
 * sign-off decision rather than an engineering one (H-01/H-03 in
 * docs/product/human-decisions.md).
 *
 * Note what this deliberately does *not* set up: next-intl's routing and
 * middleware. DiveDay's locale is a property of the **shop row**
 * (`shops.default_locale`), not of the URL — a Cozumel shop's page is Spanish
 * for every visitor, and an `/es/` path segment would imply a per-visitor
 * choice that doesn't exist. So the explicit-locale APIs are used throughout
 * (`createTranslator` on the server, `NextIntlClientProvider` with an explicit
 * `locale`/`messages` for client components) and there is no `[locale]` route
 * segment.
 */

/** Locales a shop may choose. Adding one means adding its message bundle. */
export const DIVER_LOCALES = ["en-US", "es-ES"] as const;

export type DiverLocale = (typeof DIVER_LOCALES)[number];

export const DEFAULT_DIVER_LOCALE: DiverLocale = "en-US";

export function isDiverLocale(value: unknown): value is DiverLocale {
  return typeof value === "string" && (DIVER_LOCALES as readonly string[]).includes(value);
}

/**
 * A stored `default_locale` narrowed to one we actually carry. A shop row
 * written before a locale was retired (or by some future admin tool) reads as
 * the default rather than rendering blanks on every screen.
 */
export function toDiverLocale(value: string | null | undefined): DiverLocale {
  return isDiverLocale(value) ? value : DEFAULT_DIVER_LOCALE;
}
