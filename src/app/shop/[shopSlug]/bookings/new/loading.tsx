import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

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
        <ShopPageHeaderSkeleton titleWidth="w-56" descriptionWidth="w-full max-w-lg" />
        <div className="mt-8 h-3 w-36 rounded bg-surface-sunken" />
        <div className="mt-4 space-y-6">
          {[0, 1].map((day) => (
            <div key={day}>
              <div className="h-3 w-24 rounded bg-surface-sunken" />
              <div className="mt-2">
                {[0, 1].map((row) => (
                  <div
                    key={row}
                    className="flex min-h-12 items-center gap-3 border-t border-border last:border-b"
                  >
                    <div className="h-4 flex-1 rounded bg-surface-sunken" />
                    <div className="h-4 w-24 shrink-0 rounded bg-surface-sunken" />
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
