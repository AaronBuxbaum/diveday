import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { ledgerRowBoxClass } from "@/components/ui/ledger";
import { WEEK_GRID, weekTailRowClass } from "./_components/StaffingWeek";

const DAYS = [0, 1, 2, 3, 4, 5, 6];

/**
 * Body-shaped skeleton for the staffing week (design principle 1): the week
 * pager, the day-header strip, five people rows of the grid, the gap row, the
 * page's two doors and its consent row, and the credentials ledger beneath —
 * in the order the page renders them, at the heights it renders them at.
 *
 * Hairlines rather than cards, because the page it stands in for is a ledger
 * now (ADR 20260827-the-shops-shelves, decision 3) and a skeleton made of
 * bordered boxes would be a layout jump dressed as a loading state.
 *
 * **Every height is the loaded one** (K-274, pixel-craft class 11). The pager
 * squares were 36px against the pager's 48, the day-header band 32px against
 * 36, a chip bar 32px where a two-line shift chip is 46, and the phone's days
 * were grey cards under a rule where the page draws hairline rows under a
 * label — so everything under the pager dropped when the week arrived. A bar
 * now stands in a box its line's height, and the grid is drawn from the
 * loaded grid's own parts (`WEEK_GRID`), the chip bar included.
 */
export default function StaffingLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        {/* `description={false}`: the header is an eyebrow and a name now —
            the line under it explained where crew is assigned, and the gap
            cell's own Assign door says it better. */}
        <ShopPageHeaderSkeleton description={false} titleWidth="w-40" />

        {/* Two step buttons, 48px squares (`WeekPager`'s `icon` size), and
            the range they step through. */}
        <div className="flex items-center gap-2">
          <div className="size-12 rounded-lg bg-surface-sunken" />
          <div className="size-12 rounded-lg bg-surface-sunken" />
          <div className="ms-2 h-5 w-40 rounded bg-surface-sunken" />
        </div>

        <div className="mt-4 hidden lg:block">
          <div className={WEEK_GRID.row}>
            <div className={WEEK_GRID.personHead} />
            {DAYS.map((day) => (
              <div key={day} className={WEEK_GRID.dayHead}>
                <div className="h-4 w-14 rounded bg-surface-sunken" />
              </div>
            ))}
          </div>
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className={WEEK_GRID.row}>
              <div className={WEEK_GRID.person}>
                {/* A name's line and a role's, each at its own height. */}
                <div className="flex h-5 items-center">
                  <div className="h-4 w-24 rounded bg-surface-sunken" />
                </div>
                <div className="flex h-4 items-center">
                  <div className="h-3 w-16 rounded bg-surface-sunken" />
                </div>
              </div>
              {DAYS.map((day) => (
                <div key={day} className={WEEK_GRID.day}>
                  {/* A shift lands in some cells and not others; a full grid of
                      bars would promise a week nobody works. */}
                  {(row + day) % 3 === 0 ? (
                    // The chip's own box around its two 16px lines, a time
                    // over a note: 46px with the chip's edge (K-498).
                    <div className={WEEK_GRID.shiftChip}>
                      <div className="h-8" />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
          <div className={`h-12 ${WEEK_GRID.row}`} />
        </div>

        {/* The day list below `lg`: a day's label, then its people as
            hairline rows — a name's line over one 44px entry, the loaded
            row's 84px — with days 24px apart and no rule above a label. */}
        <div className="mt-4 lg:hidden">
          {[0, 1, 2].map((day) => (
            <div key={day} className="mt-6 first:mt-0">
              <div className="h-4 w-32 rounded bg-surface-sunken" />
              <div className="mt-2">
                {[0, 1, 2].map((row) => (
                  <div key={row} className={`py-2 ${ledgerRowBoxClass}`}>
                    <div className="flex h-5 items-center">
                      <div className="h-4 w-28 rounded bg-surface-sunken" />
                    </div>
                    <div className="mt-1 flex h-11 items-center">
                      <div className="h-4 w-40 rounded bg-surface-sunken" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* "Add a shift" and "Tell the shop you're away": 48px summaries,
            each on its closing rule alone under the week, as the page draws
            them. */}
        {[0, 1].map((door) => (
          <div key={door} className={weekTailRowClass}>
            <div className="flex h-12 items-center">
              <div className="h-4 w-36 rounded bg-surface-sunken" />
            </div>
          </div>
        ))}

        {/* The consent row, a 44px disclosure. */}
        <div className="mt-10 flex h-11 items-center">
          <div className="h-4 w-44 rounded bg-surface-sunken" />
        </div>

        <div className="mt-10">
          <div className="h-4 w-28 rounded bg-surface-sunken" />
          <div className="mt-2">
            {[0, 1, 2].map((row) => (
              <div key={row} className={`h-12 ${ledgerRowBoxClass}`} />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
