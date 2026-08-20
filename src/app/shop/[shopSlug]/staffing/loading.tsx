import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for the shift roster (design principle 1): the window
 * form, the one crew-gap summary line, the roster-with-shifts grid, and the
 * add-a-shift form — in the order the page renders them.
 */
export default function StaffingLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton descriptionWidth="w-80 max-w-full" />

        <div className={sectionCardClass({ padding: "none", className: "mt-8 h-24" })} />

        <div className={sectionCardClass({ padding: "none", className: "mt-4 h-14" })} />

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={sectionCardClass({ padding: "none", className: "h-40" })} />
          ))}
        </div>

        <div className={sectionCardClass({ padding: "none", className: "mt-8 h-64" })} />
      </div>
    </main>
  );
}
