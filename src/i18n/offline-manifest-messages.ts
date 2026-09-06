import { createTranslator } from "next-intl";
import enManifest from "./locales/en-US/staff/manifest.json";
import enShared from "./locales/en-US/staff/shared.json";
import esManifest from "./locales/es-ES/staff/manifest.json";
import esShared from "./locales/es-ES/staff/shared.json";
import { translatorOnError } from "./on-error";
import { DEFAULT_DIVER_LOCALE, type DiverLocale, toDiverLocale } from "./settings";

/**
 * **The two staff namespaces the offline boat manifest reads** (issues #1353, #1359,
 * and #1368 which shrank one of them from underneath).
 *
 * `OfflineManifestView` is a Client Component -- it has to be, because the
 * whole point is a manifest that opens from cache on a phone with no signal at
 * the rail -- and it imported `staffTranslator`. That module statically imports
 * both locale barrels, so the route shipped **31 namespaces in two locales, 62
 * JSON modules**, for the handful it reads. At 438.9 KB gzip first load it was the
 * heaviest page in the app by a wide margin, against a 237.3 KB floor, and the
 * next largest browser-byte item was about ten times smaller.
 *
 * **Then two, not three** (issue #1359). `trips` was here for six keys — the
 * emergency card and one heading — out of 613 lines, and every one of them is
 * read on a manifest surface rather than in the departure editor where that
 * copy had accumulated. Moving those six across and dropping the namespace is
 * worth ~23 KB gzip of the two locales' departure-editor bundle; the keys
 * themselves are 301 bytes, so the saving is entirely the 612 lines left
 * behind.
 *
 * Note for whoever edits this comment: the guard in
 * `offline-manifest-messages.test.ts` scans this file as raw text, so a
 * namespace written here with a dot after it — the name of its JSON file, say —
 * reads as a use of it and fails the suite. Name a dropped namespace on its
 * own, as above. Teaching the scan to skip comments would mean teaching it
 * where the strings are, and a stripper that guesses wrong deletes a real
 * `t()` call from the scan silently, on a safety surface.
 *
 * **Then the same problem one layer in, fixed at the cause** (issue #1368). Two
 * rounds of narrowing had made `shared` the answer, and `shared` had itself
 * become too wide: the manifest reached 15 of its 41 subtrees and shipped the
 * other 26, the largest being the shop home's own `today` copy at ~27.5 KB
 * minified across the two locales — on a route that renders no shop home. The
 * fix was not a third narrowing here but giving `today` its own area bundle, as
 * ADR 20260807-per-area-staff-bundles says an area gets. Nothing in this file
 * changed; `shared.json` got smaller beneath it, and so did every other staff
 * bundle that imports it.
 *
 * **Its own module, not a second export beside `staffTranslator`.** Putting the
 * narrow composer in `staff-messages.ts` would leave the saving resting on
 * export-level tree-shaking of `STAFF_MESSAGES` -- which may well work, and
 * which nothing here would verify. A separate module that never imports the
 * barrels cannot regress that way: the bytes are absent because the import is.
 *
 * Adding a namespace here is deliberate and costs a crew member at the rail its
 * whole download, however few keys are wanted from it. The set is pinned in
 * `offline-manifest-messages.test.ts` against the keys the view and its helpers
 * actually reach — narrowed to these two in the same change, which is what
 * makes `trips` staying out enforceable rather than incidental.
 *
 * **Both locales stay statically imported, and that is not an oversight.**
 * Splitting them behind a dynamic import would halve this again, and it is the
 * wrong trade on this exact surface: the service worker discovers assets by
 * regexing the shell HTML plus one level of lazy chunks
 * (`lazyChunkEntries`, explicitly best-effort over minified JavaScript), and
 * `cacheOfflineShell` is all-or-nothing. A locale chunk it failed to find means
 * a Spanish divemaster reloading at the dock lands in the error boundary
 * instead of the roll call. Fewer bytes is worth having here — 107 KB less is
 * directly fewer failed saves on a marina connection — but not at the cost of
 * the offline guarantee the page exists for.
 */
const OFFLINE_MANIFEST_MESSAGES = {
  "en-US": { manifest: enManifest, shared: enShared },
  "es-ES": { manifest: esManifest, shared: esShared },
} as const satisfies Record<DiverLocale, unknown>;

export type OfflineManifestMessages = (typeof OFFLINE_MANIFEST_MESSAGES)["en-US"];

/**
 * A translator over those two namespaces and nothing else.
 *
 * Same shape as `staffTranslator`, deliberately: types inferred from the
 * `messages` argument rather than from `AppConfig`, so this coexists with both
 * the diver and staff translators without widening either one's key space.
 */
export function offlineManifestTranslator(locale: string | null | undefined) {
  const resolved = toDiverLocale(locale);
  return createTranslator({
    locale: resolved,
    messages: OFFLINE_MANIFEST_MESSAGES[resolved] as OfflineManifestMessages,
    onError: translatorOnError,
    getMessageFallback: ({ key }) => offlineManifestFallback(key),
  });
}

export type OfflineManifestTranslator = ReturnType<typeof offlineManifestTranslator>;

/**
 * The English string for a missing key -- walking **these two namespaces**,
 * never the whole staff bundle.
 *
 * This is the half of the change that is easy to get silently wrong. Reusing
 * `staffFallbackMessage` from `staff-messages.ts` would pull all 31 en-US
 * namespaces back in at runtime through this one reference, turning roughly
 * -109 KB gzip into -57 KB, and no guard in the repository reports the
 * difference. The duplication is a few lines; the alternative is half the
 * saving, invisibly.
 */
function offlineManifestFallback(key: string): string {
  const value = key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
      OFFLINE_MANIFEST_MESSAGES[DEFAULT_DIVER_LOCALE],
    );
  return typeof value === "string" ? value : key;
}
