import { expect, it } from "vitest";
import { latestOfflineRollCall, type OfflineRollCallEvent } from "@/lib/offline-manifests";
import { identifySavedRollCall } from "./identified-offline-roll-call";
import { snapshot } from "./substrate-fixtures/lib/offline-manifests-fixtures";

function savedAboard() {
  const copy = snapshot();
  const row = copy.manifests
    .find((item) => item.checkpoint === "after_dive_1")
    ?.divers.find((item) => item.bookingId === "ready");
  if (!row) throw new Error("fixture subject missing");
  const mark = { state: "boarded" as const, occurredAt: copy.savedAt, recordedByName: "Crew" };
  row.rollCall = mark;
  return { copy, row, mark };
}

it("preserves an explicitly retained client identity and this device's exact undo ownership", () => {
  const { copy, mark } = savedAboard();
  Object.assign(mark, {
    clientEventId: "event-1",
    eventId: "10000000-0000-4000-8000-000000000001",
  });
  expect(identifySavedRollCall(copy, { bookingId: "ready" }, "after_dive_1", 0)).toBe(
    "client:event-1",
  );
  copy.erasureEpochToken = `3.9.${"a".repeat(43)}`;
  const own: OfflineRollCallEvent = {
    clientEventId: "event-1",
    snapshotId: copy.snapshotId,
    snapshotSavedAt: copy.savedAt,
    tripId: "trip-1",
    bookingId: "ready",
    checkpoint: "after_dive_1",
    status: "boarded",
    occurredAt: copy.savedAt,
    syncStatus: "applied",
    syncedAtRevision: 9,
  };
  expect(latestOfflineRollCall(copy, [own], "ready", "after_dive_1")).toMatchObject({
    state: "boarded",
    local: true,
    clientEventId: "event-1",
    pending: false,
  });
});

it("uses an actual retained server event identity when no client identity exists", () => {
  const { copy, mark } = savedAboard();
  Object.assign(mark, { eventId: "10000000-0000-4000-8000-000000000002" });
  expect(identifySavedRollCall(copy, { bookingId: "ready" }, "after_dive_1", 0)).toBe(
    "server:10000000-0000-4000-8000-000000000002",
  );
});

it("retains an already identified statement without replacing its observations", () => {
  const { copy, row } = savedAboard();
  const id = identifySavedRollCall(copy, { bookingId: "ready" }, "after_dive_1", 0);
  const context = row.rollCallContext;
  if (!context) throw new Error("fixture context missing");
  expect(id).toMatch(/^server:[0-9a-f-]{36}$/);
  context.evidence[0].observedEvidenceIds = ["client:prior"];
  const original = structuredClone(row.rollCallContext);
  expect(identifySavedRollCall(copy, { bookingId: "ready" }, "after_dive_1", 0)).toBe(id);
  expect(row.rollCallContext).toEqual(original);
});

it("refuses to replace conflicting saved evidence with one newly identified statement", () => {
  const { copy, row } = savedAboard();
  identifySavedRollCall(copy, { bookingId: "ready" }, "after_dive_1", 0);
  const context = row.rollCallContext;
  if (!context) throw new Error("fixture context missing");
  context.conflict = true;
  const original = structuredClone(row.rollCallContext);
  expect(() => identifySavedRollCall(copy, { bookingId: "ready" }, "after_dive_1", 0)).toThrow(
    "cannot replace ambiguous",
  );
  expect(row.rollCallContext).toEqual(original);
});
