import { Suspense } from "react";
import { ErrorBoundaryIntlProvider } from "@/i18n/ErrorBoundaryIntlProvider";
import { ERROR_BOUNDARY_MESSAGES_BY_LOCALE } from "@/i18n/error-boundary-messages";
import { diverTranslator } from "@/i18n/messages";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import {
  PublicShopBrand,
  PublicShopChrome,
  PublicShopChromePlaceholder,
  PublicShopFooterSection,
} from "./_components/PublicShopShell";

/**
 * The diver-facing shell for `/s/[shopSlug]/**` — the shop's own identity,
 * never staff chrome (ADR 20260803-public-shop-namespace). These surfaces used
 * to live inside the auth-gated `/shop` namespace and be carved back out by an
 * allowlist; they now have a namespace of their own, so "public" is a property
 * of the URL rather than of a regular expression.
 *
 * **This function is synchronous, and that is the whole point** (ADR
 * 20260804-instant-navigation). It used to `await` the embed header, the shop
 * row, the negotiated locale, the session, and a `hasActiveCourses` probe
 * before returning anything — five request-scoped reads sitting above
 * `{children}`, which is the one position a `<Suspense>` boundary cannot
 * rescue, because the page *is* the child. That is what `instant = false` was
 * buying here: permission to have no static shell at all.
 *
 * Everything request-scoped now lives in the async components of
 * `./_components/PublicShopShell.tsx`, each behind its own boundary, and
 * `{children}` sits outside every one of them. The static
 * shell is the page frame — skip link, a header band holding its own height,
 * the main landmark, and the page's own `loading.tsx` — served without waiting
 * on a database round trip, while the shop's identity and its live inventory
 * stream in behind it.
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
      {/* The shop's brand as tokens, streamed like the chrome so no request read
          sits above {children} (ADR 20260804-instant-navigation). A `<style>`
          applies wherever it lands, so it needs no wrapper around the page. */}
      <Suspense fallback={null}>
        <PublicShopBrand params={params} />
      </Suspense>
      {/* The fallback holds the header's height as well as its skip link. The
          skip link follows the root layout's pattern — the default-locale label
          is in the static shell so a keyboard user always has a target, and the
          negotiated one replaces it. The height matters more: this band sits
          *above* the page, so a fallback of nothing would let the schedule paint
          at the top of the viewport and then jump down when the shop's header
          arrived. The one case it reads oddly is `?embed=1`, where the real
          chrome is deliberately nothing and this bar therefore disappears —
          a layout cannot see `searchParams`, and the proxy's embed header is a
          request read, which is exactly what this component exists to defer. A
          brief bar inside an iframe is the cheaper of the two mistakes. */}
      <Suspense fallback={<PublicShopChromePlaceholder label={fallbackT} />}>
        <PublicShopChrome params={params} />
      </Suspense>
      <div id="public-shop-main-content" tabIndex={-1} className="flex-1 outline-none">
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
      </div>
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
