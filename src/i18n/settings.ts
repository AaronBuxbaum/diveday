/**
 * Supported locales for diver and staff copy (docs ADRs
 * 20260729-diver-copy-localization and 20260730-staff-copy-localization).
 *
 * Both public diver pages and staff screens use these locales. The waiver body
 * and medical questionnaire remain English — that wording is legally reviewed,
 * so translating it is a sign-off decision rather than an engineering one
 * (H-01/H-03 in docs/product/human-decisions/).
 *
 * Locale is not part of the URL: the reader's cookie choice takes precedence
 * over `Accept-Language` and the shop default. Translators and providers receive
 * the resolved locale explicitly; there is no `[locale]` route segment.
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
