import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { PrepBodySkeleton } from "./_components/PrepBodySkeleton";

/**
 * Checklist-shaped skeleton for trip prep. The body half is the same component
 * the departure page waits behind, so the two cannot drift.
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
        <PrepBodySkeleton />
      </div>
    </div>
  );
}
