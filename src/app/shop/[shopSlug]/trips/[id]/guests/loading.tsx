import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Roster-shaped skeleton for Guests. This route has its own trip header and
 * then a dense stack of roster rows, invitations, add-diver controls, and a
 * collapsed activity log; inheriting the overview surface's four generic
 * cards made tab switches redraw into the wrong page.
 */
export default function TripGuestsLoading() {
  return (
    <div className="animate-pulse">
      <ShopPageHeaderSkeleton
        eyebrow={false}
        titleWidth="w-64 max-w-full"
        description={false}
        meta={
          <div className="flex flex-col gap-2">
            <div className="h-6 w-56 max-w-full rounded bg-surface-sunken" />
            <div className="h-4 w-48 rounded bg-surface-sunken" />
          </div>
        }
      />
      {/* The roster is one grouped ledger now (slice 5d): group bands owning
          the state words, hairline rows beneath — so the skeleton is the same
          single card with two band bars, not a stack of floating cards that
          would redraw into a different page shape when the list streams in. */}
      <div className="mt-6 h-6 w-40 rounded bg-surface-sunken" />
      <div className={sectionCardClass({ padding: "none", className: "mt-5 overflow-hidden" })}>
        <div className="bg-surface-sunken/50 px-4 py-2.5 sm:px-5">
          <div className="h-3.5 w-28 rounded bg-surface-sunken" />
        </div>
        <div className="divide-y divide-border">
          {[0, 1].map((row) => (
            <div key={row} className="flex h-14 items-center px-4 sm:px-5">
              <div className="h-4 w-36 max-w-full rounded bg-surface-sunken" />
            </div>
          ))}
        </div>
        <div className="border-t border-border bg-surface-sunken/50 px-4 py-2.5 sm:px-5">
          <div className="h-3.5 w-20 rounded bg-surface-sunken" />
        </div>
        <div className="divide-y divide-border">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex h-14 items-center px-4 sm:px-5">
              <div className="h-4 w-36 max-w-full rounded bg-surface-sunken" />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-10 h-11 w-40 rounded-lg bg-surface-sunken" />
    </div>
  );
}
