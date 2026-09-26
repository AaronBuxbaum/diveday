import { TripPageHeaderSkeleton } from "../_components/TripPageHeader";
import { PrepBodySkeleton } from "./_components/PrepBodySkeleton";

/**
 * Checklist-shaped skeleton for trip prep. Both halves are the pieces the page
 * itself is made of, drawn as bars: the header is `TripPageHeader`'s own
 * skeleton (its way back, the boat's name, the capacity row, and no
 * description), and the body is the one the departure page waits behind, at
 * the `space-y-10` the page hands `PrepBody`, so none of the three can drift
 * (K-188, K-487). The boat's name wraps to two lines on a phone ("Two-Tank
 * Reef — Molasses & French"), one from `sm`.
 */
export default function TripPrepLoading() {
  return (
    <div className="animate-pulse">
      <TripPageHeaderSkeleton titleLines={{ base: 2, sm: 1 }} />
      <PrepBodySkeleton className="space-y-10" />
    </div>
  );
}
