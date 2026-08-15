import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/** Grid-shaped skeleton for the dive-site list (design principle 1). */
export default function DiveSitesLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" descriptionWidth="w-full max-w-xl" />
        {/* `gap-3` is the site grid's own gap, and the tiles take their shell
            from the same place the site cards do — a skeleton a step rounder
            or flatter than what replaces it is a jump on every navigation in.
            `mt-8` stays as the middle ground for the offset above the grid: the
            page puts a stat row and a search band there only once the library
            has anything in it, and the skeleton cannot know which. */}
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={sectionCardClass({ padding: "none", className: "h-44" })} />
          ))}
        </div>
      </div>
    </main>
  );
}
