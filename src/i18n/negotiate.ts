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

/**
 * What this request's own `Accept-Language` asked for, or null when it carried
 * nothing DiveDay speaks.
 *
 * The difference from {@link negotiateLocale} is the whole point: that one
 * always answers with *something*, because a page always has to render — and
 * when the header matched nothing, the something it answers with is the
 * **shop's** preference, not the visitor's. That is fine for rendering and
 * wrong for recording. Anything that wants to remember what a person reads
 * (docs ADR 20260731-per-person-notification-locale) has to be able to tell
 * "they asked for Spanish" apart from "we defaulted to Spanish", so it asks
 * this and stores nothing when the answer is null.
 */
export function firstHandLocale(acceptLanguage: string | null | undefined): DiverLocale | null {
  return matchLocale(parseAcceptLanguage(acceptLanguage));
}

/** A language a visitor asked for and DiveDay has no bundle for. */
export type UnsupportedLanguage = {
  /** The best-quality tag the header offered, verbatim — e.g. `"de-CH"`. */
  tag: string;
  /** Its primary subtag (`"de"`), which is what a language name is looked up by. */
  language: string;
};

/**
 * A language the visitor asked for that DiveDay does not carry — or null when
 * it carried one, or asked for nothing at all.
 *
 * This is the third question about the same header, and the one nothing used
 * to ask. {@link negotiateLocale} answers "what do I render", {@link
 * firstHandLocale} answers "what may I remember about this person"; neither
 * can answer "does this person know why they are reading English". A diver
 * whose device asks for German gets the shop's language with no
 * acknowledgement at all, which is the honest gap in having no switcher by
 * design (review finding I18N-L1) — a switcher would be a lie, since there is
 * no third bundle to switch to, but silence is a smaller lie rather than none.
 *
 * The primary subtag is validated (`de`, `zh`, `fil`) before it leaves here.
 * `Intl.DisplayNames` throws a `RangeError` on a structurally invalid language
 * code, and this header is attacker-controllable on a public page, so the
 * guard is what keeps a junk `Accept-Language` from becoming a 500.
 */
export function unsupportedLanguage(
  acceptLanguage: string | null | undefined,
): UnsupportedLanguage | null {
  const preferences = parseAcceptLanguage(acceptLanguage);
  if (matchLocale(preferences) !== null) return null;
  for (const { tag } of preferences) {
    // Same reasoning as `matchLocale`: `*` means "anything", which is not a
    // request for a language and so is not an unmet one either.
    if (tag === "*") continue;
    const language = tag.split("-")[0]?.toLowerCase();
    if (!language || !/^[a-z]{2,3}$/.test(language)) continue;
    return { tag, language };
  }
  return null;
}
