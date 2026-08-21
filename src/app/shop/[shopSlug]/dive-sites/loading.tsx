import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/** Table-shaped skeleton for the dive-site list (design principle 1). */
export default function DiveSitesLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" descriptionWidth="w-full max-w-xl" />
        {/* The shell comes from `sectionCardClass()`, which is where `<Table>`
            takes its own — a skeleton a step rounder or flatter than what
            replaces it is a jump on every navigation in. `mt-8` stays as the
            middle ground for the offset above it: the page puts a search band
            there only once the library has anything in it, and the skeleton
            cannot know which. */}
        <div className={sectionCardClass({ padding: "none", className: "mt-8" })}>
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="h-16 border-b border-border last:border-b-0" />
          ))}
        </div>
      </div>
    </main>
  );
}
