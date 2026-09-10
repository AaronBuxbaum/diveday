import type { ReactNode } from "react";
import { ErrorBoundaryIntlProvider } from "@/i18n/ErrorBoundaryIntlProvider";
import { ERROR_BOUNDARY_MESSAGES_BY_LOCALE } from "@/i18n/error-boundary-messages";

/**
 * This layout exists for one reason: to put translated words above `error.tsx`
 * for the diver's shelf (ADR 20260803-error-boundary-copy-bridge).
 *
 * `error.tsx` is a Next file convention with a fixed `{error, reset}` prop
 * signature — the framework instantiates it directly, so no Server Component
 * can hand it a `copy` prop the way every other page's words arrive. A layout
 * *does* render above the boundary, so it can put the handful of boundary
 * strings into React context, where the client boundary reads them with
 * `useTranslations()`.
 *
 * **Deliberately synchronous**, like `/ready`'s twin. A layout wraps its
 * children, so there is nowhere to put a `<Suspense>` between them: one
 * request-scoped read here — negotiating the reader's language, say — would
 * cost this route its static shell and its `instant = true` with it. Both
 * locales' copy crosses to the client instead (~600 bytes) and
 * `ErrorBoundaryIntlProvider` picks between them from `<html lang>`, which the
 * root layout's inline script has already corrected from `navigator.languages`
 * (ADR 20260804-instant-navigation).
 */
export default function ShelfTokenLayout({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundaryIntlProvider messagesByLocale={ERROR_BOUNDARY_MESSAGES_BY_LOCALE}>
      {children}
    </ErrorBoundaryIntlProvider>
  );
}
