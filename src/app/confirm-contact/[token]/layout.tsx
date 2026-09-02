import type { ReactNode } from "react";
import { ErrorBoundaryIntlProvider } from "@/i18n/ErrorBoundaryIntlProvider";
import { ERROR_BOUNDARY_MESSAGES_BY_LOCALE } from "@/i18n/error-boundary-messages";

/**
 * Puts translated words above `error.tsx` for the contact-confirmation
 * landing page — the same synchronous bridge `/verify/[token]` uses, for the
 * same reason (ADR 20260803-error-boundary-copy-bridge; kept synchronous so
 * the route keeps its static shell, ADR 20260804-instant-navigation).
 */
export default function ConfirmContactTokenLayout({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundaryIntlProvider messagesByLocale={ERROR_BOUNDARY_MESSAGES_BY_LOCALE}>
      {children}
    </ErrorBoundaryIntlProvider>
  );
}
