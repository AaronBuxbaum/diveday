import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Checklist-shaped skeleton for trip prep — renders as the trip layout's
 * children, so switching to the Prep tab keeps the sub-nav in place.
 */
export default function TripPrepLoading() {
  return (
    <div className="animate-pulse">
      <ShopPageHeaderSkeleton
        eyebrow={false}
        titleWidth="w-64 max-w-full"
        descriptionWidth="w-56"
        meta={<div className="h-6 w-56 max-w-full rounded bg-surface-sunken" />}
      />
      <div className="mt-8">
        <div className="h-6 w-32 rounded bg-surface-sunken" />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className={sectionCardClass({ padding: "none", className: "h-28" })} />
          ))}
        </div>
        <div className="mt-2 h-4 w-72 max-w-full rounded bg-surface-sunken" />
        <div className="mt-8 flex flex-col gap-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className={sectionCardClass({ padding: "md", className: "h-36" })} />
          ))}
        </div>
        <div className="mt-8 h-6 w-40 rounded bg-surface-sunken" />
        <div className={sectionCardClass({ padding: "none", className: "mt-3 h-64" })} />
      </div>
    </div>
  );
}
