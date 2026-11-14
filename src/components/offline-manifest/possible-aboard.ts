import type { OfflineManifestSnapshot, OfflineRollCallEvent } from "@/lib/offline-manifests";

type Subject = { bookingId: string } | { crewPersonId: string };

/** Unresolved changes cannot disprove saved or locally observed boarding. */
export function uncertainPossibleAboard(
  snapshot: OfflineManifestSnapshot,
  events: readonly OfflineRollCallEvent[],
  reviewReasons: ReadonlyMap<string, string>,
  subject: Subject,
): boolean {
  const belongs = (event: OfflineRollCallEvent) =>
    "bookingId" in subject
      ? event.bookingId === subject.bookingId && !event.crewPersonId
      : event.crewPersonId === subject.crewPersonId && !event.bookingId;
  const uncertain = events.filter(
    (event) => reviewReasons.has(event.clientEventId) && belongs(event),
  );
  if (!uncertain.length) return false;
  if (
    events.some(
      (event) => belongs(event) && event.status === "boarded" && event.syncStatus !== "rejected",
    )
  )
    return true;
  return snapshot.manifests.some((manifest) => {
    const row =
      "bookingId" in subject
        ? manifest.divers.find((diver) => diver.bookingId === subject.bookingId)
        : manifest.crew.find((crew) => crew.id === subject.crewPersonId);
    return (
      row?.rollCall?.state === "boarded" ||
      row?.rollCallContext?.evidence.some((item) => item.status === "boarded") === true
    );
  });
}
