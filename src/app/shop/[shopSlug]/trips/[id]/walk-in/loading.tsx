import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/** Form-shaped skeleton for a departure's walk-in form (design principle 1). */
export default function WalkInDiverLoading() {
  return (
    <div className="max-w-2xl">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" description={false} />
        <div className={sectionCardClass({ padding: "lg", className: "mt-8" })}>
          {["name", "email", "phone", "trip"].map((slot) => (
            <div key={slot} className="mt-4 first:mt-0">
              <div className="h-4 w-24 rounded bg-surface-sunken" />
              <div className="mt-2 h-12 w-full rounded-lg bg-surface-sunken" />
            </div>
          ))}
          <div className="mt-6 h-11 w-40 rounded-lg bg-surface-sunken" />
        </div>
      </div>
    </div>
  );
}
