import { headers } from "next/headers";
import { diverTranslator } from "./messages";
import { firstHandLocale, negotiateLocale } from "./negotiate";
import type { DiverLocale } from "./settings";

/**
 * The locale for the current request: what the visitor's device asked for if
 * DiveDay carries it, otherwise the shop's stored default
 * (docs ADR 20260729-diver-copy-localization).
 *
 * Reading `headers()` opts a route into dynamic rendering. Every caller is
 * already dynamic — the public pages call `connection()` because a schedule is
 * live data, and the staff surfaces are session-gated — so this costs nothing
 * that wasn't already being paid.
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
