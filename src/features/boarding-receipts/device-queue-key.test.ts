// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import {
  observePreparedDockTap,
  persistPreparedDockTap,
  prepareDockTapForKey,
} from "./device-queue";
import { dockQueueEnabled } from "./device-queue-gate";

vi.mock("./device-queue-gate", () => ({ dockQueueEnabled: vi.fn(() => false) }));
const input = {
  shopId: "shop-a",
  tripId: "trip-a",
  bookingId: "booking-a",
  actorId: "actor-a",
  originalMeeting: { kind: "unknown" as const },
};
const key = "00000000-0000-4000-8000-000000000001";
afterEach(async () => {
  vi.mocked(dockQueueEnabled).mockReset().mockReturnValue(false);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("diveday-dock-queue-disabled-v1");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("database remains open"));
  });
});
it("retains precisely the preselected tap key in the frozen intent and local record", async () => {
  vi.mocked(dockQueueEnabled).mockReturnValue(true);
  const attempt = prepareDockTapForKey(input, key);
  if (!attempt) throw new Error("attempt missing");
  expect(attempt.eventId).toBe(key);
  expect(JSON.parse(attempt.serialized)).toMatchObject({ eventId: key, ...input });
  expect(await persistPreparedDockTap(attempt)).toEqual({
    status: "retained_locally",
    eventId: key,
  });
  expect(await persistPreparedDockTap(attempt)).toEqual({ status: "not_confirmed", attempt });
});
it("rejects missing or noncanonical keys rather than substituting a new identity", () => {
  for (const candidate of [
    "",
    "key",
    "00000000-0000-4000-8000-000000000001 ",
    "00000000-0000-4000-8000-00000000000A",
  ]) {
    expect(prepareDockTapForKey(input, candidate)).toBeNull();
  }
});
it("preserves the first intent when a different tenant or booking reuses its key", async () => {
  vi.mocked(dockQueueEnabled).mockReturnValue(true);
  const original = prepareDockTapForKey(input, key);
  const conflicting = prepareDockTapForKey(
    { ...input, shopId: "shop-b", bookingId: "booking-b" },
    key,
  );
  if (!original || !conflicting) throw new Error("attempt missing");
  expect((await persistPreparedDockTap(original)).status).toBe("retained_locally");
  expect(await persistPreparedDockTap(conflicting)).toEqual({
    status: "not_confirmed",
    attempt: conflicting,
  });
  expect(await observePreparedDockTap(original)).toEqual({
    status: "same_attempt_observed",
    attempt: original,
  });
  expect(await observePreparedDockTap(conflicting)).toEqual({
    status: "different_or_unreadable",
    attempt: conflicting,
  });
});
it("does not write or replace a key while disabled", async () => {
  const open = vi.spyOn(indexedDB, "open");
  const attempt = prepareDockTapForKey(input, key);
  if (!attempt) throw new Error("attempt missing");
  expect(await persistPreparedDockTap(attempt)).toEqual({ status: "disabled", attempt });
  expect(open).not.toHaveBeenCalled();
  open.mockRestore();
});
