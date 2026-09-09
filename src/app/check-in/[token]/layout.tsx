import type { ReactNode } from "react";
import { ErrorBoundaryIntlProvider } from "@/i18n/ErrorBoundaryIntlProvider";
import { ERROR_BOUNDARY_MESSAGES_BY_LOCALE } from "@/i18n/error-boundary-messages";

/**
 * Translated words above `error.tsx` for the counter tablet (ADR
 * 20260803-error-boundary-copy-bridge).
 *
 * Deliberately **synchronous**, like every bearer-token layout after ADR
 * 20260804-instant-navigation: a layout wraps `children`, so an awaited
 * `requestLocale()` here would cost the route its static shell — the shell the
 * tablet paints its frame from while the token verifies.
 */
export default function KioskCheckInLayout({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundaryIntlProvider messagesByLocale={ERROR_BOUNDARY_MESSAGES_BY_LOCALE}>
      {children}
    </ErrorBoundaryIntlProvider>
  );
}
