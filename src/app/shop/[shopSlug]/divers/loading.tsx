import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for the Divers roster (design principle 1) — a
 * keyset-paginated, search-filtered list with no loading state to show
 * meanwhile.
 */
export default function DiversLoading() {
  return (
    // max-w-6xl to match the page it stands in for — a narrower skeleton made
    // every navigation into the roster jump sideways when the real page landed.
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" description={false} />
        {/* The view-chips row, then the search box, then the list card —
            the same order the page renders them in. */}
        <div className="mt-6 flex flex-wrap gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-11 w-28 rounded-full bg-surface-sunken" />
          ))}
        </div>
        <div className="mt-6 h-11 w-full max-w-sm rounded-lg bg-surface-sunken" />
        <div
          className={sectionCardClass({
            padding: "none",
            className: "mt-6 flex flex-col divide-y divide-border",
          })}
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 bg-surface" />
          ))}
        </div>
      </div>
    </main>
  );
}
