import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Receipt-shaped skeleton for one order (design principle 1) — line items,
 * payment state is read per request.
 *
 * The shell comes from `sectionCardClass({ padding: "lg" })`, the same call
 * the page's own receipt card makes, so the two cannot drift apart.
 *
 * **The header carries the page's `meta` line** (K-244): every order says
 * when it was raised, by whom, and links the diver's record, one 20px
 * `text-sm` line in the header's `mt-3`. Without its bar the card sat 32px high
 * and dropped when the order arrived. The card takes no margin of its own: the
 * header's `mb-8` is the gap, and a second one only collapses into it.
 */
export default function OrderLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton
          titleWidth="w-64 max-w-full"
          description
          descriptionWidth="w-48"
          meta={<div className="h-5 w-80 max-w-full rounded bg-surface-sunken" />}
        />
        <div className={sectionCardClass({ padding: "lg" })}>
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
