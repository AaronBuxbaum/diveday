import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { nowDate } from "@/lib/clock";
import { messagesFor } from "./messages";
import { toDiverLocale } from "./settings";

/**
 * Makes `useTranslations()` work inside the Client Components on a diver-facing
 * page. Server Components use `diverTranslator()` directly and never need this.
 * Only the diver namespace crosses to the client, so staff copy is never
 * shipped to an anonymous visitor.
 *
 * **Every** config prop is passed explicitly, and that is load-bearing rather
 * than merely thorough. Rendered from a Server Component,
 * `NextIntlClientProvider` resolves any prop it was *not* given from next-intl's
 * request config — a `getRequestConfig` module found by next-intl's Next plugin.
 * DiveDay does not install that plugin, because its locale comes from the shop
 * row the surrounding Server Component already loaded rather than from the URL
 * (see ./settings.ts and docs ADR 20260729-diver-copy-localization). Leave one
 * prop off and the provider reaches for a config file that isn't there, throws
 * during the server render, and the whole page falls back to client-only
 * rendering — a 200 with nothing in it, which is exactly how this surfaced.
 *
 * - `locale`/`messages`: the shop's, negotiated per request.
 * - `timeZone`: the shop's, so a client-rendered time never lands in whatever
 *   zone the server process happens to run in.
 * - `now`: through `nowDate()`, which the e2e fleet freezes — a live clock here
 *   would move relative time under every visual baseline.
 * - `formats`: none. DiveDay formats dates and money through `src/lib/format.ts`
 *   against an explicit locale, not through next-intl's global presets.
 */
export function DiverIntlProvider({
  locale,
  timeZone,
  children,
}: {
  locale: string;
  timeZone: string;
  children: ReactNode;
}) {
  const resolved = toDiverLocale(locale);
  return (
    <NextIntlClientProvider
      locale={resolved}
      messages={messagesFor(resolved)}
      timeZone={timeZone}
      now={nowDate()}
      formats={{}}
    >
      {children}
    </NextIntlClientProvider>
  );
}
