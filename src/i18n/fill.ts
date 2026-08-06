/**
 * Fills `{name}` placeholders in an already-translated string — the one
 * implementation shared by every client component that composes copy at
 * render time from props a server component translated ahead of it (never a
 * translator itself; that never crosses the client boundary).
 */

import { cachedPluralRules } from "@/lib/intl-cache";
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in values ? String(values[key]) : match,
  );
}

/**
 * Picks the correct translated form of a `{ one, other }` pair for `count`,
 * using the runtime's actual plural rules rather than a hand-rolled
 * `count === 1` check. English and Spanish (DiveDay's two locales today)
 * both resolve to exactly "one"/"other", so the naive check happened to
 * work — but it would silently mis-handle any locale with more plural
 * categories (Arabic, Polish, …) the day one is added. `locale` defaults to
 * the runtime's own locale, which is what these client components render
 * copy for since the words themselves already crossed from the server
 * translated.
 */
export function pluralForm(
  count: number,
  forms: { one: string; other: string },
  locale?: string,
): string {
  return cachedPluralRules(locale).select(count) === "one" ? forms.one : forms.other;
}
