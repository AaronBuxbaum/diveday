import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Content-shaped skeleton for the schedule board (design principle 1).
 *
 * Two shapes, because the board has two compositions and the skeleton must be
 * the one the width is about to paint: seven columns at `xl` and up, the
 * vertical day stream below it (ADR 20260827-clearwater-surface-language,
 * decision 5). A stream skeleton resolving into a grid is exactly the layout
 * jump this file exists to prevent.
 */
export default function ScheduleBoardLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-48" descriptionWidth="w-56" />
        <div className="mt-4 hidden xl:block">
          <div className="flex items-center gap-2">
            <div className="size-10 rounded-lg bg-surface-sunken" />
            <div className="size-10 rounded-lg bg-surface-sunken" />
            <div className="ms-2 h-5 w-40 rounded bg-surface-sunken" />
          </div>
          <div className="mt-4 grid grid-cols-7 border-t border-border">
            {[0, 1, 2, 3, 4, 5, 6].map((column) => (
              <div
                key={column}
                className={`px-2 pt-3 pb-3 ${column === 0 ? "" : "border-s border-border"}`}
              >
                <div className="h-3 w-8 rounded bg-surface-sunken" />
                <div className="mt-2 h-6 w-7 rounded bg-surface-sunken" />
                <div className="mt-3 flex flex-col gap-2">
                  {[0, 1].map((entry) => (
                    <div
                      key={entry}
                      className="h-20 rounded-inset border border-border bg-surface-sunken"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-8 xl:hidden">
          {[0, 1, 2].map((day) => (
            <div key={day}>
              <div className="flex items-center gap-3 py-2">
                <div className="h-9 w-8 rounded bg-surface-sunken" />
                <div className="flex flex-col gap-1">
                  <div className="h-3 w-16 rounded bg-surface-sunken" />
                  <div className="h-3 w-20 rounded bg-surface-sunken" />
                </div>
                <div className="h-px min-w-8 flex-1 bg-border" />
                <div className="h-9 w-20 rounded-lg bg-surface-sunken" />
              </div>
              <div className="mt-2 flex flex-col gap-2">
                {[0, 1].map((trip) => (
                  <div
                    key={trip}
                    className={sectionCardClass({ padding: "none", className: "h-24" })}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
