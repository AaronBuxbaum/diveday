import { createTranslator } from "next-intl";
import enUS from "./locales/en-US/staff";
import esES from "./locales/es-ES/staff";
import { translatorOnError } from "./on-error";
import { DEFAULT_DIVER_LOCALE, type DiverLocale, toDiverLocale } from "./settings";

/**
 * The staff-facing message bundle — the `/shop/**` counterpart to
 * `./messages.ts` (docs ADR 20260730-staff-copy-localization).
 *
 * **Server-side only, on purpose.** There is no `StaffIntlProvider` and staff
 * copy never crosses to the client as a message bundle. Two reasons:
 *
 * 1. `useTranslations()` types against the single global `AppConfig.Messages`
 *    augmentation, which is the diver bundle. A second client-side bundle
 *    would have to either widen that type — making every diver `t()` call
 *    accept keys its provider cannot resolve — or ship both bundles to every
 *    visitor.
 * 2. Staff copy has no business in an anonymous diver's JavaScript payload.
 *
 * A staff Client Component therefore receives its words as props from the
 * Server Component that rendered it. That is a real constraint on how staff
 * UI is written, and it is the point: the copy stays on the server, and the
 * client bundle stays small.
 */

export const STAFF_MESSAGES = {
  "en-US": enUS,
  "es-ES": esES,
} as const satisfies Record<DiverLocale, unknown>;

export type StaffMessages = (typeof STAFF_MESSAGES)["en-US"];

export function staffMessagesFor(locale: string | null | undefined): StaffMessages {
  return STAFF_MESSAGES[toDiverLocale(locale)] as StaffMessages;
}

/**
 * A translator over the staff bundle. Types are inferred from the `messages`
 * argument rather than from `AppConfig`, so this coexists with the diver
 * translator without either one widening the other's key space.
 */
export function staffTranslator(locale: string | null | undefined) {
  const resolved = toDiverLocale(locale);
  return createTranslator({
    locale: resolved,
    messages: staffMessagesFor(resolved),
    onError: translatorOnError,
    getMessageFallback: ({ key }) => staffFallbackMessage(key),
  });
}

export type StaffTranslator = ReturnType<typeof staffTranslator>;

/** A key the staff bundle actually holds — a typo is a type error, not a rendered key. */
export type StaffMessageKey = Parameters<StaffTranslator>[0];

/** The English string for a key, used when a translation is missing entirely. */
function staffFallbackMessage(key: string): string {
  const value = key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
      STAFF_MESSAGES[DEFAULT_DIVER_LOCALE],
    );
  return typeof value === "string" ? value : key;
}
