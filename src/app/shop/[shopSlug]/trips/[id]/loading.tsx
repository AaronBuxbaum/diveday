import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Body-shaped skeleton for a trip surface (design principle 1). It renders as
 * the layout's children, so the sub-nav above stays put and only this area
 * flickers to a skeleton while the next tab's data loads — the tab switch reads
 * as instant instead of a blank hang.
 */
export default function TripSurfaceLoading() {
  return (
    <div className="animate-pulse">
      <ShopPageHeaderSkeleton
        eyebrow={false}
        description={false}
        meta={<div className="h-6 w-56 max-w-full rounded bg-surface-sunken" />}
      />
      <div className="mt-8 flex flex-col gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-lg border border-border bg-surface" />
        ))}
      </div>
    </div>
  );
}
