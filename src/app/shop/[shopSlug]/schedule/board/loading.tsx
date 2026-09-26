import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import {
  WEEK_DAY_GRID_CLASS,
  WEEK_EMPTY_DAY_CLASS,
  WEEK_MARK_CLASS,
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
        <ShopPageHeaderSkeleton titleWidth="w-48" description={false} actions={2} />
        <div className="mt-4">
          {/* `WeekPager`: two 48px steps (`icon`) and the range, at every
              width. */}
          <div className="flex items-center gap-2">
            <div className="size-12 rounded-lg bg-surface-sunken" />
            <div className="size-12 rounded-lg bg-surface-sunken" />
            <div className="ms-2 h-5 w-40 rounded bg-surface-sunken" />
          </div>
          {/* The week's label and its seat tally, over the board's rule. */}
          <div className="mt-4 flex justify-between gap-3 border-b border-border pb-2">
            <div className="flex h-4 items-center">
              <div className="h-3 w-20 rounded bg-surface-sunken" />
            </div>
            <div className="flex h-4 items-center">
              <div className="h-3 w-24 rounded bg-surface-sunken" />
            </div>
          </div>
          {DEPARTURES_PER_DAY.map((departures, day) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a skeleton day's only identity is its place in the week
            <div key={day} className="border-b border-border">
              <div className={WEEK_DAY_GRID_CLASS}>
                {/* The day's label: its weekday line, and the numeral beside
                    it on a phone or under it from `sm` up. */}
                <div className="py-2">
                  <div className="flex min-h-8 items-center gap-1.5 sm:flex-col sm:items-start sm:gap-0">
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
                    </div>
                  ) : (
                    Array.from({ length: departures }, (_, departure) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: a skeleton row's only identity is its place in the day
                      <div key={departure} className={WEEK_ROW_BOX_CLASS}>
                        <div
                          className={`${WEEK_MARK_CLASS} h-7.5 w-11 rounded-lg bg-surface-sunken`}
                        />
                        <div className="min-w-0 flex-1">
                          {/* The first line: the time in its slot, the seat
                              bar, and the meta inline from `md`. */}
                          <div className="flex min-h-8 items-center gap-x-2 md:gap-x-3">
                            <div className="w-19 shrink-0">
                              <div className="h-4 w-16 rounded bg-surface-sunken" />
                            </div>
                            <div className="h-1.5 w-14 shrink-0 rounded-full bg-surface-sunken sm:w-20" />
                            <div className="hidden h-3.5 w-48 rounded bg-surface-sunken md:block" />
                          </div>
                          {/* Below `md` the meta is a line of its own. */}
                          <div className="flex h-5 items-center md:hidden">
                            <div className="h-3.5 w-44 max-w-full rounded bg-surface-sunken" />
                          </div>
                          <div className="mt-0.5 flex h-5 items-center">
                            <div className="h-3.5 w-56 max-w-full rounded bg-surface-sunken" />
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  {/* The day's own "+ Add", a 44px ghost. */}
                  <div className="mx-1 flex h-11 items-center px-3">
                    <div className="h-3.5 w-10 rounded bg-surface-sunken" />
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
