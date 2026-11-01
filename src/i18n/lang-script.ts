import { DEFAULT_DIVER_LOCALE, DIVER_LOCALES } from "./settings";

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

/**
 * Correct the root `<html>` attributes from `navigator.languages` before
 * hydration, mirroring `negotiate.ts`'s exact-then-primary match. The root
 * layout must stay static under Cache Components: `requestLocale()` there
 * would make every route request-bound. Its server-rendered default `lang`
 * and `dir` remain valid when this script does not run. It stays inline under
 * the existing CSP; values embedded in its `<script>` block stay escaped.
 * See ADR `20260804-instant-navigation` and `content-security-policy.ts`.
 */
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
