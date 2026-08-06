/**
 * One `Intl.*Format` instance per (constructor, locale, options), shared by
 * every module that formats.
 *
 * Constructing an `Intl` formatter does locale-data lookup and pattern
 * compilation; calling `.format()` on an existing one does neither. Measured
 * on a CI-class box: constructing an `Intl.DateTimeFormat` and calling
 * `formatToParts` costs ~75µs against ~6µs for reusing one — **12x** — and an
 * `Intl.ListFormat` ~7µs against ~0.8µs. Every microsecond of that is repaid
 * on every render, because AGENTS.md requires locale-negotiated formatting for
 * every date, time and money figure app-wide.
 *
 * This cache started life inside `format.ts`, where memoizing it cut a
 * contended CI e2e set's failure rate from 6/18 to 0–2/18
 * (`.github/workflows/ci.yml` records the runs). It lives here now because
 * that fix stopped at the file boundary: `zoned.ts` — whose `wallTimeToUtc`
 * builds *three* formatters per single wall-clock conversion, and which 26
 * modules import — kept constructing its own, as did the money, calendar,
 * reporting and export helpers. Same root cause, same fix, wider reach
 * (TEST-M1).
 *
 * The cache is unbounded, but its key space isn't: it is bounded by the shop
 * locales, timezones and option shapes this app actually uses, not by render
 * count. Formatters are stateless, so sharing one across callers is safe.
 */

type AnyFormatter =
  | Intl.DateTimeFormat
  | Intl.NumberFormat
  | Intl.RelativeTimeFormat
  | Intl.ListFormat
  | Intl.PluralRules
  | Intl.Collator
  | Intl.DisplayNames;

const formatterCache = new Map<string, AnyFormatter>();

/** Shared memo for every helper below; the key must carry everything that changes the output. */
function cached<T extends AnyFormatter>(key: string, create: () => T): T {
  const hit = formatterCache.get(key);
  if (hit) return hit as T;
  const made = create();
  formatterCache.set(key, made);
  return made;
}

export function cachedFormatter<T extends AnyFormatter>(
  tag: string,
  Ctor: new (locale: string | undefined, options?: object) => T,
  locale: string | undefined,
  options?: object,
): T {
  return cached(`${tag}|${locale}|${JSON.stringify(options)}`, () => new Ctor(locale, options));
}

/**
 * A conjunction/disjunction list formatter ("Blue Heron, Molasses Reef and
 * Christ of the Abyss"). Named because it is the single most repeated
 * construction in the app: several surfaces built one *inside* a `.map()`,
 * paying the constructor once per row to format one list.
 */
export function cachedListFormat(
  locale: string | undefined,
  options?: Intl.ListFormatOptions,
): Intl.ListFormat {
  return cachedFormatter("list", Intl.ListFormat, locale, options);
}

/**
 * Plural category selection ("1 diver" vs "2 divers").
 *
 * The hottest construction in the app by a wide margin: `src/i18n/fill.ts`
 * calls this for **every** interpolated message with a plural form, on every
 * render, in both bundles. It built a fresh `Intl.PluralRules` each time —
 * which is the same compile-a-locale-ruleset cost as any other `Intl`
 * constructor, paid per word rather than per page.
 */
export function cachedPluralRules(locale: string | undefined): Intl.PluralRules {
  return cachedFormatter("plural", Intl.PluralRules, locale);
}

/** Locale-correct string ordering — for sorting a list of labels, never for identity. */
export function cachedCollator(
  locale: string | undefined,
  options?: Intl.CollatorOptions,
): Intl.Collator {
  return cachedFormatter("collator", Intl.Collator, locale, options);
}

/**
 * Human names for currency/region/language codes. Its own helper because the
 * constructor's shape does not fit `cachedFormatter`: `options` is required,
 * and `locales` is the array form.
 */
export function cachedDisplayNames(
  locale: string,
  options: Intl.DisplayNamesOptions,
): Intl.DisplayNames {
  return cached(
    `display|${locale}|${JSON.stringify(options)}`,
    () => new Intl.DisplayNames([locale], options),
  );
}
