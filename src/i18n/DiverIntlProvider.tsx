import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { messagesFor } from "./messages";
import { toDiverLocale } from "./settings";

/**
 * Makes `useTranslations()` work inside the Client Components on a diver-facing
 * page. Server Components use `diverTranslator()` directly and never need this.
 *
 * The locale and messages are passed explicitly rather than resolved from
 * next-intl's request config: DiveDay's locale comes from the shop row the
 * surrounding Server Component already loaded, not from the URL (see
 * ./settings.ts). Only the diver namespace crosses to the client, so staff
 * copy is never shipped to an anonymous visitor.
 */
export function DiverIntlProvider({ locale, children }: { locale: string; children: ReactNode }) {
  const resolved = toDiverLocale(locale);
  return (
    <NextIntlClientProvider locale={resolved} messages={messagesFor(resolved)}>
      {children}
    </NextIntlClientProvider>
  );
}
