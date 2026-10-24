import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooterFallback } from "@/components/MarketingFooter";
import { SkeletonLineBars } from "@/components/ShopPageHeader";

/**
 * The diver's shop picker while it reads the locale and the listed shops
 * (ADR 20260804-instant-navigation): the marketing header, the title, its
 * description at the lines it wraps to (three at 390, two from `sm`), the
 * ruled rows where the shops land, and the footer. Bars only: nothing here to
 * tap, so nothing is lost when the page lands.
 */
export default function FindYourBookingLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNavFallback compactMobile />
      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-12 sm:py-16">
        <SkeletonLineBars lines={1} height="h-9" width="w-56" />
        <div className="mt-2">
          <SkeletonLineBars lines={{ base: 3, sm: 2 }} height="h-6" width="w-full" />
        </div>
        <div className="-mx-2 mt-8 divide-y divide-border border-y border-border">
          {["first", "second"].map((row) => (
            <div key={row} className="flex flex-col gap-1 px-2 py-5">
              <SkeletonLineBars lines={1} height="h-6" width="w-48" />
              <SkeletonLineBars lines={1} height="h-5" width="w-28" />
            </div>
          ))}
        </div>
      </main>
      <MarketingFooterFallback />
    </div>
  );
}
