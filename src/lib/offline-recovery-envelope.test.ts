import { describe, expect, it } from "vitest";
import { validRecoveryEnvelope } from "./offline-recovery-envelope";

const tripId = "11111111-1111-4111-8111-111111111111";
const bookingId = "22222222-2222-4222-8222-222222222222";
const snapshotId = "33333333-3333-4333-8333-333333333333";
const at = "2026-07-21T13:30:00.000Z";
const common = { snapshotId, snapshotSavedAt: at, tripId, occurredAt: at, syncStatus: "pending" };
function copy() {
  return {
    snapshot: {
      version: 4,
      snapshotId,
      savedAt: at,
      expiresAt: at,
      shop: { slug: "blue-mantis" },
      manifests: [{ trip: { id: tripId } }],
    },
    events: [
      {
        ...common,
        clientEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        bookingId,
        checkpoint: "after_dive_1",
        status: "not_boarded",
        note: "Observed at ladder",
        observedEvidenceIds: ["server:44444444-4444-4444-8444-444444444444"],
        meetingDay: 0,
      },
    ],
    checklistEvents: [
      {
        ...common,
        clientEventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        checklistItemId: bookingId,
        status: "checked",
        note: null,
      },
    ],
    arrivalEvents: [
      {
        ...common,
        clientEventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        bookingId,
        status: "arrived",
      },
    ],
  };
}

describe("recovery envelope validation", () => {
  it("accepts three scoped queues without rewriting events", () => {
    const value = copy();
    const before = structuredClone(value);
    expect(validRecoveryEnvelope(value, "blue-mantis", tripId)).toBe(true);
    expect(value).toEqual(before);
  });

  it("keeps cross-queue ID collisions and foreign trips unresolved", () => {
    const collision = copy();
    collision.arrivalEvents[0].clientEventId = collision.events[0].clientEventId.toUpperCase();
    expect(validRecoveryEnvelope(collision, "blue-mantis", tripId)).toBe(false);
    expect(validRecoveryEnvelope(copy(), "another-shop", tripId)).toBe(false);
    const foreign = copy();
    foreign.checklistEvents[0].tripId = bookingId;
    expect(validRecoveryEnvelope(foreign, "blue-mantis", tripId)).toBe(false);
  });

  it("refuses unknown event fields, malformed status, and ambiguous subjects", () => {
    const unknown = copy();
    Object.assign(unknown.events[0], { futureEvidence: "do not discard" });
    expect(validRecoveryEnvelope(unknown, "blue-mantis", tripId)).toBe(false);
    const status = copy();
    status.arrivalEvents[0].syncStatus = "unknown";
    expect(validRecoveryEnvelope(status, "blue-mantis", tripId)).toBe(false);
    const subject = copy();
    Object.assign(subject.events[0], { crewPersonId: bookingId });
    expect(validRecoveryEnvelope(subject, "blue-mantis", tripId)).toBe(false);
  });
});
