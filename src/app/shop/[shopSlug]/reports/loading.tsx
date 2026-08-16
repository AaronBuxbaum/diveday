import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for Reports (design principle 1) — the monthly
 * revenue/fill-rate/waiver-completion rollup has no loading state to show
 * meanwhile.
 */
export default function ReportsLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton descriptionWidth="w-80 max-w-full" />
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={sectionCardClass({ padding: "none", className: "h-24" })} />
          ))}
        </div>
        <div className={sectionCardClass({ padding: "none", className: "mt-8 h-64" })} />
      </div>
    </main>
  );
}
