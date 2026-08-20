import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

export default function GearUnitLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="h-4 w-28 rounded bg-surface-sunken" />
        <div className="mt-4">
          <ShopPageHeaderSkeleton descriptionWidth="w-64 max-w-full" />
        </div>
        <div className="mt-8 flex flex-col gap-10">
          {[0, 1, 2].map((i) => (
            <div key={i} className={sectionCardClass({ padding: "none", className: "h-40" })} />
          ))}
        </div>
      </div>
    </main>
  );
}
