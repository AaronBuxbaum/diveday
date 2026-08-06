import { headers } from "next/headers";
import { type LanguageFallback, languageEndonym, languageNameIn } from "./language-labels";
import { diverTranslator } from "./messages";
import { firstHandLocale, negotiateLocale, unsupportedLanguage } from "./negotiate";
import type { DiverLocale } from "./settings";

/**
 * The locale for the current request: what the visitor's device asked for if
 * DiveDay carries it, otherwise the shop's stored default
 * (docs ADR 20260729-diver-copy-localization).
 *
 * Reading `headers()` opts a route into dynamic rendering. That's free for the
 * schedule/trip/staff surfaces — they already call `connection()` or sit
 * behind a session — but it is *not* free for the marketing pages (`/`,
 * `/pricing`, `/product`, `/about`, `/switching/**`): they have no session and
 * no live data, so this `headers()` read is the only thing standing between
 * them and a fully static, CDN-cacheable response. `DIVER_LOCALES` (./settings)
 * is exactly two values, so the ideal fix is caching each page's body as a
 * function of the negotiated `DiverLocale` with `"use cache"` + `cacheLife`,
 * keeping only this thin negotiation dynamic.
 *
 * That fix needs the `cacheComponents` flag in `next.config.ts` — without it,
 * `"use cache"` fails the build outright ("To use 'use cache', please enable
 * the feature flag `cacheComponents`..."), and there is no old-model
 * (route-segment-config) way to vary output by request header while still
 * getting a static/ISR classification: `dynamic = 'force-static'` forces
 * `headers()` to read empty, which would silently stop honoring
 * `Accept-Language: es` rather than cache it. So this file still reads
 * `headers()` per request, unmemoized, pending `cacheComponents` — verified by
 * attempting the "use cache" restructuring directly (see the frontend
 * performance audit notes); flip the flag first, then hoist each marketing
 * page's body into a `"use cache"` function keyed by this locale.
 */
export async function requestLocale(shopDefaultLocale?: string | null): Promise<DiverLocale> {
  const header = (await headers()).get("accept-language");
  return negotiateLocale(header, shopDefaultLocale);
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
  return firstHandLocale((await headers()).get("accept-language"));
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
  const unsupported = unsupportedLanguage((await headers()).get("accept-language"));
  if (!unsupported) return null;
  const shownLanguage = shownLocale.split("-")[0];
  return {
    requested: languageEndonym(unsupported.language) ?? unsupported.tag,
    shown: languageNameIn(shownLanguage, shownLocale) ?? shownLocale,
  };
}
