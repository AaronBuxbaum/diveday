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
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="h-6 w-40 rounded bg-surface-sunken" />
          <div className="flex flex-wrap gap-2">
            <div className="h-11 w-11 rounded-lg bg-surface-sunken" />
            <div className="h-11 w-40 rounded-lg bg-surface-sunken" />
            <div className="h-11 w-11 rounded-lg bg-surface-sunken" />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={sectionCardClass({ padding: "none", className: "h-28" })} />
          ))}
        </div>
        <div className={sectionCardClass({ padding: "none", className: "mt-8 h-72" })} />
      </div>
    </main>
  );
}
