// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as clock from "@/lib/clock";
import { OFFLINE_MANIFEST_MAX_RETENTION_MS } from "@/lib/offline-manifests";
import {
  beginLiveManifestWrite,
  captureLiveManifestFence,
  invalidateLiveManifestSession,
  invalidateLiveManifestShop,
  writeLiveManifestCache as persist,
  readLiveManifestCache,
  settleLiveManifestWrite,
} from "./cache";

beforeAll(() => {
  vi.stubGlobal("crypto", webcrypto);
});

let serial = 0;
let scope: { shop: string; trip: string; checkpoint: string; session: string };
beforeEach(() => {
  serial++;
  scope = {
    shop: `shop-${serial}`,
    trip: "trip-a",
    checkpoint: "departure",
    session: `opaque-${serial}`,
  };
});

const writeLiveManifestCache = (
  scope: Parameters<typeof persist>[0],
  fence: Parameters<typeof persist>[1],
  value: unknown,
) => persist(scope, fence, value, clock.nowMs() + OFFLINE_MANIFEST_MAX_RETENTION_MS);

async function corrupt(key: string, value: unknown) {
  const opened = indexedDB.open("diveday-live-manifest-cache", 1);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    opened.onsuccess = () => resolve(opened.result);
    opened.onerror = () => reject(opened.error);
  });
  try {
    const tx = db.transaction("records", "readwrite");
    tx.objectStore("records").put(value, key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function raw(key: string): Promise<unknown> {
  const opened = indexedDB.open("diveday-live-manifest-cache", 1);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    opened.onsuccess = () => resolve(opened.result);
    opened.onerror = () => reject(opened.error);
  });
  try {
    const result = db.transaction("records", "readonly").objectStore("records").get(key);
    return await new Promise((resolve, reject) => {
      result.onsuccess = () => resolve(result.result);
      result.onerror = () => reject(result.error);
    });
  } finally {
    db.close();
  }
}

describe("live manifest cache fencing", () => {
  it("reads only a projection stored under the exact scope and fence", async () => {
    const fence = await captureLiveManifestFence(scope);
    expect(await writeLiveManifestCache(scope, fence, { roster: ["Nora"] })).toBe(true);
    expect(await readLiveManifestCache(scope)).toEqual({
      view: { roster: ["Nora"] },
      pendingWrites: false,
      changedSinceCache: false,
    });
    expect(await readLiveManifestCache({ ...scope, session: "opaque-b" })).toBeNull();
    expect(await readLiveManifestCache({ ...scope, trip: "trip-b" })).toBeNull();
  });

  it("refuses an old request after session invalidation", async () => {
    const fence = await captureLiveManifestFence(scope);
    await invalidateLiveManifestSession(scope.session);
    expect(await writeLiveManifestCache(scope, fence, { roster: ["old"] })).toBe(false);
    expect(await readLiveManifestCache(scope)).toBeNull();
    await expect(captureLiveManifestFence(scope)).rejects.toThrow(
      "live-manifest-cache-invalidated",
    );
  });

  it("does not let an older request overwrite a newer response", async () => {
    const older = await captureLiveManifestFence(scope);
    const newer = await captureLiveManifestFence(scope);
    expect(await writeLiveManifestCache(scope, newer, { roster: ["new"] })).toBe(true);
    expect(await writeLiveManifestCache(scope, older, { roster: ["old"] })).toBe(false);
    expect(await readLiveManifestCache(scope)).toEqual({
      view: { roster: ["new"] },
      pendingWrites: false,
      changedSinceCache: false,
    });
  });

  it("refuses an expired copy", async () => {
    const now = clock.nowMs();
    const mockedClock = vi.spyOn(clock, "nowMs").mockReturnValue(now);
    try {
      const fence = await captureLiveManifestFence(scope);
      expect(await writeLiveManifestCache(scope, fence, { roster: ["Nora"] })).toBe(true);
      const recordKey = JSON.stringify([
        "projection",
        scope.shop,
        scope.trip,
        scope.checkpoint,
        scope.session,
      ]);
      expect(await raw(recordKey)).toBeDefined();
      mockedClock.mockReturnValue(now + OFFLINE_MANIFEST_MAX_RETENTION_MS);
      await captureLiveManifestFence({ ...scope, trip: "another-trip" });
      expect(await raw(recordKey)).toBeUndefined();
      expect(await readLiveManifestCache(scope)).toBeNull();
    } finally {
      mockedClock.mockRestore();
    }
  });

  it("keeps a write barrier through uncertainty and requires a new read after settlement", async () => {
    const old = await captureLiveManifestFence(scope);
    expect(await writeLiveManifestCache(scope, old, { roster: ["cached"] })).toBe(true);
    const operation = await beginLiveManifestWrite(scope);
    expect(await readLiveManifestCache(scope)).toEqual({
      view: { roster: ["cached"] },
      pendingWrites: true,
      changedSinceCache: true,
    });
    expect(await writeLiveManifestCache(scope, old, { roster: ["old"] })).toBe(false);
    const during = await captureLiveManifestFence(scope);
    expect(await writeLiveManifestCache(scope, during, { roster: ["uncertain"] })).toBe(false);
    expect(await settleLiveManifestWrite(scope, "not-the-operation")).toBe(false);
    expect(await writeLiveManifestCache(scope, during, { roster: ["uncertain"] })).toBe(false);
    expect(await settleLiveManifestWrite(scope, operation)).toBe(true);
    expect(await readLiveManifestCache(scope)).toEqual({
      view: { roster: ["cached"] },
      pendingWrites: false,
      changedSinceCache: true,
    });
    expect(await writeLiveManifestCache(scope, during, { roster: ["stale"] })).toBe(false);
    const after = await captureLiveManifestFence(scope);
    expect(await writeLiveManifestCache(scope, after, { roster: ["confirmed"] })).toBe(true);
  });

  it.each([null, false, 0, ""])("fails closed for corrupt write metadata %s", async (value) => {
    await captureLiveManifestFence(scope);
    await corrupt(JSON.stringify(["writes", scope.shop, scope.trip]), value);
    await expect(beginLiveManifestWrite(scope)).rejects.toThrow(
      "live-manifest-cache-invalid-writes",
    );
    await expect(captureLiveManifestFence(scope)).rejects.toThrow(
      "live-manifest-cache-invalid-writes",
    );
  });

  it.each([null, false, 0, ""])("fails closed for corrupt shop metadata %s", async (value) => {
    await captureLiveManifestFence(scope);
    await corrupt(JSON.stringify(["shop", scope.shop]), value);
    await expect(captureLiveManifestFence(scope)).rejects.toThrow(
      "live-manifest-cache-invalid-fence",
    );
  });

  it("refuses an expired or overly long requested retention", async () => {
    const fence = await captureLiveManifestFence(scope);
    const now = clock.nowMs();
    expect(await persist(scope, fence, { roster: [] }, now)).toBe(false);
    expect(
      await persist(scope, fence, { roster: [] }, now + OFFLINE_MANIFEST_MAX_RETENTION_MS + 1000),
    ).toBe(false);
  });

  it("prunes a malformed far-future projection in bounded passes", async () => {
    await captureLiveManifestFence(scope);
    const key = JSON.stringify([
      "projection",
      scope.shop,
      scope.trip,
      scope.checkpoint,
      scope.session,
    ]);
    await corrupt(key, {
      createdAt: clock.nowMs(),
      expiresAt: clock.nowMs() + 2 * OFFLINE_MANIFEST_MAX_RETENTION_MS,
    });
    for (let index = 0; index < 10 && (await raw(key)) !== undefined; index++) {
      await captureLiveManifestFence(scope);
    }
    expect(await raw(key)).toBeUndefined();
  });

  it("resumes pruning after a batch of unrelated metadata", async () => {
    await captureLiveManifestFence(scope);
    const key = JSON.stringify([
      "projection",
      scope.shop,
      scope.trip,
      scope.checkpoint,
      scope.session,
    ]);
    await corrupt(key, { createdAt: 0, expiresAt: 1 });
    for (let index = 0; index < 70; index++)
      await corrupt(`000-metadata-${String(index).padStart(3, "0")}`, true);
    await corrupt("prune-cursor-v1", "");
    await captureLiveManifestFence(scope);
    expect(await raw(key)).toBeDefined();
    for (let index = 0; index < 10 && (await raw(key)) !== undefined; index++)
      await captureLiveManifestFence(scope);
    expect(await raw(key)).toBeUndefined();
  });

  it("invalidates all shop projections without deleting another shop", async () => {
    const other = { ...scope, shop: "shop-b" };
    const first = await captureLiveManifestFence(scope);
    const second = await captureLiveManifestFence(other);
    await writeLiveManifestCache(scope, first, { roster: ["old"] });
    await writeLiveManifestCache(other, second, { roster: ["other"] });
    await invalidateLiveManifestShop(scope.shop);
    expect(await readLiveManifestCache(scope)).toBeNull();
    expect(await readLiveManifestCache(other)).toEqual({
      view: { roster: ["other"] },
      pendingWrites: false,
      changedSinceCache: false,
    });
    expect(await writeLiveManifestCache(scope, first, { roster: ["old"] })).toBe(false);
  });
});
