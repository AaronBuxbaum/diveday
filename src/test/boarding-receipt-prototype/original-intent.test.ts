import { describe, expect, it } from "vitest";
import type { OfflineRollCallEvent } from "@/lib/offline-manifests";
import { captureOriginalRollCallIntent } from "./original-intent";

const event = (): OfflineRollCallEvent => ({
  clientEventId: "event-1",
  snapshotId: "snapshot-before-reset",
  snapshotSavedAt: "2026-01-01T00:00:00.000Z",
  tripId: "trip-1",
  bookingId: "booking-1",
  checkpoint: "departure",
  status: "boarded",
  occurredAt: "2026-01-01T01:00:00.000Z",
  syncStatus: "pending",
  observedEvidenceIds: ["client:prior"],
  note: "saw at rail",
});

describe("experimental original roll-call intent", () => {
  it("keeps missing meeting, generation and actor unknown, not inferred from a current roster", () => {
    const original = event();
    const result = captureOriginalRollCallIntent("shop-a", original);
    expect(result.meetingDay).toEqual({ kind: "unknown" });
    expect(result.meetingGeneration).toEqual({ kind: "unknown" });
    expect(result.actor).toEqual({ kind: "unknown" });
    expect(result.subject).toEqual({ kind: "booking", id: "booking-1" });
    expect(result.event.snapshotId).toBe("snapshot-before-reset");
  });

  it("retains the original identity, causal IDs and text independently of later changes", () => {
    const original = event();
    original.meetingDay = 1;
    original.retractsClientEventId = "original-withdrawal";
    const result = captureOriginalRollCallIntent("shop-a", original);
    original.snapshotId = "snapshot-after-reset";
    original.bookingId = "new-booking";
    original.observedEvidenceIds?.push("client:new");
    original.note = "changed";
    expect(result.meetingDay).toEqual({ kind: "captured", day: 1 });
    expect(result.event).toMatchObject({
      snapshotId: "snapshot-before-reset",
      bookingId: "booking-1",
      observedEvidenceIds: ["client:prior"],
      retractsClientEventId: "original-withdrawal",
      note: "saw at rail",
    });
  });

  it("preserves an ambiguous subject without choosing a person", () => {
    const original = event();
    original.crewPersonId = "crew-1";
    const result = captureOriginalRollCallIntent("shop-a", original);
    expect(result.subject).toEqual({ kind: "unknown" });
    expect(result.event).toMatchObject({ bookingId: "booking-1", crewPersonId: "crew-1" });
  });

  it("keeps absent and malformed subjects and invalid days unknown", () => {
    const original = event();
    delete original.bookingId;
    original.meetingDay = -1;
    expect(captureOriginalRollCallIntent("shop-a", original).subject).toEqual({ kind: "unknown" });
    expect(captureOriginalRollCallIntent("shop-a", original).meetingDay).toEqual({
      kind: "unknown",
    });
    Object.assign(original, { bookingId: 42 });
    expect(captureOriginalRollCallIntent("shop-a", original).subject).toEqual({ kind: "unknown" });
  });

  it("keeps separate event identities and an exact withdrawal target", () => {
    const first = event();
    const second = event();
    second.clientEventId = "event-2";
    second.status = "cleared";
    second.retractsClientEventId = first.clientEventId;
    expect(captureOriginalRollCallIntent("shop-a", first).event.clientEventId).toBe("event-1");
    expect(captureOriginalRollCallIntent("shop-a", second).event).toMatchObject({
      clientEventId: "event-2",
      retractsClientEventId: "event-1",
      observedEvidenceIds: ["client:prior"],
    });
  });
});
