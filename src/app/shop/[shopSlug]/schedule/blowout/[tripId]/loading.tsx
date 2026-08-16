import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for the blow-out page (ADR 20260804-instant-navigation):
 * header, the three-stat outcome row, then the diver table. Mirrors the page's
 * own markup — like the page, no `<main>` of its own; the shop layout's
 * `#shop-main-content` wrapper is the landmark.
 */
export default function BlowoutLoading() {
  return (
    <div className="animate-pulse">
      <ShopPageHeaderSkeleton titleWidth="w-64 max-w-full" descriptionWidth="w-80 max-w-full" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className={sectionCardClass({ padding: "none", className: "h-24" })} />
        ))}
      </div>
      <div className={sectionCardClass({ padding: "none", className: "mt-6 h-72" })} />
    </div>
  );
}
