// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureDockTap } from "./device-queue";
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
      { key: CryptoKey; iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer } | undefined
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
describe("disabled dock queue", () => {
  it("does not open storage when disabled", async () => {
    const open = vi.spyOn(indexedDB, "open");
    expect(await captureDockTap(input)).toEqual({ status: "disabled" });
    expect(open).not.toHaveBeenCalled();
  });
  it("commits a unique key and encrypted original intent before returning local retention", async () => {
    vi.mocked(dockQueueEnabled).mockReturnValue(true);
    const result = await captureDockTap(input);
    expect(result.status).toBe("retained_locally");
    if (result.status !== "retained_locally") throw new Error("capture failed");
    const stored = await row(result.eventId);
    expect(stored).toBeDefined();
    if (!stored) throw new Error("record missing");
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
    expect(await captureDockTap(input)).toEqual({ status: "not_saved" });
  });
  it("does not replace an existing event when IDs collide", async () => {
    vi.mocked(dockQueueEnabled).mockReturnValue(true);
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
    expect((await captureDockTap(input)).status).toBe("retained_locally");
    expect(await captureDockTap({ ...input, bookingId: "other-booking" })).toEqual({
      status: "not_saved",
    });
    const stored = await row("00000000-0000-4000-8000-000000000001");
    if (!stored) throw new Error("original missing");
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
      if (!stored) throw new Error("event missing");
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
    expect(await captureDockTap(input)).toEqual({ status: "not_saved" });
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
    expect(await captureDockTap({ ...input, actorId: "" })).toEqual({ status: "not_saved" });
    expect(open).not.toHaveBeenCalled();
  });
});
