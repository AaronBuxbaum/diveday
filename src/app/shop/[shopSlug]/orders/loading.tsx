import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for the Orders index (design principle 1) — the
 * filtered, paginated invoice list has no loading state to show meanwhile.
 *
 * Both shells come from `sectionCardClass()`, the same place the filter panel
 * and the `<Table>` take theirs, so the skeleton cannot drift squarer or
 * flatter than what replaces it.
 */
export default function OrdersIndexLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton descriptionWidth="w-80 max-w-full" />

        <div className={sectionCardClass({ padding: "md", className: "h-40" })}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((field) => (
              <div key={field}>
                <div className="h-4 w-24 rounded bg-surface-sunken" />
                <div className="mt-2 h-11 rounded-lg bg-surface-sunken" />
              </div>
            ))}
          </div>
        </div>

        <div className={sectionCardClass({ padding: "none", className: "mt-6" })}>
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="h-16 border-b border-border last:border-b-0" />
          ))}
        </div>
      </div>
    </main>
  );
}
