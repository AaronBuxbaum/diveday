import type { ReactNode } from "react";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { requestLocale } from "@/i18n/request";

/**
 * This layout exists for one reason: to put translated words above
 * `error.tsx` (ADR 20260803-error-boundary-copy-bridge).
 *
 * `error.tsx` is a Next file convention with a fixed `{error, reset}` prop
 * signature — the framework instantiates it directly, so no Server Component
 * can hand it a `copy` prop the way every other page's words arrive. But a
 * layout *does* render above the boundary (Next's component hierarchy is
 * layout → template → error → page), so it can negotiate the locale
 * server-side and put the handful of boundary strings into React context,
 * where the client boundary reads them with `useTranslations()`.
 *
 * The old objection was cost: "wrapping this route in a DiverIntlProvider
 * ships the diver bundle to the client on every visit." That stopped being
 * true when `DiverIntlProvider` grew a required `namespaces` list — this
 * mounts exactly one namespace, `errorBoundary`, four short strings, well
 * under a tenth of a percent of the ~80 KB bundle.
 *
 * `requestLocale()` takes no shop default here on purpose. The shop is behind
 * the bearer token, which only the page resolves; re-resolving it in the
 * layout would double the token lookup on every visit to save a fallback on
 * the rare visit that errors. So the boundary follows the reader's own
 * `Accept-Language`, falling back to English — which is the right default for
 * a page whose job is telling *this reader* something broke.
 *
 * `timeZone` is fixed rather than the shop's: the `errorBoundary` namespace
 * holds no date, time, or money, so nothing under this provider formats
 * against it. It is passed anyway because leaving *any* config prop off
 * `NextIntlClientProvider` makes it reach for a `getRequestConfig` module
 * DiveDay does not install — see `src/i18n/DiverIntlProvider.tsx`.
 */
// Bearer-token page (the URL is the capability, docs/engineering/
// capability-telemetry-runbook.md) — `requestLocale()` reads `headers()`,
// which is genuinely request-scoped. Same reasoning as the page's own
// `instant = false`.
export const instant = false;

export default async function WaiverTokenLayout({ children }: { children: ReactNode }) {
  return (
    <DiverIntlProvider locale={await requestLocale()} timeZone="UTC" namespaces={["errorBoundary"]}>
      {children}
    </DiverIntlProvider>
  );
}
