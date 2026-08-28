import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for Promos (design principle 1) — the discount-code
 * list and Stripe status lookups have no loading state to show meanwhile.
 *
 * Shaped to the page as ADR 20260827-the-shops-shelves recomposed it: the
 * new-code card, then shelf labels over runs of hairline rows. A skeleton of
 * the stack of bordered cards it painted before is a layout jump on every
 * navigation into the route, which is the one thing this file exists to
 * prevent.
 */
export default function PromosLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton descriptionWidth="w-80 max-w-full" />
        <div className={sectionCardClass({ padding: "lg", className: "mt-8" })}>
          <div className="h-5 w-32 rounded bg-surface-sunken" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {[0, 1, 2, 3].map((field) => (
              <div key={field} className="h-11 rounded-lg bg-surface-sunken" />
            ))}
          </div>
        </div>
        <div className="mt-10 space-y-8">
          {[0, 1].map((shelf) => (
            <div key={shelf}>
              <div className="h-3 w-20 rounded bg-surface-sunken" />
              <div className="mt-2">
                {[0, 1].map((row) => (
                  <div
                    key={row}
                    className="flex min-h-12 items-center gap-3 border-t border-border py-3 last:border-b"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="h-4 w-40 max-w-full rounded bg-surface-sunken" />
                      <div className="mt-2 h-3 w-72 max-w-full rounded bg-surface-sunken" />
                    </div>
                    <div className="h-8 w-24 shrink-0 rounded-lg bg-surface-sunken" />
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
