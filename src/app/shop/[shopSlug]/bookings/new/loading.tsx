import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { ledgerRowBoxClass } from "@/components/ui/ledger";

/**
 * Departure-picker skeleton for the global "add a booking" door (design
 * principle 1) — step one is choosing which departure to seat someone on, and
 * that list is read per request.
 *
 * Shaped to the page as ADR 20260827-the-shops-shelves recomposed it: the step
 * label, then a day heading over a run of hairline rows, twice. A skeleton of
 * the card-wrapped stack of sunken boxes it painted before is a layout jump on
 * every navigation into the route, which is the one thing this file exists to
 * prevent.
 */
export default function NewBookingLoading() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" description={false} />
        {/* The day control (`DepartureDayNav`): its label over the date box,
            Show beside it. */}
        <div className="mt-8 flex items-end gap-2">
          {/* The label's 20px line, 4px over the 48px date box, and Show at
              the box's height: 72px, as the loaded control measures. */}
          <div>
            <div className="flex h-5 items-center">
              <div className="h-4 w-10 rounded bg-surface-sunken" />
            </div>
            <div className="mt-1 h-12 w-44 rounded-lg bg-surface-sunken" />
          </div>
          <div className="h-12 w-20 rounded-lg bg-surface-sunken" />
        </div>
        {/* The small-caps labels are 16px lines, the bars inside them. */}
        <div className="mt-6 flex h-4 items-center">
          <div className="h-3 w-36 rounded bg-surface-sunken" />
        </div>
        <div className="mt-4 space-y-6">
          {[0, 1].map((day) => (
            <div key={day}>
              <div className="flex h-4 items-center">
                <div className="h-3 w-24 rounded bg-surface-sunken" />
              </div>
              <div className="mt-2">
                {[0, 1].map((row) => (
                  // A departure row as it loads (#1993, measured): on a
                  // phone the time's 20px line over a title that wraps to
                  // two 24px lines, 2px apart, in `py-2`, so 87px with its
                  // rule; from `sm` the time sits beside a one-line title
                  // and the row stands at its 52px floor.
                  <div
                    key={row}
                    className={`flex min-h-13 items-center gap-3 py-2 ${ledgerRowBoxClass}`}
                  >
                    <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
                      <div className="flex h-5 items-center sm:w-36 sm:shrink-0">
                        <div className="h-3 w-28 rounded bg-surface-sunken" />
                      </div>
                      <div className="mt-0.5 flex h-12 flex-col justify-center gap-2 sm:mt-0 sm:h-6 sm:flex-1">
                        <div className="h-4 w-full rounded bg-surface-sunken" />
                        <div className="h-4 w-2/3 rounded bg-surface-sunken sm:hidden" />
                      </div>
                    </div>
                    <div className="h-4 w-16 shrink-0 rounded bg-surface-sunken" />
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
