import type { ReactNode } from "react";
import { ErrorBoundaryIntlProvider } from "@/i18n/ErrorBoundaryIntlProvider";
import { ERROR_BOUNDARY_MESSAGES_BY_LOCALE } from "@/i18n/error-boundary-messages";

/**
 * This layout exists for one reason: to put translated words above
 * `error.tsx` for the post-trip recap a diver reads and reviews from (ADR
 * 20260803-error-boundary-copy-bridge).
 *
 * `error.tsx` is a Next file convention with a fixed `{error, reset}` prop
 * signature — the framework instantiates it directly, so no Server Component
 * can hand it a `copy` prop the way every other page's words arrive. But a
 * layout *does* render above the boundary (Next's component hierarchy is
 * layout → template → error → page), so it can put the handful of boundary
 * strings into React context, where the client boundary reads them with
 * `useTranslations()`.
 *
 * It is deliberately **synchronous**. The original version awaited
 * `requestLocale()` here to pick the reader's language server-side, and that
 * one `headers()` read was the only thing keeping this whole route out of a
 * static shell: a layout wraps `children`, so there is nothing to put a
 * `<Suspense>` boundary around — the page could not render until the provider
 * had. Both locales' copy now crosses to the client instead (~600 bytes) and
 * `ErrorBoundaryIntlProvider` picks between them from `<html lang>`, which the
 * root layout's inline script has already corrected from `navigator.languages`.
 * Same answer, same source, no blocking read — see ADR
 * 20260804-instant-navigation.
 */
export default function RecapTokenLayout({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundaryIntlProvider messagesByLocale={ERROR_BOUNDARY_MESSAGES_BY_LOCALE}>
      {children}
    </ErrorBoundaryIntlProvider>
  );
}
