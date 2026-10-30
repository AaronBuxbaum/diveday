import { cookies, headers } from "next/headers";
import { EMBED_LOCALE_HEADER } from "@/lib/embed-routes";
import { type LanguageFallback, languageEndonym, languageNameIn } from "./language-labels";
import { LOCALE_COOKIE } from "./locale-cookie";
import { diverTranslator } from "./messages";
import { firstHandLocale, negotiateLocale, unsupportedLanguage } from "./negotiate";
import { type ReaderUnits, readerUnitsFrom } from "./reader-units";
import { type DiverLocale, isDiverLocale } from "./settings";

/**
 * The language this reader picked for themselves, or null if they never did.
 *
 * Outranks `Accept-Language` everywhere below: a header is what a device was
 * configured to want, a cookie is what the person in front of it actually
 * asked for. An unrecognised value (a retired locale, a hand-edited cookie)
 * reads as no choice rather than as a locale we have no bundle for.
 */
async function chosenLocale(): Promise<DiverLocale | null> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isDiverLocale(value) ? value : null;
}

/**
 * Resolve the request's display language. An explicit reader choice in the
 * `diveday_locale` cookie wins, then the embed's fixed language, then
 * `Accept-Language`; `negotiateLocale` uses the shop default when the header
 * has no supported match. Reading request cookies and headers is request
 * scoped; callers that need a static shell keep this read behind the route's
 * appropriate Suspense boundary (Cache Components are enabled).
 */
export async function requestLocale(shopDefaultLocale?: string | null): Promise<DiverLocale> {
  const chosen = await chosenLocale();
  if (chosen) return chosen;
  const requestHeaders = await headers();
  // An embed the shop fixed to one language (Harbor's generator, "Language")
  // is that language: the widget sits on a page already in it, and the
  // visitor's cookie cannot reach a third-party frame anyway. Only a locale
  // DiveDay speaks; anything else falls through to the usual order.
  const fixed = requestHeaders.get(EMBED_LOCALE_HEADER);
  if (isDiverLocale(fixed)) return fixed;
  const header = requestHeaders.get("accept-language");
  return negotiateLocale(header, shopDefaultLocale);
}

/**
 * The units this reader thinks in, beside the shop's (fifth-loop ideas, item
 * 22; the rule is `readerUnitsFrom`'s). Only for a diver page that already
 * reads `headers()` through {@link requestLocale}, so it costs no rendering mode.
 */
export async function requestReaderUnits(locale: DiverLocale): Promise<ReaderUnits> {
  return readerUnitsFrom((await headers()).get("accept-language"), locale);
}

/**
 * The locale this request's own `Accept-Language` asked for, or null when it
 * carried nothing DiveDay speaks — never the shop's fallback.
 *
 * Only for *recording* a person's language (`recordDiverOwnLocale` in
 * src/db/people.ts, docs ADR 20260731-per-person-notification-locale). For
 * rendering, use `requestLocale`: a page must always have words, and the shop's
 * default is the right answer there.
 *
 * Whose header this is is whoever's browser made the request — so a staff-only
 * route calling this reads the *staff* member's language, which says nothing
 * about the diver they are acting on. That is why the storing side is a
 * narrowly-named function of its own rather than a parameter on
 * `findOrCreatePerson`.
 */
export async function requestFirstHandLocale(): Promise<DiverLocale | null> {
  // A deliberate pick is the strongest first-hand evidence there is — stronger
  // than the header, which is a device setting somebody else may have made.
  return (await chosenLocale()) ?? firstHandLocale((await headers()).get("accept-language"));
}

/** `requestLocale` plus a translator bound to it — what most pages want. */
export async function requestTranslator(shopDefaultLocale?: string | null) {
  const locale = await requestLocale(shopDefaultLocale);
  return { locale, t: diverTranslator(locale) };
}

/**
 * The signal a diver gets when their language is one DiveDay does not carry,
 * or null when there is nothing honest to say (they asked for a language we
 * have, or their client sent no preference at all).
 *
 * `shownLocale` is what `requestLocale` already resolved for this render — it
 * is passed in rather than re-negotiated so the notice can never disagree with
 * the page it sits on.
 *
 * Both names come from CLDR (`./language-labels`), not from a bundle: the
 * requested one as its own endonym, because the notice is written in a language
 * its reader cannot read and that token is the only part guaranteed to land.
 * A language the runtime has no name for falls back to the tag the header sent,
 * which is still more than the silence this replaces.
 */
export async function requestLanguageFallback(
  shownLocale: DiverLocale,
): Promise<LanguageFallback | null> {
  // Someone who picked this language is not being fallen back on — they are
  // reading what they asked for, and telling them otherwise would be the app
  // arguing with a choice it just honoured.
  if (await chosenLocale()) return null;
  const unsupported = unsupportedLanguage((await headers()).get("accept-language"));
  if (!unsupported) return null;
  const shownLanguage = shownLocale.split("-")[0];
  return {
    requested: languageEndonym(unsupported.language) ?? unsupported.tag,
    shown: languageNameIn(shownLanguage, shownLocale) ?? shownLocale,
  };
}
