import type { ReactNode } from "react";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { requestLocale } from "@/i18n/request";

/**
 * Puts translated words above the trip-readiness page's `error.tsx`. A layout
 * renders above the error boundary, so it can negotiate the locale
 * server-side and mount the one `errorBoundary` namespace — four short
 * strings — into React context for the client boundary to read. See
 * `src/app/waivers/[token]/layout.tsx` for the full reasoning and ADR
 * 20260803-error-boundary-copy-bridge for the decision.
 */
// Bearer-token page (the URL is the capability, docs/engineering/
// capability-telemetry-runbook.md) — `requestLocale()` reads `headers()`,
// which is genuinely request-scoped. Same reasoning as the page's own
// `instant = false`.
export const instant = false;

export default async function ReadyTokenLayout({ children }: { children: ReactNode }) {
  return (
    <DiverIntlProvider locale={await requestLocale()} timeZone="UTC" namespaces={["errorBoundary"]}>
      {children}
    </DiverIntlProvider>
  );
}
