import { ledgerRowBoxClass } from "@/components/ui/ledger";
import { TripPageHeaderSkeleton } from "../_components/TripPageHeader";

/**
 * Body-shaped skeleton for a departure's Check-in tab (design principle 1) —
 * the readiness lookup has no loading state to show meanwhile, and this page
 * runs during the morning rush.
 *
 * The departure's own header skeleton, then the counter instrument it stands
 * in for (ADR 20260827-clearwater-surface-language, decision 9): the count
 * figure over its meter, then hairline queue rows.
 */
export default function TripCheckInLoading() {
  return (
    <div className="animate-pulse">
      <TripPageHeaderSkeleton titleLines={{ base: 2, sm: 1 }} />
      <div className="mt-8">
        {/* The figure, then its 5px meter. */}
        <div className="h-10 w-40 rounded bg-surface-sunken" />
        <div className="mt-3 h-[5px] w-full rounded-full bg-surface-sunken" />
      </div>
      <div className="mt-8">
        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            className={`flex min-h-14 items-center justify-between gap-4 ${ledgerRowBoxClass}`}
          >
            <div className="h-5 w-44 max-w-full rounded bg-surface-sunken" />
            <div className="h-6 w-24 rounded bg-surface-sunken" />
          </div>
        ))}
      </div>
    </div>
  );
}
