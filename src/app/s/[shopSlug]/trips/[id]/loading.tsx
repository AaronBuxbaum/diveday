import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for a trip's public detail page (design principle 1).
 * This page runs several parallel queries plus a conditional, timeout-bound
 * marine-forecast fetch, so a cold nav previously had a real beat with
 * nothing shaped to show meanwhile. Shaped like the redesigned body: back
 * link, eyebrow, title, the strong when-line, the price moment, then the one
 * raised booking card and a flat supporting band.
 */
export default function TripDetailLoading() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <div className="animate-pulse">
        <div className="h-4 w-24 rounded bg-surface-sunken" />
        <div className="mt-4">
          <ShopPageHeaderSkeleton
            titleWidth="w-72 max-w-full"
            description={false}
            meta={
              <>
                <div className="h-7 w-56 max-w-full rounded bg-surface-sunken" />
                <div className="mt-4 h-9 w-36 rounded bg-surface-sunken" />
              </>
            }
          />
        </div>
        {/* The booking card's shell, from the same place `TripBookingSection`
            takes it — this is the one raised card the page streams in. */}
        <div className={sectionCardClass({ padding: "none", className: "mt-10 h-72" })} />
        <div className="mt-12 h-40 rounded-2xl bg-surface-sunken" />
      </div>
    </main>
  );
}
