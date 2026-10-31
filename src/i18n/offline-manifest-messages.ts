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
 * `OfflineManifestView` must be a Client Component so the manifest can open
 * from cache when a phone has no signal. It once imported `staffTranslator`,
 * which pulled in both locale barrels. At that time they contained 31
 * namespaces each (62 JSON modules); the route measured 438.9 KB gzip first
 * load against a 237.3 KB floor (issue #1353).
 *
 * Earlier narrowing moved the emergency-card copy into `manifest.json` and
 * removed the `trips` namespace (issue #1359). The module now composes only
 * `manifest` and `shared`.
 *
 * The test's namespace check strips comments before scanning for message
 * keys, so historical names here do not count as shipped copy.
 *
 * `shared` was later narrowed at its source by moving shop-home copy into a
 * dedicated area bundle (issue #1368; ADR 20260807-per-area-staff-bundles).
 *
 * **Its own module, not a second export beside `staffTranslator`.** Keeping the
 * composer here makes the narrow import set explicit; it does not depend on
 * tree-shaking the full staff barrels.
 *
 * Adding a namespace here is deliberate and adds its copy to the crew member's
 * download at the rail, however few keys are wanted from it. The set is pinned in
 * `offline-manifest-messages.test.ts` against the keys the view and its helpers
 * actually reach — narrowed to these two in the same change, which is what
 * makes `trips` staying out enforceable rather than incidental.
 *
 * **Both locales stay statically imported.** The worker saves the shell only
 * after its HTML-referenced assets load. It also tries to find and cache one
 * level of lazy chunks, best-effort; that scan can miss an asset. Dynamically
 * loading a locale could leave a Spanish crew member without the offline
 * manifest at the dock.
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
 * The English string for a missing key, found only in these two namespaces.
 *
 * Reusing `staffFallbackMessage` from `staff-messages.ts` would import the full
 * English staff bundle here and undo the narrow module's payload boundary.
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
