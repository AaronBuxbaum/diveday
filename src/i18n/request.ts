import { headers } from "next/headers";
import { diverTranslator } from "./messages";
import { negotiateLocale } from "./negotiate";
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

/** `requestLocale` plus a translator bound to it — what most pages want. */
export async function requestTranslator(shopDefaultLocale?: string | null) {
  const locale = await requestLocale(shopDefaultLocale);
  return { locale, t: diverTranslator(locale) };
}
