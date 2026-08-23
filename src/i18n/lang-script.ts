import { DEFAULT_DIVER_LOCALE, DIVER_LOCALES } from "./settings";

/**
 * The root layout's `<html lang>` under Cache Components (ADR pending —
 * see the "cacheComponents" enablement change): the root layout wraps every
 * route in the app, so a server-side `requestLocale()` read there (backed by
 * `headers()`) would make the *entire* app request-bound with no child to
 * wrap in `<Suspense>` — there is nothing between `<html>` and the attribute
 * itself. Next's own sanctioned fix for exactly this shape (a request-derived
 * attribute on `<html>`, migrating-to-cache-components.md's "cookies,
 * headers, and searchParams" section) is an inline pre-hydration `<script>`
 * that corrects the attribute before first paint, mirroring the "Storing the
 * theme in a cookie" pattern in preventing-flash-before-hydration.md.
 *
 * The server still renders `DEFAULT_DIVER_LOCALE` so the static shell, and
 * any crawler that doesn't execute JS, gets a valid `lang` value — and, since
 * 2026-08-23, a `dir` beside it. `globals.css` has carried a `:dir(rtl)` rule
 * for the `<select>` indicator that could never match, because nothing in the
 * app had ever set a direction (issue #733). This script corrects both
 * attributes client-side from `navigator.languages`, mirroring
 * `src/i18n/negotiate.ts`'s two-pass match (exact tag, then primary subtag)
 * closely enough that a browser's own language list and its `Accept-Language`
 * header agree in practice — same source, same order.
 */
/**
 * Escape characters that could break out of a `<script>` tag when JSON is
 * embedded inline in HTML. `JSON.stringify` alone does not escape `<`, `>`,
 * or `/`, so a value containing `</script>` would terminate the surrounding
 * script block. These escapes are valid JavaScript Unicode escape sequences
 * and are transparent to the JS engine.
 */
function escapeForScriptContext(json: string): string {
  return json.replace(/</g, "\\u003C").replace(/>/g, "\\u003E").replace(/\//g, "\\u002F");
}

/**
 * **Which way each shipped locale reads.**
 *
 * `Intl.Locale`'s `textInfo` is the sanctioned way to ask — and it is the one
 * `Intl` constructor `src/lib/intl-cache.ts` deliberately exempts from the
 * formatter cache, being "a parsed locale value, not a compiled formatter".
 * Derived rather than hard-coded so a third locale gets its direction for
 * free; both of today's resolve to `ltr`, which is exactly what makes setting
 * the attribute at all a zero-pixel change.
 */
export function localeDirection(locale: string): "ltr" | "rtl" {
  try {
    // `textInfo` is Stage 3 and shipped in every engine this runs on, but
    // TypeScript's `Intl.Locale` does not declare it yet — so the shape is
    // stated here rather than reached for with `any`. Both call sites are
    // server-side (the root layout, and the pre-hydration script's lookup
    // table, which is built here), so this only ever needs Node's `Intl`.
    const parsed = new Intl.Locale(locale) as Intl.Locale & {
      textInfo?: { direction?: string };
    };
    return parsed.textInfo?.direction === "rtl" ? "rtl" : "ltr";
  } catch {
    // An unparseable tag is not a reason to render a document with no
    // direction; every locale this app ships reads left to right.
    return "ltr";
  }
}

export function localeCorrectionScript(): string {
  const supported = escapeForScriptContext(JSON.stringify(DIVER_LOCALES));
  const fallback = escapeForScriptContext(JSON.stringify(DEFAULT_DIVER_LOCALE));
  // A fixed map of the locales this build ships, resolved here on the server —
  // the script never asks the *visitor* which way their language reads, it
  // only looks up the one it matched. Same escaping as the two values above.
  const directions = escapeForScriptContext(
    JSON.stringify(Object.fromEntries(DIVER_LOCALES.map((tag) => [tag, localeDirection(tag)]))),
  );
  return `(function(){try{var s=${supported};var d=document.documentElement;var langs=(navigator.languages&&navigator.languages.length)?navigator.languages:[navigator.language||${fallback}];var found=null;for(var i=0;i<langs.length;i++){if(s.indexOf(langs[i])!==-1){found=langs[i];break}}if(!found){for(var j=0;j<langs.length&&!found;j++){var p=(langs[j]||"").split("-")[0].toLowerCase();for(var k=0;k<s.length;k++){if(s[k].split("-")[0].toLowerCase()===p){found=s[k];break}}}}var l=found||${fallback};d.lang=l;d.dir=${directions}[l]||"ltr"}catch(e){}})()`;
}
