import { createTranslator } from "next-intl";
import enUS from "./locales/en-US/diver.json";
import esES from "./locales/es-ES/diver.json";
import { translatorOnError } from "./on-error";
import { DEFAULT_DIVER_LOCALE, type DiverLocale, toDiverLocale } from "./settings";

/**
 * The diver-facing message bundles and the server-side translator built from
 * them (docs ADR 20260729-diver-copy-localization).
 *
 * Bundles are imported statically rather than loaded through next-intl's
 * request config, because the locale here comes from a database row read inside
 * the page — there is no request-scoped locale for `getRequestConfig` to
 * resolve. Two small JSON files are cheap to hold; if the set ever grows past a
 * handful, switch to dynamic `import()` per locale.
 */

export const DIVER_MESSAGES = {
  "en-US": enUS,
  "es-ES": esES,
} as const satisfies Record<DiverLocale, unknown>;

export type DiverMessages = (typeof DIVER_MESSAGES)["en-US"];

/** The bundle for a shop's locale, falling back to the default for anything unknown. */
export function messagesFor(locale: string | null | undefined): DiverMessages {
  return DIVER_MESSAGES[toDiverLocale(locale)] as DiverMessages;
}

/** A top-level section of the diver bundle (`"booking"`, `"rental"`, …). */
export type DiverMessageNamespace = keyof DiverMessages;

/**
 * The bundle for a shop's locale, narrowed to only the requested top-level
 * namespaces — an object pick over `DIVER_MESSAGES`.
 *
 * `DiverIntlProvider` serializes whatever this returns into the RSC payload
 * of every page that mounts it, so a page that only renders a couple of
 * Client Components (a contact form, a rental-fit form) should only ever ship
 * those components' namespaces, not the full ~80 KB bundle. See that file's
 * doc comment for why every other config prop stays explicit too.
 */
export function messagesForNamespaces<K extends DiverMessageNamespace>(
  locale: string | null | undefined,
  namespaces: readonly K[],
): Pick<DiverMessages, K> {
  const bundle = messagesFor(locale);
  const picked = {} as Pick<DiverMessages, K>;
  for (const namespace of namespaces) {
    picked[namespace] = bundle[namespace];
  }
  return picked;
}

/**
 * A translator for one shop's locale, for use in Server Components and server
 * actions. Missing keys fall back to `DEFAULT_DIVER_LOCALE` before they fall
 * back to the key itself, so an untranslated string reads as English rather
 * than as `booking.heading` on a diver's screen.
 */
export function diverTranslator(locale: string | null | undefined) {
  const resolved = toDiverLocale(locale);
  return createTranslator({
    locale: resolved,
    // Typed through `messagesFor` so key inference sees one bundle shape
    // rather than a union of every locale's (they are structurally identical
    // — `pnpm check:locale` is what keeps them that way).
    messages: messagesFor(resolved),
    onError: translatorOnError,
    getMessageFallback: ({ key }) => fallbackMessage(key),
  });
}

/** The translator shape a component can accept as a prop. */
export type DiverTranslator = ReturnType<typeof diverTranslator>;

/**
 * A key the diver bundle actually holds. Naming it keeps the notice/label maps
 * that map a query param to its copy readable, and keeps them checked: a typo'd
 * key is a type error at the map rather than a fallback string at render.
 */
export type DiverMessageKey = Parameters<DiverTranslator>[0];

/** The English string for a key, used when a translation is missing entirely. */
function fallbackMessage(key: string): string {
  const value = key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
      DIVER_MESSAGES[DEFAULT_DIVER_LOCALE],
    );
  return typeof value === "string" ? value : key;
}
