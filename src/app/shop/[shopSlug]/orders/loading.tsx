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

        <div className={sectionCardClass({ padding: "none", className: "mt-8 h-24" })} />

        <div className={sectionCardClass({ padding: "none", className: "mt-6 h-72" })} />
      </div>
    </main>
  );
}
