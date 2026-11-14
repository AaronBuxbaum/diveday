import { formatDateTimeTz } from "@/lib/format";
import { offlineReviewReasons } from "@/lib/roll-call-offline-causality";
import type { OfflineTripControls } from "./controls";
import type { OfflineTripView } from "./trip-view";

/** Identify each refused mark without changing the causal roll-call rows. */
export function MissingRollCallRefusals({
  view,
  controls,
  paper = false,
}: {
  view: OfflineTripView;
  controls: Pick<OfflineTripControls, "t" | "locale">;
  paper?: boolean;
}) {
  const missing = view.envelope.events.filter((event) => event.syncStatus === "rejected");
  const reviewReasons = offlineReviewReasons(view.envelope.snapshot, view.envelope.events);
  const unresolved = view.envelope.events.filter((event) => reviewReasons.has(event.clientEventId));
  if (!missing.length && !unresolved.length) return null;
  return (
    <div
      role="status"
      className={paper ? "mt-1 text-sm font-bold" : "mt-6 text-sm font-medium text-danger"}
    >
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
        {unresolved.map((event) => {
          const checkpoint =
            event.checkpoint === "departure"
              ? controls.t("shared.rollCallCheckpoint.departure")
              : controls.t("shared.rollCallCheckpoint.afterDive", {
                  n: Number(event.checkpoint.slice("after_dive_".length)),
                });
          const names = view.envelope.snapshot.manifests.map((manifest) =>
            event.bookingId
              ? manifest.divers.find((diver) => diver.bookingId === event.bookingId)?.fullName
              : manifest.crew.find((crew) => crew.id === event.crewPersonId)?.fullName,
          );
          const name =
            names.find((value) => value !== undefined) ??
            (event.bookingId ?? event.crewPersonId ?? event.clientEventId).slice(-8);
          const result =
            event.status === "cleared"
              ? controls.t("shared.offlineManifest.single.unresolvedCleared")
              : event.status === "boarded"
                ? controls.t(
                    event.checkpoint === "departure"
                      ? "shared.offlineManifest.single.unresolvedBoarded"
                      : "shared.offlineManifest.single.unresolvedBackAboard",
                  )
                : controls.t(
                    event.checkpoint === "departure"
                      ? "shared.offlineManifest.single.unresolvedNotBoarded"
                      : "shared.offlineManifest.single.unresolvedNotBackAboard",
                  );
          return (
            <li key={event.clientEventId}>
              {controls.t("shared.offlineManifest.single.unresolvedRollCall", {
                name,
                result,
                checkpoint,
                reference: event.clientEventId.slice(-8),
                when: formatDateTimeTz(
                  new Date(event.occurredAt),
                  controls.locale,
                  view.envelope.snapshot.shop.timezone,
                ),
                reason: controls.t(
                  reviewReasons.get(event.clientEventId) === "meeting_identity_unverified"
                    ? "shared.offlineManifest.single.unresolvedMeetingReason"
                    : reviewReasons.get(event.clientEventId) === "unresolved_predecessor"
                      ? "shared.offlineManifest.single.unresolvedPredecessorReason"
                      : reviewReasons.get(event.clientEventId) === "client_event_conflict"
                        ? "shared.offlineManifest.single.unresolvedConflictReason"
                        : "shared.offlineManifest.single.unresolvedOtherReason",
                ),
              })}
              {!paper && event.note && !event.noteDisposition && (
                <p>
                  {controls.t("shared.offlineManifest.single.unresolvedNote", { note: event.note })}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
