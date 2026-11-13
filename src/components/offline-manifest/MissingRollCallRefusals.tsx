import type { OfflineTripControls } from "./controls";
import type { OfflineTripView } from "./trip-view";

/** Identify each refused mark without changing the causal roll-call rows. */
export function MissingRollCallRefusals({
  view,
  controls,
}: {
  view: OfflineTripView;
  controls: OfflineTripControls;
}) {
  const missing = view.envelope.events.filter((event) => event.syncStatus === "rejected");
  if (!missing.length) return null;
  return (
    <div role="status" className="mt-6 text-sm font-medium text-danger">
      <ul>
        {missing.map((event) => {
          const checkpoint =
            event.checkpoint === "departure"
              ? controls.t("shared.rollCallCheckpoint.departure")
              : controls.t("shared.rollCallCheckpoint.afterDive", {
                  n: Number(event.checkpoint.slice("after_dive_".length)),
                });
          return (
            <li key={event.clientEventId}>
              {controls.t("shared.offlineManifest.single.refusedMissingRollCall", {
                reference: (event.bookingId ?? event.crewPersonId ?? event.clientEventId).slice(-8),
                checkpoint,
              })}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
