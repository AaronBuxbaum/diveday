import type { ReactNode } from "react";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { requestLocale } from "@/i18n/request";

/**
 * Puts translated words above the unsubscribe page's `error.tsx`. A layout
 * renders above the error boundary, so it can negotiate the locale
 * server-side and mount the one `errorBoundary` namespace — four short
 * strings — into React context for the client boundary to read. See
 * `src/app/waivers/[token]/layout.tsx` for the full reasoning and ADR
 * 20260803-error-boundary-copy-bridge for the decision.
 */
// No `instant` config here. This layout's `requestLocale()` does block, but
// `isPageAllowedToBlock` reads only the *outermost* `instant` in a route, and
// the page below already declares `instant = false` — which covers this route
// either way, and additionally keeps the page segment out of dev-time instant
// validation, which a layout config cannot do. Two declarations bought nothing.
// See ADR 20260803-instant-opt-out-placement.

export default async function UnsubscribeTokenLayout({ children }: { children: ReactNode }) {
  return (
    <DiverIntlProvider locale={await requestLocale()} timeZone="UTC" namespaces={["errorBoundary"]}>
      {children}
    </DiverIntlProvider>
  );
}
