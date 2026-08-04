"use client";

import { NextIntlClientProvider } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";
import type { ErrorBoundaryMessagesByLocale } from "./error-boundary-messages";
import { DEFAULT_DIVER_LOCALE, type DiverLocale, isDiverLocale } from "./settings";

/**
 * Puts the `errorBoundary` namespace above an `error.tsx` **without making the
 * segment layout request-scoped** (ADR 20260804-instant-navigation).
 *
 * `DiverIntlProvider` needs its locale resolved before it renders, and the only
 * source is `requestLocale()` — a `headers()` read. In a segment layout that
 * read blocks the whole route out of a static shell, because a layout wraps
 * `children` and there is nothing to put a `<Suspense>` boundary around: the
 * page cannot render before the provider does. Nine routes paid that price for
 * four strings — the seven bearer-token routes and the public shop namespace.
 *
 * So the locale moves to the client. Both bundles' `errorBoundary` sections
 * arrive as a prop (see `error-boundary-messages.ts` — about 600 bytes, versus
 * ~500 for the one the server used to pick), and this picks between them from
 * `document.documentElement.lang`. That attribute is set before first paint by
 * the root layout's inline `localeCorrectionScript`, off `navigator.languages`
 * — the same list the browser builds `Accept-Language` from, and the same
 * two-pass match (`src/i18n/negotiate.ts`). So the boundary still follows the
 * reader's own device language, which is what ADR
 * 20260803-error-boundary-copy-bridge decided it should do; only *where* that
 * choice is made has moved.
 *
 * The pick runs in an effect rather than during render so the server render and
 * the first client render agree on {@link DEFAULT_DIVER_LOCALE} and nothing
 * hydration-mismatches. In practice nothing under this provider reads copy
 * unless the boundary is showing, so the one-frame default is invisible.
 *
 * `timeZone` and `now` are fixed, and that is safe rather than sloppy: the
 * `errorBoundary` namespace holds no date, time, or money key, so nothing under
 * this provider formats against either. They are passed at all for the reason
 * `DiverIntlProvider`'s doc comment gives — leaving *any* config prop off
 * `NextIntlClientProvider` makes it reach for a `getRequestConfig` module
 * DiveDay does not install, which throws during the server render and degrades
 * the whole page to a blank client-only 200.
 */
const NO_TIME_REFERENCE = new Date(0);

export function ErrorBoundaryIntlProvider({
  messagesByLocale,
  children,
}: {
  messagesByLocale: ErrorBoundaryMessagesByLocale;
  children: ReactNode;
}) {
  const [locale, setLocale] = useState<DiverLocale>(DEFAULT_DIVER_LOCALE);

  useEffect(() => {
    const lang = document.documentElement.lang;
    if (isDiverLocale(lang)) setLocale(lang);
  }, []);

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={{ errorBoundary: messagesByLocale[locale] }}
      timeZone="UTC"
      now={NO_TIME_REFERENCE}
      formats={{}}
    >
      {children}
    </NextIntlClientProvider>
  );
}
