import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Receipt-shaped skeleton for one order (design principle 1) — line items,
 * payment state is read per request.
 *
 * The shell comes from `sectionCardClass({ padding: "lg" })`, the same call
 * the page's own receipt card makes, so the two cannot drift apart.
 */
export default function OrderLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-64 max-w-full" descriptionWidth="w-48" />
        <div className={sectionCardClass({ padding: "lg", className: "mt-8" })}>
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 rounded-inset bg-surface-sunken" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
