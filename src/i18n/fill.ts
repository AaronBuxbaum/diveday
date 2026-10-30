/**
 * Fills `{name}` placeholders in an already-translated string — the one
 * implementation shared by every client component that composes copy at
 * render time from props a server component translated ahead of it (never a
 * translator itself; that never crosses the client boundary).
 *
 * **Fetch that template with `t.raw(key)`, never `t(key)`.** `t()` *formats*,
 * so on a message with a placeholder it looks for an argument that by
 * definition is not there yet — the whole point of this helper is that the
 * value is client-derived (the current instant, `window.location.origin`) and
 * cannot be known on the server. That raised an ICU `FORMATTING_ERROR` on every
 * such call, and until 2026-08-14 both translators were built with
 * `onError: () => {}`, so it was swallowed and the template happened to survive
 * as the fallback. Seven call sites were relying on that accident. `t.raw()` is
 * the supported way to ask for a message without formatting it, and it says at
 * the call site that a template is what was wanted.
 */

import { cachedPluralRules } from "@/lib/intl-cache";
export function fill(
  template: string,
  values: Record<string, string | number | undefined>,
): string {
  // A key that is *present but undefined* is the same as absent, not
  // `String(undefined)`. Callers pass all-optional parameter bags straight in
  // (`ImportIssue.params`, whose fields differ per issue code), so a template
  // placeholder that this particular row has no value for must survive as
  // itself rather than rendering the word "undefined" to a shop.
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    values[key] === undefined ? match : String(values[key]),
  );
}

/**
 * Selects `forms.one` when `Intl.PluralRules` returns `one`, and `forms.other`
 * for every other category. Use ICU messages when more forms are needed.
 * When omitted, `locale` defaults to the runtime's locale.
 */
export function pluralForm(
  count: number,
  forms: { one: string; other: string },
  locale?: string,
): string {
  return cachedPluralRules(locale).select(count) === "one" ? forms.one : forms.other;
}
