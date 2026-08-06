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
  | Intl.ListFormat;

const formatterCache = new Map<string, AnyFormatter>();

export function cachedFormatter<T extends AnyFormatter>(
  tag: string,
  Ctor: new (locale: string | undefined, options?: object) => T,
  locale: string | undefined,
  options?: object,
): T {
  const key = `${tag}|${locale}|${JSON.stringify(options)}`;
  const cached = formatterCache.get(key);
  if (cached) return cached as T;
  const formatter = new Ctor(locale, options);
  formatterCache.set(key, formatter);
  return formatter;
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
