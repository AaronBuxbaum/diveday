// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureDockTap, persistPreparedDockTap, prepareDockTap } from "./device-queue";
import { dockQueueEnabled } from "./device-queue-gate";

vi.mock("./device-queue-gate", () => ({ dockQueueEnabled: vi.fn(() => false) }));
const input = {
  shopId: "shop-a",
  tripId: "trip-old",
  bookingId: "booking-old",
  actorId: "actor-original",
  originalMeeting: { kind: "unknown" as const },
};
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(dockQueueEnabled).mockReset().mockReturnValue(false);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("diveday-dock-queue-disabled-v1");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("database remains open"));
  });
});
async function row(id: string) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("diveday-dock-queue-disabled-v1", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<
      { key: CryptoKey | null; iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer } | undefined
    >((resolve, reject) => {
      const tx = db.transaction("events", "readonly");
      const request = tx.objectStore("events").get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
async function removeTestKey(id: string) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("diveday-dock-queue-disabled-v1", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("events", "readwrite");
      const store = tx.objectStore("events");
      const get = store.get(id);
      get.onsuccess = () => store.put({ ...get.result, key: null }, id);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
describe("disabled dock queue", () => {
  it("does not open storage when disabled", async () => {
    const open = vi.spyOn(indexedDB, "open");
    expect(await captureDockTap(input)).toMatchObject({
      status: "disabled",
      attempt: { eventId: expect.any(String) },
    });
    expect(open).not.toHaveBeenCalled();
  });
  it("commits a unique key and encrypted original intent before returning local retention", async () => {
    vi.mocked(dockQueueEnabled).mockReturnValue(true);
    const result = await captureDockTap(input);
    expect(result.status).toBe("retained_locally");
    if (result.status !== "retained_locally") throw new Error("capture failed");
    const stored = await row(result.eventId);
    expect(stored).toBeDefined();
    if (!stored?.key) throw new Error("record or key missing");
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: stored.iv,
        additionalData: new TextEncoder().encode(JSON.stringify(["dock-tap-v1", result.eventId])),
      },
      stored.key,
      stored.ciphertext,
    );
    expect(JSON.parse(new TextDecoder().decode(plaintext))).toMatchObject({
      eventId: result.eventId,
      ...input,
    });
    expect(new TextDecoder().decode(stored.ciphertext)).not.toContain(input.bookingId);
  });
  it("reports failure if a write aborts after the add request succeeded", async () => {
    vi.mocked(dockQueueEnabled).mockReturnValue(true);
    const add = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      const request = add.apply(this, args);
      request.addEventListener("success", () => this.transaction.abort());
      return request;
    });
    expect(await captureDockTap(input)).toMatchObject({
      status: "not_confirmed",
      attempt: { eventId: expect.any(String) },
    });
  });
  it("does not replace an existing event when IDs collide", async () => {
    vi.mocked(dockQueueEnabled).mockReturnValue(true);
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
    expect((await captureDockTap(input)).status).toBe("retained_locally");
    expect(await captureDockTap({ ...input, bookingId: "other-booking" })).toMatchObject({
      status: "not_confirmed",
      attempt: { eventId: "00000000-0000-4000-8000-000000000001" },
    });
    const stored = await row("00000000-0000-4000-8000-000000000001");
    if (!stored?.key) throw new Error("original or key missing");
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: stored.iv,
        additionalData: new TextEncoder().encode(
          JSON.stringify(["dock-tap-v1", "00000000-0000-4000-8000-000000000001"]),
        ),
      },
      stored.key,
      stored.ciphertext,
    );
    expect(JSON.parse(new TextDecoder().decode(plaintext)).bookingId).toBe("booking-old");
  });
  it("captures the original identity before asynchronous encryption", async () => {
    vi.mocked(dockQueueEnabled).mockReturnValue(true);
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      started = resolve;
    });
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    const spy = vi.spyOn(crypto.subtle, "encrypt").mockImplementationOnce(async (...args) => {
      started();
      await gate;
      return encrypt(...args);
    });
    const original = { ...input };
    const pending = captureDockTap(original);
    try {
      await blocked;
      original.bookingId = "booking-moved";
      release();
      const result = await pending;
      if (result.status !== "retained_locally") throw new Error("capture failed");
      spy.mockRestore();
      const stored = await row(result.eventId);
      if (!stored?.key) throw new Error("event or key missing");
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: stored.iv,
          additionalData: new TextEncoder().encode(JSON.stringify(["dock-tap-v1", result.eventId])),
        },
        stored.key,
        stored.ciphertext,
      );
      expect(JSON.parse(new TextDecoder().decode(plaintext))).toMatchObject({
        bookingId: "booking-old",
        originalMeeting: { kind: "unknown" },
      });
    } finally {
      release();
      await pending;
    }
  });
  it("reports failure without a retained key when encryption fails", async () => {
    vi.mocked(dockQueueEnabled).mockReturnValue(true);
    const open = vi.spyOn(indexedDB, "open");
    vi.spyOn(crypto.subtle, "encrypt").mockRejectedValueOnce(new Error("failed"));
    expect(await captureDockTap(input)).toMatchObject({
      status: "not_saved",
      attempt: { eventId: expect.any(String) },
    });
    expect(open).not.toHaveBeenCalled();
  });
  it("retains two simultaneous taps under distinct generated keys", async () => {
    vi.mocked(dockQueueEnabled).mockReturnValue(true);
    const [first, second] = await Promise.all([
      captureDockTap(input),
      captureDockTap({ ...input, bookingId: "other-booking" }),
    ]);
    if (first.status !== "retained_locally" || second.status !== "retained_locally")
      throw new Error("captures failed");
    expect(first.eventId).not.toBe(second.eventId);
    expect(await row(first.eventId)).toBeDefined();
    expect(await row(second.eventId)).toBeDefined();
  });
  it("refuses a tap with missing identity before opening storage", async () => {
    vi.mocked(dockQueueEnabled).mockReturnValue(true);
    const open = vi.spyOn(indexedDB, "open");
    expect(await captureDockTap({ ...input, actorId: "" })).toEqual({ status: "invalid" });
    expect(open).not.toHaveBeenCalled();
  });
  it("keeps the same unsaved event and original context when a local write is retried", async () => {
    vi.mocked(dockQueueEnabled).mockReturnValue(true);
    vi.spyOn(crypto.subtle, "encrypt").mockRejectedValueOnce(new Error("unavailable"));
    const failed = await captureDockTap(input);
    if (failed.status !== "not_saved") throw new Error("expected unsaved attempt");
    const parsed = JSON.parse(failed.attempt.serialized);
    expect(parsed).toMatchObject({
      eventId: failed.attempt.eventId,
      bookingId: "booking-old",
      originalMeeting: { kind: "unknown" },
    });
    expect(Object.isFrozen(failed.attempt)).toBe(true);
    expect(await persistPreparedDockTap({ ...failed.attempt, eventId: "different" })).toEqual({
      status: "invalid",
    });
    const retried = await persistPreparedDockTap(failed.attempt);
    expect(retried).toEqual({ status: "retained_locally", eventId: failed.attempt.eventId });
  });
  it("keeps the same attempt when concurrent retries have an ambiguous outcome", async () => {
    vi.mocked(dockQueueEnabled).mockReturnValue(true);
    const attempt = prepareDockTap(input);
    if (!attempt) throw new Error("preparation failed");
    const results = await Promise.all([
      persistPreparedDockTap(attempt),
      persistPreparedDockTap(attempt),
    ]);
    expect(results.filter((item) => item.status === "retained_locally")).toHaveLength(1);
    expect(results.filter((item) => item.status === "not_confirmed")).toEqual([
      { status: "not_confirmed", attempt },
    ]);
    expect(await row(attempt.eventId)).toBeDefined();
  });
  it("observes the same encrypted record after a module reload, without claiming recovery", async () => {
    vi.mocked(dockQueueEnabled).mockReturnValue(true);
    const attempt = prepareDockTap(input);
    if (!attempt) throw new Error("preparation failed");
    expect(await persistPreparedDockTap(attempt)).toEqual({
      status: "retained_locally",
      eventId: attempt.eventId,
    });
    const before = await row(attempt.eventId);
    if (!before) throw new Error("record missing");
    vi.resetModules();
    const reopened = await import("./device-queue");
    const gate = await import("./device-queue-gate");
    vi.mocked(gate.dockQueueEnabled).mockReturnValue(true);
    const after = await row(attempt.eventId);
    if (!after?.key) throw new Error("record or key missing after reopen");
    expect(after.key.extractable).toBe(false);
    expect(new Uint8Array(after.ciphertext)).toEqual(new Uint8Array(before.ciphertext));
    expect(after.iv).toEqual(before.iv);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: after.iv,
        additionalData: new TextEncoder().encode(JSON.stringify(["dock-tap-v1", attempt.eventId])),
      },
      after.key,
      after.ciphertext,
    );
    expect(new TextDecoder().decode(plaintext)).toBe(attempt.serialized);
    expect(await reopened.persistPreparedDockTap(attempt)).toEqual({ status: "invalid" });
  });

  it("cannot restore an unsaved in-memory attempt after a module reload", async () => {
    vi.mocked(dockQueueEnabled).mockReturnValue(true);
    vi.spyOn(crypto.subtle, "encrypt").mockRejectedValueOnce(new Error("unavailable"));
    const failed = await captureDockTap(input);
    if (failed.status !== "not_saved") throw new Error("expected unsaved attempt");
    vi.resetModules();
    const reopened = await import("./device-queue");
    const gate = await import("./device-queue-gate");
    vi.mocked(gate.dockQueueEnabled).mockReturnValue(true);
    expect(await reopened.persistPreparedDockTap(failed.attempt)).toEqual({ status: "invalid" });
  });
  it("leaves an unreadable ciphertext intact when another tenant captures a tap", async () => {
    vi.mocked(dockQueueEnabled).mockReturnValue(true);
    const first = await captureDockTap(input);
    if (first.status !== "retained_locally") throw new Error("capture failed");
    const original = await row(first.eventId);
    if (!original) throw new Error("record missing");
    await removeTestKey(first.eventId);
    expect((await captureDockTap({ ...input, shopId: "shop-b" })).status).toBe("retained_locally");
    const after = await row(first.eventId);
    if (!after) throw new Error("opaque record was deleted");
    expect(after.key).toBeNull();
    expect(new Uint8Array(after.ciphertext)).toEqual(new Uint8Array(original.ciphertext));
    expect(after.iv).toEqual(original.iv);
  });
});
