import { DIVER_LOCALES, type DiverLocale, isDiverLocale, toDiverLocale } from "./settings";

/**
 * Which language to render for whoever just loaded the page.
 *
 * DiveDay does not ask. There is no language switcher and no `/es/` URL — a
 * diver opening a shop's schedule gets the page in the language their device
 * says they read, and a shop's own stored default is the fallback when we carry
 * nothing they asked for (docs ADR 20260729-diver-copy-localization).
 */

type Preference = { tag: string; quality: number };

/**
 * Parse an `Accept-Language` header into preferences, best first. Malformed
 * entries are skipped rather than throwing — this is an attacker-controllable
 * header on a public page, so it never gets to be the reason a page 500s.
 */
export function parseAcceptLanguage(header: string | null | undefined): Preference[] {
  if (!header) return [];
  return header
    .split(",")
    .flatMap((part) => {
      const [tagPart, ...params] = part.trim().split(";");
      const tag = tagPart?.trim();
      if (!tag) return [];
      const qParam = params.find((param) => param.trim().startsWith("q="));
      const quality = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
      if (!Number.isFinite(quality) || quality <= 0) return [];
      return [{ tag, quality }];
    })
    .sort((a, b) => b.quality - a.quality);
}

/**
 * The best supported locale for these preferences, or null when none match.
 *
 * Matching is two-pass: an exact tag first (`es-ES`), then the primary subtag
 * (`es-MX`, `es-419`, and bare `es` all reach `es-ES`). The second pass is the
 * one that matters in practice — almost nobody's device asks for `es-ES`
 * exactly, and refusing `es-MX` would leave a Mexican diver reading English on
 * a Cozumel shop's page.
 *
 * `*` is deliberately ignored: it means "anything", which is not a preference,
 * and honouring it would let a wildcard outrank the shop's own default.
 */
export function matchLocale(preferences: readonly Preference[]): DiverLocale | null {
  for (const { tag } of preferences) {
    if (isDiverLocale(tag)) return tag;
  }
  for (const { tag } of preferences) {
    if (tag === "*") continue;
    const primary = tag.split("-")[0]?.toLowerCase();
    if (!primary) continue;
    const match = DIVER_LOCALES.find((locale) => locale.split("-")[0].toLowerCase() === primary);
    if (match) return match;
  }
  return null;
}

/**
 * The locale to render: what the visitor's device asked for if we carry it,
 * otherwise the shop's own stored default. Pure, so the negotiation rule is
 * testable without a request.
 */
export function negotiateLocale(
  acceptLanguage: string | null | undefined,
  shopDefaultLocale: string | null | undefined,
): DiverLocale {
  return matchLocale(parseAcceptLanguage(acceptLanguage)) ?? toDiverLocale(shopDefaultLocale);
}
