// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import {
  forgetReturningDiver,
  getOrCreateReturningDiverDeviceToken,
  getReturningDiverDeviceSlots,
  loadReturningDiver,
  MAX_RETURNING_DIVER_DEVICE_SLOTS,
  RETURNING_DIVER_DEVICE_SLOT_MS,
  RETURNING_DIVER_MEMORY_MS,
  saveReturningDiver,
  snapshotReturningDiverClearGenerations,
  subscribeToReturningDiverClears,
} from "./returning-diver";

const NOW = new Date("2026-10-28T12:00:00.000Z");
const diver = { fullName: "Marco Reyes", email: "marco@example.com" };
const receiptIds = {
  bookingA: "00000000-0000-4000-8000-000000000001",
  bookingB: "00000000-0000-4000-8000-000000000002",
  old: "00000000-0000-4000-8000-000000000003",
  newer: "00000000-0000-4000-8000-000000000004",
  inFlight: "00000000-0000-4000-8000-000000000005",
  quota: "00000000-0000-4000-8000-000000000006",
  deletion: "00000000-0000-4000-8000-000000000007",
} as const;
const memoryKey = (shopSlug: string, receiptId = "manual") =>
  `diveday:returning-diver:v2:${shopSlug}:${receiptId}`;
const storedMemory = (shopSlug: string) => {
  const prefix = `diveday:returning-diver:v2:${shopSlug}:`;
  const key = Array.from({ length: localStorage.length }, (_, index) =>
    localStorage.key(index),
  ).find((candidate) => candidate?.startsWith(prefix));
  return key ? localStorage.getItem(key) : null;
};
const storedMemoryCount = (shopSlug: string) => {
  const prefix = `diveday:returning-diver:v2:${shopSlug}:`;
  return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(
    (key) => key?.startsWith(prefix),
  ).length;
};

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe("opted-in returning-diver memory", () => {
  it("saves only when the caller explicitly asks, scoped to one shop", () => {
    const expiresAt = NOW.getTime() + RETURNING_DIVER_MEMORY_MS;
    expect(loadReturningDiver("blue-mantis", NOW)).toBeNull();

    saveReturningDiver("blue-mantis", diver, expiresAt, NOW);

    expect(loadReturningDiver("blue-mantis", NOW)).toEqual(diver);
    expect(loadReturningDiver("red-reef", NOW)).toBeNull();
  });

  it("expires at the 30-day boundary and removes the stored personal data", () => {
    const expiresAt = NOW.getTime() + RETURNING_DIVER_MEMORY_MS;
    saveReturningDiver("blue-mantis", diver, expiresAt, NOW);

    expect(loadReturningDiver("blue-mantis", new Date(expiresAt - 1))).toEqual(diver);
    expect(loadReturningDiver("blue-mantis", new Date(expiresAt))).toBeNull();
    expect(storedMemory("blue-mantis")).toBeNull();
  });

  it("purges expired entries for other shops whenever a shop memory is read", () => {
    const expiresAt = NOW.getTime() + RETURNING_DIVER_MEMORY_MS;
    saveReturningDiver("blue-mantis", diver, expiresAt, NOW);
    localStorage.setItem(
      memoryKey("red-reef"),
      JSON.stringify({
        fullName: "Priya Shah",
        email: "priya@example.com",
        expiresAt: NOW.getTime(),
      }),
    );

    expect(loadReturningDiver("blue-mantis", NOW)).toEqual(diver);
    expect(storedMemory("red-reef")).toBeNull();
  });

  it("purges expired entries for other shops whenever a shop memory is written", () => {
    localStorage.setItem(
      memoryKey("red-reef"),
      JSON.stringify({
        fullName: "Priya Shah",
        email: "priya@example.com",
        expiresAt: NOW.getTime(),
      }),
    );

    saveReturningDiver("blue-mantis", diver, NOW.getTime() + RETURNING_DIVER_MEMORY_MS, NOW);

    expect(storedMemory("red-reef")).toBeNull();
    expect(loadReturningDiver("blue-mantis", NOW)).toEqual(diver);
  });

  it("bounds stored shop memories and keeps the most recent shop write", () => {
    for (let index = 0; index < 40; index += 1) {
      const shopSlug = `shop-${index}`;
      saveReturningDiver(
        shopSlug,
        { fullName: `Diver ${index}`, email: `diver-${index}@example.com` },
        NOW.getTime() + RETURNING_DIVER_MEMORY_MS + index,
        NOW,
      );
    }
    const memoryCount = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index),
    ).filter((key) => key?.startsWith("diveday:returning-diver:v2:")).length;

    expect(memoryCount).toBeLessThanOrEqual(32);
    expect(loadReturningDiver("shop-39", NOW)).toEqual({
      fullName: "Diver 39",
      email: "diver-39@example.com",
    });
  });

  it("does not write blank or already-expired data", () => {
    const expiresAt = NOW.getTime() + RETURNING_DIVER_MEMORY_MS;
    saveReturningDiver("blue-mantis", { ...diver, fullName: " " }, expiresAt, NOW);
    saveReturningDiver("blue-mantis", { ...diver, email: "" }, expiresAt, NOW);
    saveReturningDiver("blue-mantis", diver, NOW.getTime(), NOW);
    expect(loadReturningDiver("blue-mantis", NOW)).toBeNull();
  });

  it("keeps a newer booking when an older receipt is retried later", () => {
    const generation = snapshotReturningDiverClearGenerations()?.["blue-mantis"] ?? null;
    const newerExpiry = NOW.getTime() + RETURNING_DIVER_MEMORY_MS;
    const olderExpiry = newerExpiry - 60_000;
    saveReturningDiver(
      "blue-mantis",
      { fullName: "Priya Shah", email: "priya@example.com" },
      newerExpiry,
      NOW,
      { id: receiptIds.bookingB, order: "22", generationAtStart: generation },
    );

    // Simulate booking A's delayed response after booking B already saved.
    expect(
      saveReturningDiver(
        "blue-mantis",
        diver,
        olderExpiry,
        new Date(NOW.getTime() + 10 * 86_400_000),
        {
          id: receiptIds.bookingA,
          order: "21",
          generationAtStart: generation,
        },
      ),
    ).toBe("saved");
    expect(loadReturningDiver("blue-mantis", NOW)).toEqual({
      fullName: "Priya Shah",
      email: "priya@example.com",
    });
    expect(JSON.parse(storedMemory("blue-mantis") ?? "{}").receiptId).toBe(receiptIds.bookingB);
    expect(storedMemoryCount("blue-mantis")).toBe(1);
  });

  it("selects the newest receipt when tabs finish storage writes out of order", () => {
    const generation = snapshotReturningDiverClearGenerations()?.["blue-mantis"] ?? null;
    const expiresAt = NOW.getTime() + RETURNING_DIVER_MEMORY_MS;
    localStorage.setItem(
      memoryKey("blue-mantis", receiptIds.newer),
      JSON.stringify({
        fullName: "Priya Shah",
        email: "priya@example.com",
        expiresAt,
        clearGeneration: generation,
        receiptId: receiptIds.newer,
        receiptOrder: "102",
      }),
    );
    localStorage.setItem(
      memoryKey("blue-mantis", receiptIds.old),
      JSON.stringify({
        ...diver,
        expiresAt,
        clearGeneration: generation,
        receiptId: receiptIds.old,
        receiptOrder: "101",
      }),
    );

    expect(loadReturningDiver("blue-mantis", NOW)).toEqual({
      fullName: "Priya Shah",
      email: "priya@example.com",
    });
    expect(storedMemoryCount("blue-mantis")).toBe(1);
  });

  it("clears only the current shop when the diver says it is not them", () => {
    const expiresAt = NOW.getTime() + RETURNING_DIVER_MEMORY_MS;
    saveReturningDiver("blue-mantis", diver, expiresAt, NOW);
    saveReturningDiver(
      "red-reef",
      { fullName: "Priya Shah", email: "priya@example.com" },
      expiresAt,
      NOW,
    );

    forgetReturningDiver("blue-mantis");

    expect(loadReturningDiver("blue-mantis", NOW)).toBeNull();
    expect(loadReturningDiver("red-reef", NOW)).toEqual({
      fullName: "Priya Shah",
      email: "priya@example.com",
    });
  });

  it("keeps a cleared receipt fenced despite clock skew and accepts a later opt-in", () => {
    const initialGeneration = snapshotReturningDiverClearGenerations()?.["blue-mantis"] ?? null;
    const oldReceipt = { id: receiptIds.old, order: "30", generationAtStart: initialGeneration };
    const expiry = new Date("2050-01-01T00:00:00Z").getTime();
    saveReturningDiver("blue-mantis", diver, expiry, NOW, oldReceipt);
    expect(forgetReturningDiver("blue-mantis")).toBe("cleared");

    const skewedDeviceTime = new Date("2040-01-01T00:00:00Z");
    expect(saveReturningDiver("blue-mantis", diver, expiry, skewedDeviceTime, oldReceipt)).toBe(
      "cleared",
    );
    expect(loadReturningDiver("blue-mantis", skewedDeviceTime)).toBeNull();
    const generation = snapshotReturningDiverClearGenerations()?.["blue-mantis"] ?? null;
    expect(generation).toBeTruthy();
    expect(
      saveReturningDiver(
        "blue-mantis",
        { ...diver, fullName: "New opt-in" },
        expiry,
        skewedDeviceTime,
        { id: receiptIds.newer, order: "31", generationAtStart: generation },
      ),
    ).toBe("saved");
    expect(loadReturningDiver("blue-mantis", skewedDeviceTime)).toEqual({
      ...diver,
      fullName: "New opt-in",
    });
  });

  it("ignores a delayed cloned-tab clear event after a fresh opt-in slot is created", () => {
    const oldGeneration = snapshotReturningDiverClearGenerations()?.["blue-mantis"] ?? null;
    const staleExpiry = nowDate().getTime() + 1_000;
    const oldToken = getOrCreateReturningDiverDeviceToken("blue-mantis");
    expect(oldToken).toBeTruthy();
    expect(forgetReturningDiver("blue-mantis")).toBe("cleared");

    const freshToken = getOrCreateReturningDiverDeviceToken("blue-mantis");
    expect(freshToken).toBeTruthy();
    expect(freshToken).not.toBe(oldToken);
    const onClear = vi.fn();
    const unsubscribe = subscribeToReturningDiverClears(onClear);
    const clearState = JSON.parse(
      localStorage.getItem("diveday:returning-diver:clear:v2:blue-mantis") ?? "{}",
    ) as { generation?: string; expiresAt?: number };
    window.dispatchEvent(
      new CustomEvent("diveday:returning-diver:cleared", {
        detail: {
          shopSlug: "blue-mantis",
          generation: oldGeneration ?? "00000000-0000-4000-8000-000000000099",
          expiresAt: staleExpiry,
          deviceToken: oldToken,
        },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("diveday:returning-diver:cleared", {
        detail: {
          shopSlug: "blue-mantis",
          generation: clearState.generation,
          expiresAt: clearState.expiresAt,
          deviceToken: oldToken,
        },
      }),
    );
    unsubscribe();

    expect(onClear).toHaveBeenCalledWith(expect.objectContaining({ deviceToken: oldToken }));
    expect(getReturningDiverDeviceSlots()).toEqual([
      expect.objectContaining({ token: freshToken }),
    ]);
  });

  it("rechecks the clear marker after a concurrent write and removes only that receipt", () => {
    const key = memoryKey("blue-mantis", receiptIds.inFlight);
    const initialGeneration = snapshotReturningDiverClearGenerations()?.["blue-mantis"] ?? null;
    const receipt = { id: receiptIds.inFlight, order: "32", generationAtStart: initialGeneration };
    saveReturningDiver("blue-mantis", diver, NOW.getTime() + 1000, NOW, receipt);
    const originalSetItem = Storage.prototype.setItem;
    let clearedDuringWrite = false;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      name: string,
      value: string,
    ) {
      if (name === key && !clearedDuringWrite) {
        clearedDuringWrite = true;
        forgetReturningDiver("blue-mantis");
      }
      return originalSetItem.call(this, name, value);
    });

    expect(
      saveReturningDiver("blue-mantis", diver, NOW.getTime() + 1000, NOW, {
        ...receipt,
      }),
    ).toBe("cleared");
    expect(loadReturningDiver("blue-mantis", new Date(NOW.getTime() + 2))).toBeNull();
  });

  it("removes identity even when tombstone persistence fails", () => {
    const initialGeneration = snapshotReturningDiverClearGenerations()?.["blue-mantis"] ?? null;
    saveReturningDiver("blue-mantis", diver, NOW.getTime() + RETURNING_DIVER_MEMORY_MS, NOW, {
      id: receiptIds.quota,
      order: "33",
      generationAtStart: initialGeneration,
    });
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === "diveday:returning-diver:clear:v2:blue-mantis") {
        throw new Error("quota exceeded");
      }
      return originalSetItem.call(this, key, value);
    });

    expect(forgetReturningDiver("blue-mantis")).toBe("partial");
    expect(storedMemory("blue-mantis")).toBeNull();
    expect(loadReturningDiver("blue-mantis", NOW)).toBeNull();
  });

  it("reports partial clear when browser storage refuses identity deletion", () => {
    const initialGeneration = snapshotReturningDiverClearGenerations()?.["blue-mantis"] ?? null;
    saveReturningDiver("blue-mantis", diver, NOW.getTime() + RETURNING_DIVER_MEMORY_MS, NOW, {
      id: receiptIds.deletion,
      order: "34",
      generationAtStart: initialGeneration,
    });
    const originalRemoveItem = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      if (key === memoryKey("blue-mantis", receiptIds.deletion)) {
        throw new Error("storage refused deletion");
      }
      return originalRemoveItem.call(this, key);
    });

    expect(forgetReturningDiver("blue-mantis")).toBe("partial");
    expect(storedMemory("blue-mantis")).toContain("Marco Reyes");
  });

  it("bounds persisted clear fences and reports partial completion at the cap", () => {
    for (let index = 0; index < 32; index += 1) {
      expect(forgetReturningDiver(`shop-${index}`)).toBe("cleared");
    }
    expect(forgetReturningDiver("shop-32")).toBe("partial");
    const markerCount = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index),
    ).filter((key) => key?.startsWith("diveday:returning-diver:clear:v2:")).length;
    expect(markerCount).toBeLessThanOrEqual(32);
  });

  it("expires clear fences with the tab slot lifetime", () => {
    const now = nowDate().getTime();
    expect(forgetReturningDiver("blue-mantis")).toBe("cleared");
    const state = JSON.parse(
      localStorage.getItem("diveday:returning-diver:clear:v2:blue-mantis") ?? "{}",
    ) as { expiresAt?: number };
    expect(state.expiresAt).toBe(now + RETURNING_DIVER_DEVICE_SLOT_MS);
  });

  it("prunes expired tab slots before enforcing the active slot cap", () => {
    for (let index = 0; index < MAX_RETURNING_DIVER_DEVICE_SLOTS; index += 1) {
      sessionStorage.setItem(
        `diveday:returning-diver:device:v1:shop-${index}`,
        JSON.stringify({ token: "a".repeat(64), expiresAt: NOW.getTime() - 1 }),
      );
    }

    const token = getOrCreateReturningDiverDeviceToken("shop-new", NOW);

    expect(token).toMatch(/^[A-Za-z0-9_-]{40,128}$/);
    expect(sessionStorage.length).toBe(1);
  });

  it("deletes the old unscoped v1 value without migrating it", () => {
    localStorage.setItem("diveday:returning-diver:v1", JSON.stringify(diver));

    expect(loadReturningDiver("blue-mantis", NOW)).toBeNull();
    expect(localStorage.getItem("diveday:returning-diver:v1")).toBeNull();
  });

  it("ignores malformed scoped data and removes it", () => {
    localStorage.setItem(memoryKey("blue-mantis"), "not json");

    expect(loadReturningDiver("blue-mantis", NOW)).toBeNull();
    expect(storedMemory("blue-mantis")).toBeNull();
  });

  it("treats unavailable storage as an optional convenience", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    expect(saveReturningDiver("blue-mantis", diver, NOW.getTime() + 1000, NOW)).toBe("unavailable");
    expect(() => loadReturningDiver("blue-mantis", NOW)).not.toThrow();
    expect(() => forgetReturningDiver("blue-mantis")).not.toThrow();
  });
});
