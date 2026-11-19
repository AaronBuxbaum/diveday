import type { OfflineTripControls } from "./controls";
import { ReviewObservation } from "./ReviewObservation";
import type { OfflineTripView } from "./trip-view";

/** Identify each refused mark without changing the causal roll-call rows. */
export function MissingRollCallRefusals({
  view,
  controls,
}: {
  view: OfflineTripView;
  controls: OfflineTripControls;
}) {
  const missing = view.envelope.events.filter(
    (event) => (event.syncStatus === "rejected" || event.reviewRequired) && !event.reviewResolution,
  );
  if (!missing.length) return null;
  return (
    <div className="mt-6 text-base text-foreground">
      <ul className="space-y-4">
        {missing.map((event) => {
          const checkpoint =
            event.checkpoint === "departure"
              ? controls.t("shared.rollCallCheckpoint.departure")
              : controls.t("shared.rollCallCheckpoint.afterDive", {
                  n: Number(event.checkpoint.slice("after_dive_".length)),
                });
          const originalManifest =
            event.snapshotId === view.envelope.snapshot.snapshotId
              ? view.envelope.snapshot.manifests.find(
                  (manifest) => manifest.checkpoint === event.checkpoint,
                )
              : undefined;
          const originalName = event.bookingId
            ? originalManifest?.divers.find(
                (diver) => diver.bookingId === event.bookingId && !diver.identityWithheld,
              )?.fullName
            : originalManifest?.crew.find((member) => member.id === event.crewPersonId)?.fullName;
          return (
            <li
              key={event.clientEventId}
              className="space-y-3 rounded-panel border border-danger bg-danger/5 p-4"
            >
              <p role="status" className="font-semibold text-danger">
                {controls.t(
                  event.reviewRequired
                    ? "shared.offlineManifest.single.reviewPendingRollCall"
                    : "shared.offlineManifest.single.refusedMissingRollCall",
                  {
                    reference: (event.bookingId ?? event.crewPersonId ?? event.clientEventId).slice(
                      -8,
                    ),
                    checkpoint,
                  },
                )}
              </p>
              {event.reviewRequired && (
                <p>
                  {originalName
                    ? controls.t("shared.offlineManifest.single.reviewOriginalSubjectName", {
                        name: originalName,
                        reference: event.bookingId ?? event.crewPersonId ?? event.clientEventId,
                      })
                    : controls.t("shared.offlineManifest.single.reviewOriginalSubjectUnknown", {
                        reference: event.bookingId ?? event.crewPersonId ?? event.clientEventId,
                      })}{" "}
                  {originalManifest
                    ? controls.t("shared.offlineManifest.single.reviewSavedTrip", {
                        trip: originalManifest.trip.title,
                      })
                    : controls.t("shared.offlineManifest.single.reviewSavedTripUnknown", {
                        reference: event.tripId,
                      })}{" "}
                  {event.meetingDay === undefined
                    ? controls.t("shared.offlineManifest.single.reviewUnknownDay")
                    : controls.t("shared.offlineManifest.single.reviewOriginalDay", {
                        day: event.meetingDay + 1,
                      })}{" "}
                  {controls.t("shared.offlineManifest.single.reviewRecorded", {
                    mark: controls.t(
                      event.status === "boarded"
                        ? "shared.presence.boarded"
                        : event.status === "not_boarded"
                          ? event.checkpoint === "departure"
                            ? "shared.presence.notBoarded"
                            : "shared.offlineManifest.single.notBackAboardActive"
                          : "shared.offlineManifest.single.reviewWithdrawal",
                    ),
                  })}
                </p>
              )}
              {event.reviewRequired && <ReviewObservation event={event} controls={controls} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
