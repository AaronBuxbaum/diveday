import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * List-shaped skeleton for collected waiver signatures — renders as the
 * waivers layout's children, so the Template/Signatures tabs stay put while
 * only the body swaps.
 */
export default function WaiverSignaturesLoading() {
  return (
    <div className="animate-pulse">
      <ShopPageHeaderSkeleton titleWidth="w-56" descriptionWidth="w-full max-w-xl" />
      <div
        className={sectionCardClass({
          padding: "none",
          className: "mt-8 flex flex-col divide-y divide-border",
        })}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 bg-surface" />
        ))}
      </div>
    </div>
  );
}
