import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { ScheduleViewsSkeleton } from "../_components/ScheduleViews";
import {
  WEEK_DAY_GRID_CLASS,
  WEEK_EMPTY_DAY_CLASS,
  WEEK_ROW_BOX_CLASS,
} from "./_components/week-geometry";

/**
 * How many departures each of the skeleton's seven days draws: a week with
 * some days full and some empty, as a real one is.
 */
const DEPARTURES_PER_DAY = [1, 2, 0, 1, 0, 2, 0];

/**
 * Content-shaped skeleton for the schedule board (design principle 1;
 * docs/design/pixel-craft.md, class 11).
 *
 * **The board is one list of days at every width** (#1923), and this draws
 * that: the week pager, the week's own label line, then seven days on the
 * board's rail, each departure a first line (time, seat bar) over its title.
 * It drew the two compositions that list replaced until 2026-09 — seven
 * columns from `xl`, with 40px pager squares, and a stream of card-shaped
 * days below it with no pager at all — so every width's skeleton resolved
 * into a different page. The rail, the row box, the site mark's offset and
 * an empty day's line come from `week-geometry.ts`, the board's own, so the
 * two cannot drift again.
 */
export default function ScheduleBoardLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        {/* Two rows of doors on a phone: "View public page", "Add a
            departure" and "Add a booking" wrap to two at 390px for anyone
            who can configure the board. */}
        <ShopPageHeaderSkeleton eyebrow={false} titleWidth="w-48" description={false} actions={2} />
        <ScheduleViewsSkeleton />
        <div className="mt-4">
          {/* `WeekPager`: two 48px steps (`icon`) and the range, with the
              week's seat tally at the line's end, over the board's rule. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <div className="size-12 rounded-lg bg-surface-sunken" />
              <div className="size-12 rounded-lg bg-surface-sunken" />
              <div className="ms-2 h-5 w-40 rounded bg-surface-sunken" />
            </div>
            <div className="flex h-5 items-center">
              <div className="h-3.5 w-24 rounded bg-surface-sunken" />
            </div>
          </div>
          {DEPARTURES_PER_DAY.map((departures, day) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a skeleton day's only identity is its place in the week
            <div key={day} className="border-b border-border">
              <div className={WEEK_DAY_GRID_CLASS}>
                {/* The day's label: its weekday and the numeral beside it,
                    one line at every width. */}
                <div className="py-2">
                  <div className="flex min-h-8 items-center gap-1.5">
                    <div className="flex h-8 w-8 shrink-0 items-center">
                      <div className="h-3 w-8 rounded bg-surface-sunken" />
                    </div>
                    <div className="flex h-7 items-center">
                      <div className="h-5 w-6 rounded bg-surface-sunken" />
                    </div>
                  </div>
                </div>
                <div className="min-w-0">
                  {departures === 0 ? (
                    // "No boats", on the first line the departures use.
                    <div className={WEEK_EMPTY_DAY_CLASS}>
                      <div className="h-3.5 w-16 rounded bg-surface-sunken" />
                      {/* The day's "+ Add", at the line's end. */}
                      <div className="h-3.5 w-10 rounded bg-surface-sunken" />
                    </div>
                  ) : (
                    Array.from({ length: departures }, (_, departure) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: a skeleton row's only identity is its place in the day
                      <div key={departure} className={WEEK_ROW_BOX_CLASS}>
                        {/* The row's columns: the time, the title over its
                            facts, the seats. Below `md` the title and its
                            facts take the line under the time. */}
                        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 md:grid-cols-[4.75rem_minmax(0,1fr)_auto]">
                          <div className="col-start-1 row-start-1 flex min-h-8 items-center">
                            <div className="h-4 w-16 rounded bg-surface-sunken" />
                          </div>
                          <div className="col-span-full row-start-2 md:col-span-1 md:col-start-2 md:row-start-1 md:pt-1">
                            <div className="flex h-6 items-center">
                              <div className="h-4 w-56 max-w-full rounded bg-surface-sunken" />
                            </div>
                            <div className="mt-0.5 flex h-5 items-center">
                              <div className="h-3.5 w-40 max-w-full rounded bg-surface-sunken" />
                            </div>
                          </div>
                          <div className="col-start-2 row-start-1 flex min-h-8 items-center gap-2 md:col-start-3">
                            <div className="hidden h-1.5 w-16 rounded-full bg-surface-sunken sm:block" />
                            <div className="h-3.5 w-12 rounded bg-surface-sunken" />
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  {/* A day with boats: its "+ Add" under them, a 36px ghost. */}
                  {departures === 0 ? null : (
                    <div className="flex h-9 items-center px-2 pb-1">
                      <div className="h-3.5 w-10 rounded bg-surface-sunken" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
