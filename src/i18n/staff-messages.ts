import { createTranslator } from "next-intl";
import enUS from "./locales/en-US/staff";
import esES from "./locales/es-ES/staff";
import { messageFallback } from "./message-fallback";
import { translatorOnError } from "./on-error";
import { DEFAULT_DIVER_LOCALE, type DiverLocale, toDiverLocale } from "./settings";

/**
 * The staff-facing message bundle — the `/shop/**` counterpart to
 * `./messages.ts` (docs ADR 20260730-staff-copy-localization).
 *
 * **Server by default, a provider by exception** (ADR 20260811-staff-copy-provider). A Server
 * Component words things with `staffTranslator`. A staff Client Component reads
 * `useStaffTranslations(namespace)` under a `StaffIntlProvider` that carries only the namespaces
 * it names, mounted somewhere under `src/app/shop`; `pnpm check:architecture` refuses the
 * provider and the hook anywhere else, so staff copy still never reaches an anonymous diver's
 * JavaScript. `useTranslations()` itself types against the diver `AppConfig.Messages`, so the
 * hook is the one place that cast lives.
 *
 * ## The one surface that does ship staff copy, and why it is not a hole
 *
 * `/offline-manifest` renders from an encrypted IndexedDB snapshot on a phone
 * that may have no signal, so it cannot be a Server Component and cannot be
 * handed words as props: there is no server in the loop at the moment it
 * matters. It composes its own translator over **two** namespaces in
 * `./offline-manifest-messages.ts`, and that module deliberately does not
 * import this one.
 *
 * The separation is the safeguard. Importing `staffTranslator` from a Client
 * Component once made that route the heaviest page in the app: it shipped every
 * staff namespace to render a handful (measured in issue #1353). Nothing here
 * stops that happening again, so if
 * a second client surface needs staff words, give it its own narrow module
 * rather than reaching for this one. Reason 2 above still holds either way:
 * that route is behind a staff session, not an anonymous diver's page.
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
    getMessageFallback: ({ key }) => messageFallback(STAFF_MESSAGES[DEFAULT_DIVER_LOCALE], key),
  });
}

export type StaffTranslator = ReturnType<typeof staffTranslator>;

/** A key the staff bundle actually holds — a typo is a type error, not a rendered key. */
export type StaffMessageKey = Parameters<StaffTranslator>[0];
