import { DIVER_MESSAGES } from "./messages";
import { DIVER_LOCALES, type DiverLocale } from "./settings";

/**
 * The `errorBoundary` namespace in every locale DiveDay speaks, as a plain
 * object a Server Component can hand to a Client Component.
 *
 * This exists so an `error.tsx` can have translated words **without its
 * segment layout reading `headers()`** (ADR 20260804-instant-navigation).
 * Every other page picks its locale server-side with `requestLocale()`, which
 * is a per-request read and therefore keeps the whole route out of the static
 * shell — a cost worth paying for a page's real content, and absurd for four
 * strings on a boundary that renders only when something has already gone
 * wrong. Shipping *both* locales instead costs about 600 bytes in the RSC
 * payload and lets the layout be fully static.
 *
 * Import this from a **Server Component only**. It reaches into
 * `DIVER_MESSAGES`, so a Client Component that imported it would pull both
 * ~80 KB diver bundles (and next-intl's translator) into the browser bundle —
 * which is exactly the cost the namespace-narrowing in `messagesForNamespaces`
 * exists to avoid. `ErrorBoundaryIntlProvider` takes this as a prop for that
 * reason and never imports it.
 */
export type ErrorBoundaryMessages = (typeof DIVER_MESSAGES)["en-US"]["errorBoundary"];

export type ErrorBoundaryMessagesByLocale = Record<DiverLocale, ErrorBoundaryMessages>;

export const ERROR_BOUNDARY_MESSAGES_BY_LOCALE = Object.fromEntries(
  DIVER_LOCALES.map((locale) => [locale, DIVER_MESSAGES[locale].errorBoundary]),
) as ErrorBoundaryMessagesByLocale;
