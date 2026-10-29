// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OfflineManifestTranslator } from "@/i18n/offline-manifest-messages";
import type { RollCallCheckpoint } from "@/lib/manifests";
import { appendOfflineRollCall, saveOfflineManifest } from "@/lib/offline-manifest-store";
import type { OfflineManifestEnvelope, OfflineManifestPayload } from "@/lib/offline-manifests";
import { useSelectedTripEnvelopeHandler } from "./selected-trip-envelope";
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
    TestBroadcastChannel.channels = TestBroadcastChannel.channels.filter((peer) => peer !== this);
  }
}

function suppressSameDocumentManifestEvent() {
  const dispatch = window.dispatchEvent.bind(window);
  const spy = vi
    .spyOn(window, "dispatchEvent")
    .mockImplementation((event) =>
      event.type === "diveday-offline-manifest-change" ? true : dispatch(event),
    );
  return () => spy.mockRestore();
}

afterEach(() => {
  cleanup();
  window.dispatchEvent(new Event("pagehide"));
  TestBroadcastChannel.channels = [];
  vi.restoreAllMocks();
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
  it("does not start another sync when a sync write invalidates the selected-trip envelope", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
    await saveOfflineManifest(tripPayload(1));
    const reconcile = vi.fn(async () => {});
    const envelopes: Array<OfflineManifestEnvelope | null> = [];
    const state = { current: { changeRevision: 0, readRequest: 0, reload: () => {} } };

    const mounted = renderHook(() => {
      const [message, setMessage] = useState("");
      const [read, setRead] = useState(false);
      const [, setReadFailed] = useState(false);
      const [checkpoint, setCheckpoint] = useState<RollCallCheckpoint>("departure");
      const tripPurgedRef = useRef(false);
      const verifiedTenantSlugRef = useRef<string | null>("blue-mantis");
      const handleEnvelope = useSelectedTripEnvelopeHandler({
        tripId,
        verifiedTenantSlugRef,
        dispatchSaved: () => {},
        setCheckpoint,
        tripNoticeForEnvelope: () => "",
        tripPurgedRef,
        setMessage,
        t,
      });
      useSelectedTripStorage({
        tripId,
        verifiedTenantRevision: 0,
        tripPurgedRef,
        storageStateRef: state as { current: SelectedTripStorageState },
        onEnvelope: (saved) => {
          envelopes.push(saved);
          handleEnvelope(saved);
        },
        onReadStarted: () => {},
        onOnline: reconcile,
        setMessage,
        t,
        setStoreRead: setRead,
        setStoreReadFailed: setReadFailed,
        refreshDiscarded: () => {},
      });
      return { checkpoint, message, read };
    });

    await waitFor(() => expect(mounted.result.current.read).toBe(true));
    await waitFor(() => expect(envelopes.length).toBeGreaterThan(0));
    await waitFor(() => expect(reconcile).toHaveBeenCalled());
    const syncRequestsBeforeInvalidation = reconcile.mock.calls.length;

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("diveday-offline-manifest-change", { detail: { tripId } }),
      );
    });
    await waitFor(() => expect(envelopes.length).toBeGreaterThan(1));

    expect(reconcile).toHaveBeenCalledTimes(syncRequestsBeforeInvalidation);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() =>
      expect(reconcile).toHaveBeenCalledTimes(syncRequestsBeforeInvalidation + 1),
    );
  });

  it("reloads the committed erasure disposition in an open trip view", async () => {
    vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
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
        onReadStarted: () => {},
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

    const restoreLocalEvent = suppressSameDocumentManifestEvent();
    try {
      await act(async () => {
        // A worker has no window event to dispatch; the shared channel reaches
        // this mounted page after the IDB write commits.
        await saveOfflineManifest(tripPayload(2));
      });
    } finally {
      restoreLocalEvent();
    }

    await waitFor(() => expect(mounted.result.current.envelope?.events[0]?.note).toBeNull());
    expect(TestBroadcastChannel.channels).toHaveLength(1);
    expect(mounted.result.current.envelope?.events[0]).toMatchObject({
      status: "not_boarded",
      occurredAt: before.events[0]?.occurredAt,
      note: null,
      noteDisposition: "discarded_erasure_cutoff",
    });
  });

  it("sends only a trip-key invalidation over the worker-to-page channel", async () => {
    const received: unknown[] = [];
    vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
    const peer = new TestBroadcastChannel("diveday-offline-manifest-changes-v1");
    peer.onmessage = (event) => received.push(event.data);
    const restoreLocalEvent = suppressSameDocumentManifestEvent();
    try {
      await saveOfflineManifest(tripPayload(1));
    } finally {
      restoreLocalEvent();
    }
    expect(received).toEqual([{ tripId }]);
    expect(TestBroadcastChannel.channels).toHaveLength(1);
    peer.close();
  });
});
