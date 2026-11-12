import { Bone, Pending } from "@/components/ui/pending";
import {
  DAY_LABEL_COLUMN_CLASS,
  DAY_NUMERAL_CLASS,
  WEEK_ROW_BOX_CLASS,
  WEEK_TIME_RAIL_CLASS,
} from "./_components/WeekLedger";

/** Date choices and the first departures lead, as on the loaded storefront. */
export default function TripsLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <Pending>
        <Bone className="h-10 w-48" />
        <Bone className="mt-2 h-5 w-72 max-w-full" />
      </Pending>
      <Pending className="mt-6">
        <div className="mb-2 flex h-11 items-center gap-2">
          <Bone className="h-6 w-32" />
          <Bone shape="control" className="size-11" />
        </div>
        <div className="mb-4 flex h-12 gap-2 overflow-hidden">
          {[0, 1, 2, 3, 4, 5, 6].map((day) => (
            <Bone key={day} className="h-full min-w-11 flex-1" />
          ))}
        </div>
        <div className="mb-6 flex h-11 items-center gap-2">
          <Bone className="h-5 w-24" />
          <Bone shape="pill" className="hidden h-11 w-36 sm:block" />
          <Bone shape="pill" className="hidden h-11 w-32 sm:block" />
        </div>
        {/* Two day groups: the calendar date block, then borderless rows with
            one meta line each. The block and the rows are drawn from the
            ledger's own column classes — the numeral's two tabular digits,
            the weekday column, the row's box and its time rail — so the
            hairline, the time and the title start where the loaded ones do.
            An empty numeral block is exactly its `2ch` minimum. */}
        {[0, 1].map((day) => (
          <div key={day} className={day === 0 ? "" : "mt-8"}>
            <div className="flex items-center gap-3 pt-2 pb-3">
              <Bone className={`${DAY_NUMERAL_CLASS} h-8`} />
              <div className={DAY_LABEL_COLUMN_CLASS}>
                <div className="h-5 pt-1">
                  <Bone className="h-full w-10" />
                </div>
                <div className="h-5 pt-1">
                  <Bone className="h-full w-10" />
                </div>
              </div>
              <div className="h-px flex-1 bg-border" />
            </div>
            {[0, 1].map((row) => (
              <div key={row} className={`${WEEK_ROW_BOX_CLASS} lg:items-start`}>
                <div className={WEEK_TIME_RAIL_CLASS}>
                  <Bone className="h-6 w-36" />
                </div>
                <div className="min-w-0 flex-1">
                  <Bone className="h-6 w-56 max-w-full" />
                  <Bone className="mt-1 h-5 w-64 max-w-full" />
                </div>
                <Bone className="h-6 w-20 shrink-0" />
              </div>
            ))}
          </div>
        ))}
      </Pending>
    </main>
  );
}
