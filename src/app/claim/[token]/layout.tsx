import type { ReactNode } from "react";
import { ErrorBoundaryIntlProvider } from "@/i18n/ErrorBoundaryIntlProvider";
import { ERROR_BOUNDARY_MESSAGES_BY_LOCALE } from "@/i18n/error-boundary-messages";

/**
 * This layout exists for one reason: to put translated words above
 * `error.tsx` for the seat-claim page a party member opens from a shared
 * link (ADR 20260803-error-boundary-copy-bridge).
 *
 * Deliberately **synchronous**, like every bearer-token layout after ADR
 * 20260804-instant-navigation: a layout wraps `children`, so an awaited
 * `requestLocale()` here would cost the whole route its static shell. Both
 * locales' boundary copy crosses to the client and
 * `ErrorBoundaryIntlProvider` picks between them from `<html lang>` — see
 * src/app/ready/[token]/layout.tsx for the full reasoning.
 */
export default function ClaimTokenLayout({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundaryIntlProvider messagesByLocale={ERROR_BOUNDARY_MESSAGES_BY_LOCALE}>
      {children}
    </ErrorBoundaryIntlProvider>
  );
}
