import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { ledgerRowBoxClass } from "@/components/ui/ledger";
import { SEGMENT_CORNER, SEGMENT_RAISED, segmentedTrackClass } from "@/components/ui/segmented";
import { StaffSectionTabsSkeleton } from "../_components/StaffSectionTabs";
import { CREW_COLUMN, SEATS_COLUMN, WAIVERS_COLUMN } from "./_components/DepartureLedger";
import { figureCellClass } from "./_components/MonthFigures";

/**
 * Body-shaped skeleton for Reports (design principle 1) — the monthly
 * revenue/fill-rate/waiver-completion rollup has no loading state to show
 * meanwhile.
 *
 * Shaped to the page as ADR 20260827-the-shops-shelves recomposed it: a
 * hairline-bounded band of five figures, the quiet tax/CSV line under it, then
 * the departures ledger. It painted five bordered cards over one tall card
 * until that slice landed — and a skeleton of the previous page is a layout
 * jump on every navigation into the route, which is the one thing this file
 * exists to prevent.
 *
 * **Every row above the figures is the loaded row's height** (K-391). The
 * month/year tabs had no stand-in, so the page dropped 78px when it landed (a
 * 54px track and its `mb-6`); the stepper drew 44px controls beside the page's
 * `md` 48px ones; and its heading bar was a 24px line where `text-lg` sets 28,
 * which is the drop on a phone, where the heading has a line to itself.
 */
export default function ReportsLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton eyebrow={false} titleWidth="w-32" description={false} />
        <StaffSectionTabsSkeleton section="money" />
        {/* `ReportRangeTabs`: the segmented track itself, one 44px option
            deep, its current option raised as the page draws it. */}
        <div className={`${segmentedTrackClass} mb-6 w-48`}>
          <div className={`h-11 w-24 ${SEGMENT_CORNER} ${SEGMENT_RAISED}`} />
        </div>
        {/* The month heading's 28px line, and the stepper at `md`: two 48px
            `icon` squares either side of the 176px (`w-44`) month field and
            its `md` "Go", grouped as the page groups them. */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="h-7 w-40 rounded bg-surface-sunken" />
          <div className="flex flex-wrap items-center gap-2">
            <div className="size-12 rounded-lg bg-surface-sunken" />
            <div className="flex items-center gap-2">
              <div className="h-12 w-44 rounded-lg bg-surface-sunken" />
              <div className="h-12 w-14 rounded-lg bg-surface-sunken" />
            </div>
            <div className="size-12 rounded-lg bg-surface-sunken" />
          </div>
        </div>
        {/* The figure row: unboxed, one hairline above and below, and the same
            one/two/five column run the figures themselves wear — reaching 8px
            past the column, as the figures' band and the ledger below do. Each
            cell is the figures' own `figureCellClass`, not a copy of it: the
            copy kept a phone's 24px end gutter after the figures dropped it. */}
        <div className="-mx-2 grid grid-cols-1 border-y border-border sm:grid-cols-2 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((index) => (
            <div
              key={index}
              className={`${figureCellClass(index)}${index === 4 ? " sm:col-span-2 lg:col-span-1" : ""}`}
            >
              <div className="h-3 w-20 rounded bg-surface-sunken" />
              <div className="mt-3 h-8 w-28 rounded bg-surface-sunken" />
              <div className="mt-3 h-3 w-24 rounded bg-surface-sunken" />
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <div className="h-4 w-56 rounded bg-surface-sunken" />
        </div>
        <div className="mt-10 h-3 w-32 rounded bg-surface-sunken" />
        {/* Each departure row as `LedgerRow` draws it (`md`: `min-h-13`,
            `py-2`) holding the loaded row's two lines: the title's 24px line,
            then the facts' 20px line, 8px down on a phone and 4px from `sm`
            (DepartureLedger). 69px and 65px, as the rows that replace them.
            From `lg` the facts move to the title's right, into the ledger's
            own seats, crew and waivers columns, as the loaded rows do. */}
        <div className="mt-2">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div key={row} className={`flex min-h-13 items-center py-2 ${ledgerRowBoxClass}`}>
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:gap-1 lg:flex-row lg:items-center lg:gap-6">
                <div className="flex h-6 items-center lg:flex-1">
                  <div className="h-4 w-3/4 rounded bg-surface-sunken sm:w-80" />
                </div>
                <div className="flex h-5 items-center gap-4 lg:gap-6">
                  <div className={`h-3 w-20 shrink-0 ${SEATS_COLUMN}`}>
                    <div className="h-3 w-20 rounded bg-surface-sunken" />
                  </div>
                  <div className={`h-3 w-12 shrink-0 ${CREW_COLUMN}`}>
                    <div className="h-3 w-12 rounded bg-surface-sunken" />
                  </div>
                  <div className={`h-3 w-24 shrink-0 ${WAIVERS_COLUMN}`}>
                    <div className="h-3 w-24 rounded bg-surface-sunken" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
