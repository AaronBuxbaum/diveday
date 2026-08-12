/**
 * Where a reader's own language choice lives.
 *
 * DiveDay used to have no switcher at all, deliberately: the language was a
 * property of the shop row plus whatever the device asked for, and an `/es/`
 * URL segment would have implied a per-visitor choice that did not exist (ADR
 * 20260729-diver-copy-localization). Two things were wrong with that in
 * practice. A diver on a borrowed phone, or one whose browser was set up by
 * someone else, had no way to read the page in their own language — and a
 * *staffer* had no way at all, because the staff surface negotiates from the
 * same header. "Ask the person who configured this device" is not an answer a
 * dive shop can give a customer at the counter.
 *
 * So the choice is a cookie rather than a URL: it is a property of the reader,
 * not of the page, and the ADR's real objection — that a locale in the path
 * would fork every public URL and every canonical link — still stands. A shop's
 * schedule has exactly one address, and it reads in whichever language the
 * person in front of it picked.
 *
 * Its own module with no server imports, so the Route Handler that writes it
 * and `src/i18n/request.ts`, which reads it, agree on the name without either
 * importing the other.
 */

/** The cookie holding an explicitly chosen `DiverLocale`. */
export const LOCALE_COOKIE = "diveday_locale";

/**
 * A year. A language choice is not a session preference — someone who picks
 * Spanish at a shop's counter in July should still get Spanish in November,
 * and being asked again every visit is the bug this replaced.
 */
export const LOCALE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
