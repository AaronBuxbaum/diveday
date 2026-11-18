// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { snapshot } from "@/test/substrate-fixtures/lib/offline-manifests-fixtures";
import {
  appendOfflineArrival,
  appendOfflineChecklistCheck,
  appendOfflineRollCall,
  loadOfflineManifest,
  saveOfflineManifest,
  selectOfflineRollCallDay,
} from "./offline-manifest-store";

afterEach(
  () =>
    new Promise<void>((resolve, reject) => {
      vi.restoreAllMocks();
      const request = indexedDB.deleteDatabase("diveday-offline-manifests");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }),
);

it.each(["roll_call", "arrival", "checklist", "day_selection"] as const)(
  "refuses a stale %s write rather than erase a competing tap",
  async (kind) => {
    expect(navigator.locks).toBeUndefined();
    const copy = snapshot();
    await saveOfflineManifest({
      shop: copy.shop,
      manifests: copy.manifests,
      checklist: { items: [{ id: "oxygen", label: "Oxygen" }] },
    });
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      started = resolve;
    });
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    const intercepted = vi
      .spyOn(crypto.subtle, "encrypt")
      .mockImplementationOnce(async (...args) => {
        const bytes = await encrypt(...args);
        started();
        await gate;
        return bytes;
      });
    const first =
      kind === "roll_call"
        ? appendOfflineRollCall("trip-1", {
            bookingId: "ready",
            checkpoint: "departure",
            status: "not_boarded",
            note: "first observation",
          })
        : kind === "arrival"
          ? appendOfflineArrival("trip-1", { bookingId: "ready", status: "arrived" })
          : kind === "checklist"
            ? appendOfflineChecklistCheck("trip-1", {
                checklistItemId: "oxygen",
                status: "checked",
                note: "first check",
              })
            : selectOfflineRollCallDay("trip-1", 0);
    try {
      await blocked;
      const winning = await appendOfflineRollCall("trip-1", {
        bookingId: "ready",
        checkpoint: "departure",
        status: "boarded",
      });
      const winningId = winning.events[0]?.clientEventId;
      expect(winningId).toBeDefined();
      release();
      await expect(first).rejects.toMatchObject({ code: "unavailable" });
      intercepted.mockRestore();
      expect(
        (await loadOfflineManifest("trip-1"))?.events.map((event) => event.clientEventId),
      ).toEqual([winningId]);
    } finally {
      release();
      await first.catch(() => {});
    }
  },
);
