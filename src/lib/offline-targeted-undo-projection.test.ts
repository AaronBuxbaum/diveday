import { expect, it } from "vitest";
import { crewSnapshot } from "@/test/substrate-fixtures/lib/offline-manifests-fixtures";
import {
  latestOfflineCrewRollCall,
  latestOfflineRollCall,
  type OfflineRollCallEvent,
} from "./offline-manifests";
import { offlineCausalContext } from "./roll-call-offline-causality";

for (const role of ["diver", "crew"] as const) {
  it(`keeps independent compatible ${role} evidence confirmed through a queued and refreshed exact undo`, () => {
    const saved = crewSnapshot();
    const manifest = saved.manifests[0];
    const row = role === "diver" ? manifest.divers[0] : manifest.crew[0];
    if (!row) throw new Error("missing fixture subject");
    const subject =
      role === "diver"
        ? { bookingId: manifest.divers[0].bookingId }
        : { crewPersonId: manifest.crew[0].id as string };
    const read = (events: OfflineRollCallEvent[]) =>
      role === "diver"
        ? latestOfflineRollCall(saved, events, manifest.divers[0].bookingId, "departure")
        : latestOfflineCrewRollCall(saved, events, manifest.crew[0].id as string, "departure");
    const mark = (clientEventId: string): OfflineRollCallEvent => ({
      clientEventId,
      snapshotId: saved.snapshotId,
      snapshotSavedAt: saved.savedAt,
      tripId: manifest.trip.id,
      ...subject,
      checkpoint: "departure",
      status: "not_boarded",
      occurredAt: saved.savedAt,
      note: null,
      meetingDay: 0,
      observedEvidenceIds: [],
      syncStatus: "pending",
    });
    const mine = mark(crypto.randomUUID());
    const theirs = mark(crypto.randomUUID());
    const undo: OfflineRollCallEvent = {
      ...mark(crypto.randomUUID()),
      status: "cleared",
      observedEvidenceIds: [`client:${mine.clientEventId}`],
      retractsClientEventId: mine.clientEventId,
    };
    const events = [mine, theirs, undo];
    const context = offlineCausalContext(saved, events, subject, "departure");
    expect(context.observedEvidenceIds).toEqual(
      [`client:${theirs.clientEventId}`, `client:${undo.clientEventId}`].sort(),
    );
    expect(read(events)?.state).toBe("not_boarded");
    // A real refreshed frame retains validated closure, including the now
    // withdrawn target. Neither receipt order nor an audit clock supplies it.
    row.rollCallContext = {
      ...context,
      ancestry: events.map((event) => ({
        id: `client:${event.clientEventId}`,
        status: event.status,
        observed: event.observedEvidenceIds,
        retracts: event.retractsClientEventId ? `client:${event.retractsClientEventId}` : undefined,
      })),
    };
    expect(read([])?.state).toBe("not_boarded");
    expect(row.rollCallContext.conflict).toBe(false);
  });
}
