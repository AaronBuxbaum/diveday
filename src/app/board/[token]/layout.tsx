import type { ReactNode } from "react";
import { ErrorBoundaryIntlProvider } from "@/i18n/ErrorBoundaryIntlProvider";
import { ERROR_BOUNDARY_MESSAGES_BY_LOCALE } from "@/i18n/error-boundary-messages";

/**
 * This layout exists for one reason: to put translated words above
 * `error.tsx` for the departures board a shop opens on a lobby TV (ADR
 * 20260803-error-boundary-copy-bridge).
 *
 * Deliberately **synchronous**, like every bearer-token layout after ADR
 * 20260804-instant-navigation: a layout wraps `children`, so an awaited
 * `requestLocale()` here would cost the route its static shell — the very
 * shell a screen paints its frame from while the token verifies.
 */
export default function BoardTokenLayout({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundaryIntlProvider messagesByLocale={ERROR_BOUNDARY_MESSAGES_BY_LOCALE}>
      {children}
    </ErrorBoundaryIntlProvider>
  );
}
