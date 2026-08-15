import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

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
      <div className="mt-8 flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-40 rounded-xl border border-border bg-surface" />
        ))}
      </div>
    </div>
  );
}
