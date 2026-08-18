import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Roster-shaped skeleton for Guests. This route has its own trip header and
 * then a dense stack of roster rows, invitations, add-diver controls, and a
 * collapsed activity log; inheriting the overview surface's four generic
 * cards made tab switches redraw into the wrong page.
 */
export default function TripGuestsLoading() {
  return (
    <div className="animate-pulse">
      <ShopPageHeaderSkeleton
        eyebrow={false}
        titleWidth="w-64 max-w-full"
        description={false}
        meta={
          <div className="flex flex-col gap-2">
            <div className="h-6 w-56 max-w-full rounded bg-surface-sunken" />
            <div className="h-4 w-48 rounded bg-surface-sunken" />
          </div>
        }
      />
      <div className="mt-6 flex flex-col gap-3">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className={sectionCardClass({ padding: "none", className: "h-28" })} />
        ))}
      </div>
      <div className="mt-10 h-6 w-40 rounded bg-surface-sunken" />
      <div className="mt-4 flex flex-col gap-3">
        {[0, 1].map((row) => (
          <div key={row} className={sectionCardClass({ padding: "none", className: "h-20" })} />
        ))}
      </div>
      <div className="mt-10 h-11 w-40 rounded-lg bg-surface-sunken" />
    </div>
  );
}
