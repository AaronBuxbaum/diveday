import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooterFallback } from "@/components/MarketingFooter";

/**
 * The `/privacy` segment's <Suspense> boundary, and what a client navigation
 * into it paints (ADR 20260804-instant-navigation). Same arrangement as
 * `src/app/about/loading.tsx`: the page's `requestLocale()` read sits above
 * everything it renders, so the real signed-out chrome is here rather than a
 * grey bar, and the body is bars.
 *
 * Bars specifically, and nothing interactive: a fallback holds *shape*, never
 * interaction. A fallback that rendered the real document in a default locale
 * would throw away anything the reader did to it when the localized body landed
 * (ADR 20260804-instant-navigation's 2026-08-14 amendment).
 *
 * Shaped like the document above the fold — eyebrow, title, the dateline, the
 * opening paragraph, then stacked sections — so the streamed page lands where
 * the bars stood. Identical to `/terms`'s, because the two pages are the
 * same document in different words.
 */
export default function PrivacyLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNavFallback />
      <main className="flex-1 animate-pulse">
        <div className="mx-auto w-full max-w-3xl px-6 py-16 lg:py-24">
          <div className="h-4 w-40 rounded bg-surface-sunken" />
          <div className="mt-4 h-9 w-full rounded bg-surface-sunken sm:h-10" />
          <div className="mt-2 h-9 w-2/3 rounded bg-surface-sunken sm:h-10" />
          <div className="mt-3 h-4 w-56 rounded bg-surface-sunken" />
          <div className="mt-8 flex flex-col gap-2">
            <div className="h-5 w-full rounded bg-surface-sunken" />
            <div className="h-5 w-full rounded bg-surface-sunken" />
            <div className="h-5 w-4/5 rounded bg-surface-sunken" />
          </div>
          <div className="mt-12 flex flex-col gap-12">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((section) => (
              <div key={section}>
                <div className="h-6 w-2/5 rounded bg-surface-sunken" />
                <div className="mt-4 flex flex-col gap-2">
                  <div className="h-4 w-full rounded bg-surface-sunken" />
                  <div className="h-4 w-full rounded bg-surface-sunken" />
                  <div className="h-4 w-3/4 rounded bg-surface-sunken" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
      <MarketingFooterFallback />
    </div>
  );
}
