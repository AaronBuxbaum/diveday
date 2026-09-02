import type { ReactNode } from "react";
import { ErrorBoundaryIntlProvider } from "@/i18n/ErrorBoundaryIntlProvider";
import { ERROR_BOUNDARY_MESSAGES_BY_LOCALE } from "@/i18n/error-boundary-messages";

/**
 * Translated words above `error.tsx`, the same way `/verify/[token]` does it
 * and for the same reason (ADR 20260803-error-boundary-copy-bridge): a layout
 * renders above the boundary, and `error.tsx`'s prop signature is fixed by Next
 * so no Server Component can hand it copy.
 *
 * **Synchronous**, deliberately: a layout wraps `children` with nothing to put
 * a `<Suspense>` around, so one request-scoped read here would cost this whole
 * route its static shell (ADR 20260804-instant-navigation). Both locales cross
 * to the client and `ErrorBoundaryIntlProvider` picks from `<html lang>`.
 */
export default function ConfirmContactLayout({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundaryIntlProvider messagesByLocale={ERROR_BOUNDARY_MESSAGES_BY_LOCALE}>
      {children}
    </ErrorBoundaryIntlProvider>
  );
}
