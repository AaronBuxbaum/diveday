import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Body-shaped skeleton for the Orders day ledger (design principle 1; the
 * shape it holds is ADR 20260827-clearwater-surface-language decision 7).
 *
 * It follows the page it replaces: a toolbar of a search box and two selects,
 * then day groups — a small-caps header line with its count and subtotal on
 * the right, and hairline rows beneath it directly on the page background. No
 * card shell anywhere, because the ledger has none; the skeleton this replaces
 * painted a filter card above a bordered table, which is a picture of a page
 * that no longer exists.
 */
export default function OrdersIndexLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton descriptionWidth="w-80 max-w-full" />

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="h-11 w-full rounded-lg bg-surface-sunken sm:w-80" />
          <div className="h-11 w-36 rounded-lg bg-surface-sunken" />
          <div className="h-11 w-40 rounded-lg bg-surface-sunken" />
        </div>

        <div className="mt-8 flex flex-col gap-9">
          {[0, 1].map((group) => (
            <div key={group}>
              <div className="flex items-baseline justify-between gap-3 pb-2">
                <div className="h-3 w-32 rounded bg-surface-sunken" />
                <div className="h-3 w-28 rounded bg-surface-sunken" />
              </div>
              {[0, 1, 2].map((row) => (
                <div key={row} className="h-12 border-t border-border last:border-b" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
