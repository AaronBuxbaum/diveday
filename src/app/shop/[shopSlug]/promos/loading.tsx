import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { ledgerRowBoxClass } from "@/components/ui/ledger";
import { StaffSectionTabsSkeleton } from "../_components/StaffSectionTabs";

/**
 * Body-shaped skeleton for Promos (design principle 1) — the discount-code
 * list and Stripe status lookups have no loading state to show meanwhile.
 *
 * Shaped to the page as ADR 20260827-the-shops-shelves recomposed it: the
 * "New code" door, then shelf labels over runs of hairline rows. A skeleton of
 * the stack of bordered cards it painted before is a layout jump on every
 * navigation into the route, which is the one thing this file exists to
 * prevent.
 *
 * **The door, not the form** (K-392). The seven fields wait behind one
 * `secondary` button, 48px, for a shop with Stripe connected; this drew them
 * as a card of four 44px fields, about 200px the page never shows. And each
 * row is a loaded code row, `LedgerRow pad="lg"`: the 24px code line (the
 * Copy button hangs outside it), the shop's note and the line of facts, 20px
 * each at `mt-0.5`. A shelf's label is the group label's 16px line and its
 * `mb-2`.
 *
 * **And the header at the lines it wraps to.** "Discounts a diver can type"
 * is two lines at 390, and the description is two at 390 and at 1280; one bar
 * of each dropped the page 68px on a phone and 24px on a desk when it landed.
 */
export default function PromosLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton
          eyebrow={false}
          titleWidth="w-32"
          description
          descriptionWidth="w-80 max-w-full"
          descriptionLines={2}
        />
        <StaffSectionTabsSkeleton section="money" />
        <div className="mt-8 h-12 w-36 rounded-lg bg-surface-sunken" />
        <div className="mt-10 space-y-8">
          {[0, 1].map((shelf) => (
            <div key={shelf}>
              <div className="mb-2 flex h-4 items-center">
                <div className="h-3 w-20 rounded bg-surface-sunken" />
              </div>
              {[0, 1].map((row) => (
                <div
                  key={row}
                  className={`flex min-h-13 items-center gap-3 py-3 ${ledgerRowBoxClass}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="h-6 w-40 max-w-full rounded bg-surface-sunken" />
                    <div className="mt-0.5 flex h-5 items-center">
                      <div className="h-3.5 w-56 max-w-full rounded bg-surface-sunken" />
                    </div>
                    <div className="mt-0.5 flex h-5 items-center">
                      <div className="h-3.5 w-72 max-w-full rounded bg-surface-sunken" />
                    </div>
                  </div>
                  <div className="h-11 w-24 shrink-0 rounded-lg bg-surface-sunken" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
