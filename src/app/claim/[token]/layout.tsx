import type { ReactNode } from "react";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { requestLocale } from "@/i18n/request";

/**
 * Puts translated words above the seat-claim page's `error.tsx`. A layout
 * renders above the error boundary, so it can negotiate the locale
 * server-side and mount the one `errorBoundary` namespace — four short
 * strings — into React context for the client boundary to read. See
 * `src/app/waivers/[token]/layout.tsx` for the full reasoning and ADR
 * 20260803-error-boundary-copy-bridge for the decision.
 */
// No `instant` config here — the page below declares `instant = false`,
// which covers this route. See src/app/ready/[token]/layout.tsx for why a
// second declaration buys nothing.

export default async function ClaimTokenLayout({ children }: { children: ReactNode }) {
  return (
    <DiverIntlProvider locale={await requestLocale()} timeZone="UTC" namespaces={["errorBoundary"]}>
      {children}
    </DiverIntlProvider>
  );
}
