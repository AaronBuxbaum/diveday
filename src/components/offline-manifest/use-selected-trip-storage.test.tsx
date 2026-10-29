// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OfflineManifestTranslator } from "@/i18n/offline-manifest-messages";
import { appendOfflineRollCall, saveOfflineManifest } from "@/lib/offline-manifest-store";
import type { OfflineManifestEnvelope, OfflineManifestPayload } from "@/lib/offline-manifests";
import { type SelectedTripStorageState, useSelectedTripStorage } from "./use-selected-trip-storage";
import { richPayload } from "./view-fixtures";

const tripId = "11111111-1111-1111-1111-111111111111";
const bookingId = "diver-priya";
const t = ((key: string) => key) as unknown as OfflineManifestTranslator;
const tripPayload = (epoch: number): OfflineManifestPayload => ({
  ...richPayload(tripId),
  snapshotId: `snapshot-${epoch}`,
  erasureEpochToken: `${epoch}.1.${"A".repeat(43)}`,
});

afterEach(() => {
  cleanup();
  window.dispatchEvent(new Event("pagehide"));
  vi.unstubAllGlobals();
});

afterEach(
  () =>
    new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("diveday-offline-manifests");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("failed to reset IndexedDB"));
    }),
);

describe("selected-trip storage invalidation", () => {
  it("reloads the committed erasure disposition in an open trip view", async () => {
    await saveOfflineManifest(tripPayload(1));
    const before = await appendOfflineRollCall(tripId, {
      bookingId,
      checkpoint: "after_dive_1",
      status: "not_boarded",
      note: "Nora Quinn is still below.",
    });
    const state = { current: { changeRevision: 0, readRequest: 0, reload: () => {} } };

    const mounted = renderHook(() => {
      const [envelope, setEnvelope] = useState<OfflineManifestEnvelope | null>(null);
      const [read, setRead] = useState(false);
      const [message, setMessage] = useState("");
      const [, setReadFailed] = useState(false);
      const tripPurgedRef = useRef(false);
      useSelectedTripStorage({
        tripId,
        verifiedTenantRevision: 0,
        tripPurgedRef,
        storageStateRef: state as { current: SelectedTripStorageState },
        onEnvelope: setEnvelope,
        onOnline: () => {},
        setMessage,
        t,
        setStoreRead: setRead,
        setStoreReadFailed: setReadFailed,
        refreshDiscarded: () => {},
      });
      return { envelope, read, message };
    });
    await waitFor(() => expect(mounted.result.current.read).toBe(true));
    expect(mounted.result.current.envelope?.events[0]?.note).toBe("Nora Quinn is still below.");

    await act(async () => {
      await saveOfflineManifest(tripPayload(2));
    });

    await waitFor(() => expect(mounted.result.current.envelope?.events[0]?.note).toBeNull());
    expect(mounted.result.current.envelope?.events[0]).toMatchObject({
      status: "not_boarded",
      occurredAt: before.events[0]?.occurredAt,
      note: null,
      noteDisposition: "discarded_erasure_cutoff",
    });
  });

  it("sends only a trip-key invalidation to another browsing context", async () => {
    const received: unknown[] = [];
    class TestBroadcastChannel {
      static channels: TestBroadcastChannel[] = [];
      onmessage: ((event: { data: unknown }) => void) | null = null;
      constructor(readonly name: string) {
        TestBroadcastChannel.channels.push(this);
      }
      postMessage(data: unknown) {
        for (const peer of TestBroadcastChannel.channels) {
          if (peer !== this && peer.name === this.name) peer.onmessage?.({ data });
        }
      }
      close() {
        TestBroadcastChannel.channels = TestBroadcastChannel.channels.filter(
          (peer) => peer !== this,
        );
      }
    }
    vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
    const peer = new TestBroadcastChannel("diveday-offline-manifest-changes-v1");
    peer.onmessage = (event) => received.push(event.data);
    await saveOfflineManifest(tripPayload(1));
    expect(received).toEqual([{ tripId }]);
    peer.close();
  });
});
