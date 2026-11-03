import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { nowDate } from "@/lib/clock";
import { toDiverLocale } from "./settings";
import { type StaffMessages, staffMessagesFor } from "./staff-messages";

/** A top-level staff section (`calendar`, `trips`, …): one file under `locales/<locale>/staff/`. */
export type StaffNamespace = keyof StaffMessages;

/**
 * Makes `useStaffTranslations()` work inside the staff Client Components under it
 * (ADR 20260811-staff-copy-provider, which supersedes the "no provider" stance of
 * 20260730-staff-copy-localization). Only the named staff namespaces cross to the client.
 *
 * The same rules as `DiverIntlProvider` hold: every config prop is passed explicitly, because
 * DiveDay installs no next-intl request config, and `namespaces` is required and never defaults
 * to everything. A staff namespace may only be named by a provider mounted under `src/app/shop`
 * or `src/app/offline-manifest` (`pnpm check:architecture`), so staff copy still never reaches an
 * anonymous page.
 */
export function StaffIntlProvider({
  locale,
  timeZone,
  namespaces,
  children,
}: {
  locale: string;
  timeZone: string;
  namespaces: readonly StaffNamespace[];
  children: ReactNode;
}) {
  const resolved = toDiverLocale(locale);
  const bundle = staffMessagesFor(resolved);
  const messages: Partial<StaffMessages> = {};
  for (const namespace of namespaces) {
    // One namespace at a time, so each assignment keeps its own type.
    (messages as Record<string, unknown>)[namespace] = bundle[namespace];
  }
  return (
    <NextIntlClientProvider
      locale={resolved}
      messages={messages as never}
      timeZone={timeZone}
      now={nowDate()}
      formats={{}}
    >
      {children}
    </NextIntlClientProvider>
  );
}
