import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for Reviews (design principle 1) — the moderation
 * queue and stats row have no loading state to show meanwhile.
 */
export default function ReviewsLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton descriptionWidth="w-80 max-w-full" />
        <div className="mt-8 flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className={sectionCardClass({ padding: "none", className: "h-28" })} />
          ))}
        </div>
      </div>
    </main>
  );
}
