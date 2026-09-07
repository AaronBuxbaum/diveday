import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooterFallback } from "@/components/MarketingFooter";
import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * The `/dive` segment's `<Suspense>` boundary, and what a client navigation
 * into it paints (ADR 20260804-instant-navigation). The chrome is the real
 * signed-out, default-locale header and footer rather than grey bars — the
 * arrangement `/about` and `/pricing` already use, and for the same reason:
 * the page's own `requestTranslator()` read sits above everything it renders.
 *
 * The body is the header block over the hairline ledger of towns, at the same
 * `max-w-3xl` the page owns, so the streamed list lands where the bars stood.
 * Nothing here is interactive, so there is nothing for the swap to discard.
 */
export default function RegionsLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNavFallback hideCta />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <div className="animate-pulse">
          <ShopPageHeaderSkeleton
            eyebrow={false}
            titleWidth="w-64"
            descriptionWidth="w-full max-w-2xl"
          />
        </div>
        <div className="animate-pulse divide-y divide-border border-y border-border">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex items-baseline justify-between gap-6 py-5">
              <div className="h-7 w-44 max-w-full rounded bg-surface-sunken" />
              <div className="h-5 w-16 shrink-0 rounded bg-surface-sunken" />
            </div>
          ))}
        </div>
      </main>
      <MarketingFooterFallback />
    </div>
  );
}
