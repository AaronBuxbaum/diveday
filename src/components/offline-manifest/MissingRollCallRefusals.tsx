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
    <div role="status" className="mt-6 text-sm font-medium text-danger">
      <ul>
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
            <li key={event.clientEventId}>
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
                  {controls.t("shared.offlineManifest.single.reviewSavedTrip", {
                    trip: view.manifest.trip.title,
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
