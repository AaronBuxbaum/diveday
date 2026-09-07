import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooterFallback } from "@/components/MarketingFooter";
import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * One town's `<Suspense>` boundary (ADR 20260804-instant-navigation). Its own
 * file rather than the parent's, because the two bodies are different shapes:
 * this one carries the eyebrow back to `/dive` and a logo square on every row,
 * and a skeleton painting the wrong page is the defect
 * `pnpm check:loading-skeletons` exists to catch.
 */
export default function RegionLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNavFallback hideCta />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <div className="animate-pulse">
          <ShopPageHeaderSkeleton
            titleWidth="w-72 max-w-full"
            descriptionWidth="w-full max-w-2xl"
          />
        </div>
        <div className="animate-pulse divide-y divide-border border-y border-border">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-4 py-5">
              <div className="size-14 shrink-0 rounded-inset bg-surface-sunken" />
              <div className="min-w-0 flex-1">
                <div className="h-7 w-52 max-w-full rounded bg-surface-sunken" />
                <div className="mt-1 h-5 w-full max-w-sm rounded bg-surface-sunken" />
              </div>
            </div>
          ))}
        </div>
      </main>
      <MarketingFooterFallback />
    </div>
  );
}
