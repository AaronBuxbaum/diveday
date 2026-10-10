import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { ledgerRowBoxClass } from "@/components/ui/ledger";

/**
 * Roster-shaped skeleton for the staff course list (design principle 1).
 *
 * Shaped to the page as ADR 20260827-the-shops-shelves recomposed it: an
 * agency group label over a run of hairline rows, twice — not the four
 * bordered cards it painted while the roster was a card wrapping a divided
 * list. A skeleton of the previous composition is a layout jump on every
 * navigation into the route, which is the one thing this file exists to
 * prevent.
 */
export default function StaffCoursesLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton eyebrow={false} titleWidth="w-48" description={false} actions />
        <div className="mt-8 space-y-8">
          {[0, 1].map((group) => (
            <div key={group}>
              {/* The group's small-caps label: a 16px line, the bar inside it. */}
              <div className="flex h-4 items-center">
                <div className="h-3 w-16 rounded bg-surface-sunken" />
              </div>
              <div className="mt-2">
                {[0, 1, 2].map((row) => (
                  // The loaded row at 390 and 1280 alike (#1993, measured):
                  // `py-3` around the name's 24px line and the 20px line
                  // under it, 2px apart, so 71px with its rule; its one
                  // 44px act sits in the row's `-my-2` and adds nothing. A
                  // course whose content needs a warning line is taller, and
                  // only that row moves.
                  <div
                    key={row}
                    className={`flex min-h-13 items-center gap-3 py-3 ${ledgerRowBoxClass}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex h-6 items-center">
                        <div className="h-4 w-52 max-w-full rounded bg-surface-sunken" />
                      </div>
                      <div className="mt-0.5 flex h-5 items-center">
                        <div className="h-3 w-64 max-w-full rounded bg-surface-sunken" />
                      </div>
                    </div>
                    <div className="-my-2 h-11 w-21 shrink-0 rounded-lg bg-surface-sunken" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
