import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Body-shaped skeleton for the staffing week (design principle 1): the week
 * pager, the day-header strip, five people rows of the grid, the gap row, and
 * the credentials ledger beneath — in the order the page renders them, at the
 * heights it renders them at.
 *
 * Hairlines rather than cards, because the page it stands in for is a ledger
 * now (ADR 20260827-the-shops-shelves, decision 3) and a skeleton made of
 * bordered boxes would be a layout jump dressed as a loading state.
 */
export default function StaffingLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        {/* `description={false}`: the header is an eyebrow and a name now —
            the line under it explained where crew is assigned, and the gap
            cell's own Assign door says it better. */}
        <ShopPageHeaderSkeleton description={false} titleWidth="w-40" />

        {/* Two step buttons and the range they step through. */}
        <div className="flex items-center gap-2">
          <div className="size-9 rounded-lg bg-surface-sunken" />
          <div className="size-9 rounded-lg bg-surface-sunken" />
          <div className="ms-2 h-5 w-40 rounded bg-surface-sunken" />
        </div>

        <div className="mt-4 border-t border-border">
          <div className="grid grid-cols-[9rem_repeat(7,minmax(0,1fr))]">
            <div className="px-2 pt-3 pb-2" />
            {[0, 1, 2, 3, 4, 5, 6].map((day) => (
              <div key={day} className="border-s border-border px-2 pt-3 pb-2">
                <div className="h-3 w-14 rounded bg-surface-sunken" />
              </div>
            ))}
          </div>
          {[0, 1, 2, 3, 4].map((row) => (
            <div
              key={row}
              className="grid grid-cols-[9rem_repeat(7,minmax(0,1fr))] border-t border-border"
            >
              <div className="px-2 py-3">
                <div className="h-4 w-24 rounded bg-surface-sunken" />
                <div className="mt-1 h-3 w-16 rounded bg-surface-sunken" />
              </div>
              {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                <div key={day} className="border-s border-border px-1.5 py-2">
                  {/* A shift lands in some cells and not others; a full grid of
                      bars would promise a week nobody works. */}
                  {(row + day) % 3 === 0 ? (
                    <div className="h-8 w-full rounded-lg bg-surface-sunken" />
                  ) : null}
                </div>
              ))}
            </div>
          ))}
          <div className="h-12 border-t border-b border-border" />
        </div>

        <div className="mt-10">
          <div className="h-3 w-28 rounded bg-surface-sunken" />
          <div className="mt-2">
            {[0, 1, 2].map((row) => (
              <div key={row} className="h-12 border-t border-border last:border-b" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
