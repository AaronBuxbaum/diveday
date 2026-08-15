import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Detail-shaped skeleton for one dive site (design principle 1) — briefing,
 * media, and landmark blocks all resolve per request. Every block takes its
 * shell from `sectionCardClass`, the same place the page's own cards do: this
 * file used to draw the first block at `rounded-2xl` and the three under it at
 * `rounded-xl`, so the skeleton disagreed with itself as well as with the page.
 */
export default function DiveSiteLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-72 max-w-full" descriptionWidth="w-full max-w-xl" />
        <div className={sectionCardClass({ padding: "none", className: "mt-8 h-56" })} />
        <div className="mt-6 flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className={sectionCardClass({ padding: "none", className: "h-24" })} />
          ))}
        </div>
      </div>
    </main>
  );
}
