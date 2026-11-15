import { offlineArrivalEvents } from "@/lib/offline-manifests";
import type { OfflineTripControls } from "./controls";
import type { OfflineTripView } from "./trip-view";

/** Keep refused arrivals visible even when their seat is no longer on the counter. */
export function OfflineArrivalRefusals({
  view,
  controls,
}: {
  view: OfflineTripView;
  controls: OfflineTripControls;
}) {
  const events = offlineArrivalEvents(view.envelope);
  const represented = new Set<string>();
  for (const { diver, refused } of view.counterSeats) {
    if (!refused) continue;
    const newest = events.reduce<(typeof events)[number] | undefined>(
      (found, event) =>
        event.bookingId === diver.bookingId && (!found || event.occurredAt >= found.occurredAt)
          ? event
          : found,
      undefined,
    );
    if (newest?.syncStatus === "rejected") represented.add(newest.clientEventId);
  }
  const rejected = events.filter(
    (event) => event.syncStatus === "rejected" && !represented.has(event.clientEventId),
  );
  if (rejected.length === 0) return null;
  return (
    <div role="status" className="mt-6 text-sm font-medium text-danger">
      <ul>
        {rejected.map((event) => (
          <li key={event.clientEventId}>
            {controls.t("shared.offlineManifest.single.counter.refusedMissingSeat", {
              reference: event.bookingId.slice(-8),
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}
