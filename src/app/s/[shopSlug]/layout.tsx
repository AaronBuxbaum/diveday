import { Suspense } from "react";
import { RetryReturningDiverMemory } from "@/app/_components/RetryReturningDiverMemory";
import { ErrorBoundaryIntlProvider } from "@/i18n/ErrorBoundaryIntlProvider";
import { ERROR_BOUNDARY_MESSAGES_BY_LOCALE } from "@/i18n/error-boundary-messages";
import { diverTranslator } from "@/i18n/messages";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { connectionForRoute } from "@/lib/observability/render-connection";
import { PublicShopMainContent } from "./_components/PublicShopMainContent";
import {
  PublicShopBrand,
  PublicShopChrome,
  PublicShopChromePlaceholder,
  PublicShopFooterSection,
} from "./_components/PublicShopShell";

/**
 * Synchronous diver-facing shell for `/s/[shopSlug]/**`; `/shop/**` remains
 * staff-only. Keeping request-scoped work in the async shell components lets
 * the static frame and `{children}` render outside their Suspense boundaries.
 * The components that need the shop row use `shopBySlugCached`, memoized for
 * the render so separate boundaries share one query.
 */
export default function PublicShopLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ shopSlug: string }>;
}) {
  const fallbackT = diverTranslator(DEFAULT_DIVER_LOCALE);
  return (
    <>
      <Suspense fallback={null}>
        <RetryReturningDiverMemory />
      </Suspense>
      {/* The shop's brand as tokens, streamed like the chrome so no request read
          sits above {children} (ADR 20260804-instant-navigation). A `<style>`
          applies wherever it lands, so it needs no wrapper around the page. */}
      <Suspense fallback={null}>
        <PublicShopBrand params={params} />
      </Suspense>
      <Suspense fallback={null}>
        <PublicRenderCost />
      </Suspense>
      {/* The fallback holds the header's height as well as its skip link. The
          skip link follows the root layout's pattern — the default-locale label
          is in the static shell so a keyboard user always has a target, and the
          negotiated one replaces it. The height matters more: this band sits
          *above* the page, so a fallback of nothing would let the schedule paint
          at the top of the viewport and then jump down when the shop's header
          arrived. The one case it is wrong for is `?embed=1`, where the real
          chrome is deliberately nothing: a layout cannot see `searchParams`,
          and the proxy's embed header is a request read, which is exactly what
          this component exists to defer. So the frame's own segments hide the
          bar instead (`EmbedChromeCollapse`), from their static shell on. */}
      <Suspense fallback={<PublicShopChromePlaceholder label={fallbackT} />}>
        <PublicShopChrome params={params} />
      </Suspense>
      <PublicShopMainContent>
        {/* Words for `error.tsx`, which renders below this layout and above the
            page (ADR 20260803-error-boundary-copy-bridge). A boundary is a file
            convention with a fixed {error, reset} signature, so it can only read
            copy out of context — one namespace, four short strings. Both
            locales cross to the client, which is what lets this provider stay
            synchronous: a `requestLocale()` here would put a `headers()` read
            above `{children}` and take the static shell back. */}
        <ErrorBoundaryIntlProvider messagesByLocale={ERROR_BOUNDARY_MESSAGES_BY_LOCALE}>
          {children}
        </ErrorBoundaryIntlProvider>
      </PublicShopMainContent>
      {/* No placeholder: the footer is the last thing on the page, so arriving
          late moves nothing that is already on screen. Reserving space for it
          would only mean an empty bar to look at, and an embed — which drops
          the footer entirely — would have to un-reserve it. */}
      <Suspense fallback={null}>
        <PublicShopFooterSection params={params} />
      </Suspense>
    </>
  );
}

/**
 * **What a diver-facing render cost**, logged after the response as one
 * `render.db_queries` line (code review 2026-10-10, item 3). Armed here, once,
 * for every page under `/s/[shopSlug]/**`, with the broad `/s/**` label as a
 * fallback: a page that arms its own route name keeps it. In its own boundary
 * and behind `connection()` because the layout is synchronous on purpose (see
 * above) and the count only means anything for a render that served a request.
 */
async function PublicRenderCost() {
  await connectionForRoute("/s/**", { fallback: true });
  return null;
}
