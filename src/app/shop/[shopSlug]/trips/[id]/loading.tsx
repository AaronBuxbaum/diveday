import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for a trip surface (design principle 1). It renders as
 * the layout's children, so the sub-nav above stays put and only this area
 * flickers to a skeleton while the next tab's data loads — the tab switch reads
 * as instant instead of a blank hang.
 */
export default function TripSurfaceLoading() {
  return (
    <div className="animate-pulse">
      <ShopPageHeaderSkeleton
        eyebrow={false}
        description={false}
        meta={
          <div className="flex flex-col gap-2">
            <div className="h-6 w-56 max-w-full rounded bg-surface-sunken" />
            <div className="h-4 w-72 max-w-full rounded bg-surface-sunken" />
          </div>
        }
      />
      <div className={sectionCardClass({ padding: "md", className: "h-36" })} />
      <div className="mt-8 flex flex-col gap-6">
        {["details", "requirements", "crew", "conditions"].map((section) => (
          <div key={section} className={sectionCardClass({ padding: "lg", className: "h-48" })} />
        ))}
      </div>
    </div>
  );
}
