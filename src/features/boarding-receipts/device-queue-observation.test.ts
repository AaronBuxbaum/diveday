// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { observePreparedDockTap, persistPreparedDockTap, prepareDockTap } from "./device-queue";
import { dockQueueEnabled } from "./device-queue-gate";

vi.mock("./device-queue-gate", () => ({ dockQueueEnabled: vi.fn(() => false) }));
const input = {
  shopId: "shop-a",
  tripId: "trip-1",
  bookingId: "booking-1",
  actorId: "actor-1",
  originalMeeting: { kind: "unknown" as const },
};
const dbName = "diveday-dock-queue-disabled-v1";
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(dockQueueEnabled).mockReset().mockReturnValue(false);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("database remains open"));
  });
});
type StoredRow = { key: CryptoKey | null; iv: Uint8Array; ciphertext: ArrayBuffer };
async function mutate(id: string, action: (value: StoredRow, store: IDBObjectStore) => void) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("events", "readwrite");
      const store = tx.objectStore("events");
      const get = store.get(id);
      get.onsuccess = () => action(get.result, store);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
it("does not open storage when disabled or accept a forged attempt", async () => {
  const attempt = prepareDockTap(input);
  if (!attempt) throw new Error("no attempt");
  const open = vi.spyOn(indexedDB, "open");
  expect(await observePreparedDockTap(attempt)).toEqual({ status: "disabled", attempt });
  expect(open).not.toHaveBeenCalled();
  vi.mocked(dockQueueEnabled).mockReturnValue(true);
  expect(await observePreparedDockTap({ ...attempt })).toEqual({ status: "invalid" });
  expect(open).not.toHaveBeenCalled();
});
it("does not create storage for an absent observation", async () => {
  vi.mocked(dockQueueEnabled).mockReturnValue(true);
  const attempt = prepareDockTap(input);
  if (!attempt) throw new Error("no attempt");
  expect(await observePreparedDockTap(attempt)).toEqual({
    status: "absent_or_unavailable",
    attempt,
  });
  expect((await indexedDB.databases()).some((db) => db.name === dbName)).toBe(false);
});
it("reports a same-attempt observation only while retaining the original attempt", async () => {
  vi.mocked(dockQueueEnabled).mockReturnValue(true);
  const attempt = prepareDockTap(input);
  if (!attempt) throw new Error("no attempt");
  expect((await persistPreparedDockTap(attempt)).status).toBe("retained_locally");
  expect(await persistPreparedDockTap(attempt)).toEqual({ status: "not_confirmed", attempt });
  expect(await observePreparedDockTap(attempt)).toEqual({
    status: "same_attempt_observed",
    attempt,
  });
});
it("does not treat a different tenant or booking under the same key as the same attempt", async () => {
  vi.mocked(dockQueueEnabled).mockReturnValue(true);
  vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
  const original = prepareDockTap(input);
  const other = prepareDockTap({ ...input, shopId: "other-shop", bookingId: "other-booking" });
  if (!original || !other) throw new Error("no attempt");
  expect((await persistPreparedDockTap(original)).status).toBe("retained_locally");
  expect(await observePreparedDockTap(other)).toEqual({
    status: "different_or_unreadable",
    attempt: other,
  });
  expect(await observePreparedDockTap(original)).toEqual({
    status: "same_attempt_observed",
    attempt: original,
  });
});
it("does not rewrite or delete ciphertext when its stored key is missing", async () => {
  vi.mocked(dockQueueEnabled).mockReturnValue(true);
  const attempt = prepareDockTap(input);
  if (!attempt) throw new Error("no attempt");
  expect((await persistPreparedDockTap(attempt)).status).toBe("retained_locally");
  let original = new Uint8Array();
  await mutate(attempt.eventId, (value, store) => {
    original = new Uint8Array(value.ciphertext);
    store.put({ ...value, key: null }, attempt.eventId);
  });
  expect(await observePreparedDockTap(attempt)).toEqual({
    status: "different_or_unreadable",
    attempt,
  });
  await mutate(attempt.eventId, (value) => {
    expect(value.key).toBeNull();
    expect(new Uint8Array(value.ciphertext)).toEqual(original);
  });
});
it("labels a match historical even when the row is deleted after its read", async () => {
  vi.mocked(dockQueueEnabled).mockReturnValue(true);
  const attempt = prepareDockTap(input);
  if (!attempt) throw new Error("no attempt");
  expect((await persistPreparedDockTap(attempt)).status).toBe("retained_locally");
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    started = resolve;
  });
  const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, "decrypt").mockImplementationOnce(async (...args) => {
    started();
    await gate;
    return decrypt(...args);
  });
  const observed = observePreparedDockTap(attempt);
  try {
    await blocked;
    await mutate(attempt.eventId, (_value, store) => {
      store.delete(attempt.eventId);
    });
    release();
    expect(await observed).toEqual({ status: "same_attempt_observed", attempt });
  } finally {
    release();
    await observed;
  }
  expect(await observePreparedDockTap(attempt)).toEqual({
    status: "absent_or_unavailable",
    attempt,
  });
});
