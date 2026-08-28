import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

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
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-48" descriptionWidth="w-full max-w-xl" />
        <div className="mt-8 space-y-8">
          {[0, 1].map((group) => (
            <div key={group}>
              <div className="h-3 w-16 rounded bg-surface-sunken" />
              <div className="mt-2">
                {[0, 1, 2].map((row) => (
                  <div
                    key={row}
                    className="flex min-h-12 items-center gap-3 border-t border-border py-3 last:border-b"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="h-4 w-52 max-w-full rounded bg-surface-sunken" />
                      <div className="mt-2 h-3 w-64 max-w-full rounded bg-surface-sunken" />
                    </div>
                    <div className="h-8 w-20 shrink-0 rounded-lg bg-surface-sunken" />
                    <div className="h-8 w-16 shrink-0 rounded-lg bg-surface-sunken" />
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
