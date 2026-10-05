import { sectionCardClass } from "@/components/ui/card";
import { TripPageHeaderSkeleton } from "./_components/TripPageHeader";

/**
 * Body-shaped skeleton for the departure (design principle 1). Navigation into
 * one should keep its geometry while the reads settle: the header and the
 * roster.
 *
 * **The header is the header's own lines** (`TripPageHeaderSkeleton`, the
 * same header every tab of the departure wears, exported beside it so the two
 * cannot drift; pixel-craft class 11). No heading bar
 * over the roster: the compact roster has none.
 *
 * **The page's one gap.** Its blocks sit in one `space-y-10`, the header
 * included (K-262), so these do too.
 */
export default function TripSurfaceLoading() {
  return (
    <div className="animate-pulse space-y-10">
      <TripPageHeaderSkeleton className="" />
      <div>
        <div className={sectionCardClass({ padding: "none", className: "h-80" })} />
        <div className="mt-6 h-11 w-44 rounded bg-surface-sunken" />
      </div>
    </div>
  );
}
