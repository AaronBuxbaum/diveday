import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooterFallback } from "@/components/MarketingFooter";
import { FeaturePageSkeleton } from "../_components/FeaturePageSkeleton";

/**
 * A feature page's `<Suspense>` boundary while `params` resolves, and what a
 * client navigation into one paints (ADR 20260804-instant-navigation). Without
 * it the nearest boundary is `/product`'s own `loading.tsx`, which is shaped
 * like the hub and would land a feature page's hero under a chapter strip it
 * does not have.
 *
 * The chrome is the real signed-out header and footer, and the body is the
 * same skeleton the page itself streams behind, so the two paints are one.
 */
export default function FeaturePageLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNavFallback />
      <FeaturePageSkeleton />
      <MarketingFooterFallback />
    </div>
  );
}
