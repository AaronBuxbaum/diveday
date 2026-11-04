import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { ledgerRowBoxClass } from "@/components/ui/ledger";
import { Bone, Pending } from "@/components/ui/pending";
import { SEGMENT_CORNER, SEGMENT_RAISED, segmentedTrackClass } from "@/components/ui/segmented";
import { StaffSectionTabsSkeleton } from "../_components/StaffSectionTabs";
import {
  CREW_COLUMN,
  NET_COLUMN,
  SEATS_COLUMN,
  WAIVERS_COLUMN,
} from "./_components/DepartureLedger";
import { figureCellClass } from "./_components/MonthFigures";

/**
 * Body-shaped skeleton for Reports (design principle 1) — the monthly
 * revenue/fill-rate/waiver-completion rollup has no loading state to show
 * meanwhile.
 *
 * Follows the report body recomposed by ADR 20260827-the-shops-shelves so
 * navigation into the route does not cause a layout jump.
 *
 * **Every row above the figures matches the loaded row's height** (K-391),
 * including the month/year tabs, stepper, and heading.
 */
export default function ReportsLoading() {
  return (
    <StaffPage width="full">
      <Pending>
        <ShopPageHeader pending eyebrow={false} titleWidth="w-32" description={false} />
        <StaffSectionTabsSkeleton section="money" />
        {/* Reserve the loaded segmented track and raised active option. */}
        <div className={`${segmentedTrackClass} mb-6 w-48`}>
          <div className={`h-11 w-24 ${SEGMENT_CORNER} ${SEGMENT_RAISED}`} />
        </div>
        {/* Keep the heading and month controls in the loaded row geometry. */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Bone className="h-7 w-40" />
          <div className="flex flex-wrap items-center gap-2">
            <Bone shape="control" className="size-12" />
            <div className="flex items-center gap-2">
              <Bone shape="control" className="h-12 w-44" />
              <Bone shape="control" className="h-12 w-14" />
            </div>
            <Bone shape="control" className="size-12" />
          </div>
        </div>
        {/* Match the figures' band and grid; shared cell classes prevent the
            fallback and loaded figures from drifting. */}
        <div className="-mx-2 grid grid-cols-1 border-y border-border sm:grid-cols-2 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((index) => (
            <div
              key={index}
              className={`${figureCellClass(index)}${index === 4 ? " sm:col-span-2 lg:col-span-1" : ""}`}
            >
              <Bone className="h-3 w-20" />
              <Bone className="mt-3 h-8 w-28" />
              <Bone className="mt-3 h-3 w-24" />
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <Bone className="h-4 w-56" />
        </div>
        <Bone className="mt-10 h-3 w-32" />
        {/* Mirror the ledger's responsive row layout and shared column widths
            so fallback rows align with loaded departures. */}
        <div className="mt-2">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div key={row} className={`flex min-h-13 items-center py-2 ${ledgerRowBoxClass}`}>
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:gap-1 lg:flex-row lg:items-center lg:gap-6">
                <div className="flex h-6 items-center lg:flex-1">
                  <Bone className="h-4 w-3/4 sm:w-80" />
                </div>
                <div className="flex h-5 items-center gap-4 lg:gap-6">
                  <div className={`h-3 w-20 shrink-0 ${SEATS_COLUMN}`}>
                    <Bone className="h-3 w-20" />
                  </div>
                  <div className={`h-3 w-12 shrink-0 ${CREW_COLUMN}`}>
                    <Bone className="h-3 w-12" />
                  </div>
                  <div className={`h-3 w-14 shrink-0 ${NET_COLUMN}`}>
                    <Bone className="h-3 w-14 lg:ms-auto" />
                  </div>
                  <div className={`h-3 w-24 shrink-0 ${WAIVERS_COLUMN}`}>
                    <Bone className="h-3 w-24" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Pending>
    </StaffPage>
  );
}
