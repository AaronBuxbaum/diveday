import { expect, it } from "vitest";
import { offlineTripView } from "@/components/offline-manifest/trip-view";
import { snapshot } from "@/test/substrate-fixtures/lib/offline-manifests-fixtures";
import {
  latestOfflineRollCall,
  type OfflineRollCallEvent,
  sendableOfflineRollCallEvents,
} from "./offline-manifests";

const base = {
  tripId: "trip",
  snapshotId: "snapshot",
  snapshotSavedAt: "2026-01-01T00:00:00Z",
  occurredAt: "2026-01-01T00:00:00Z",
  checkpoint: "departure",
  status: "not_boarded",
  syncStatus: "pending",
  bookingId: "booking",
} as const;
it("holds transitive observers and retractions while allowing independent pending observations", () => {
  const events: OfflineRollCallEvent[] = [
    { ...base, clientEventId: "a", reviewRequired: true },
    { ...base, clientEventId: "b", observedEvidenceIds: ["client:a"] },
    { ...base, clientEventId: "c", status: "cleared", retractsClientEventId: "b" },
    { ...base, clientEventId: "d" },
  ];
  expect(sendableOfflineRollCallEvents(events).map((event) => event.clientEventId)).toEqual(["d"]);
});
it("shows review rather than sending for a review-only saved trip", () => {
  const view = offlineTripView(
    {
      snapshot: snapshot(),
      events: [{ ...base, clientEventId: "a", reviewRequired: true }],
      checklistEvents: [],
      arrivalEvents: [],
    },
    "departure",
  );
  expect(view?.pending).toBe(0);
  expect(view?.rejected).toBe(1);
});
it("does not let a held positive correction silence an unresolved missing alarm", () => {
  const copy = snapshot();
  const events: OfflineRollCallEvent[] = [
    {
      ...base,
      bookingId: "ready",
      checkpoint: "after_dive_1",
      clientEventId: "a",
      reviewRequired: true,
    },
    {
      ...base,
      bookingId: "ready",
      checkpoint: "after_dive_1",
      clientEventId: "b",
      status: "boarded",
      observedEvidenceIds: ["client:a"],
    },
  ];
  expect(latestOfflineRollCall(copy, events, "ready", "after_dive_1")?.state).toBe("not_boarded");
});
