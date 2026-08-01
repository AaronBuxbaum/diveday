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
 * any crawler that doesn't execute JS, gets a valid `lang` value. This script
 * then corrects it client-side from `navigator.languages`, mirroring
 * `src/i18n/negotiate.ts`'s two-pass match (exact tag, then primary subtag)
 * closely enough that a browser's own language list and its `Accept-Language`
 * header agree in practice — same source, same order.
 */
export function localeCorrectionScript(): string {
  const supported = JSON.stringify(DIVER_LOCALES);
  const fallback = JSON.stringify(DEFAULT_DIVER_LOCALE);
  return `(function(){try{var s=${supported};var d=document.documentElement;var langs=(navigator.languages&&navigator.languages.length)?navigator.languages:[navigator.language||${fallback}];var found=null;for(var i=0;i<langs.length;i++){if(s.indexOf(langs[i])!==-1){found=langs[i];break}}if(!found){for(var j=0;j<langs.length&&!found;j++){var p=(langs[j]||"").split("-")[0].toLowerCase();for(var k=0;k<s.length;k++){if(s[k].split("-")[0].toLowerCase()===p){found=s[k];break}}}}d.lang=found||${fallback}}catch(e){}})()`;
}
