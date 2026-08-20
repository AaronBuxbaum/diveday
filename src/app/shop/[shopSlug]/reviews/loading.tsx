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
        <div className="mb-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={sectionCardClass({ padding: "none", className: "h-28" })} />
          ))}
        </div>
        <div className="mb-6 h-5 w-64 rounded bg-surface-sunken" />
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="h-10 w-48 rounded-full bg-surface-sunken" />
          <div className="h-9 w-40 rounded-lg bg-surface-sunken" />
        </div>
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className={sectionCardClass({ padding: "none", className: "h-36" })} />
          ))}
        </div>
      </div>
    </main>
  );
}
