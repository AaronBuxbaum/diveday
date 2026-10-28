// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadOfflineManifest,
  OfflineManifestError,
  primeOfflineManifestShell,
  saveOfflineManifest,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import type { OfflineManifestEnvelope, OfflineManifestPayload } from "@/lib/offline-manifests";
import { type OfflineManifestSyncCopy, useOfflineManifestSync } from "./use-offline-manifest-sync";

const mockRouter = { refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => mockRouter }));
vi.mock("@/lib/offline-manifest-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline-manifest-store")>();
  return {
    OfflineManifestError: actual.OfflineManifestError,
    loadOfflineManifest: vi.fn(),
    primeOfflineManifestShell: vi.fn(),
    saveOfflineManifest: vi.fn(),
    syncOfflineManifest: vi.fn(),
  };
});

const TRIP_ID = "11111111-1111-1111-1111-111111111111";

const copy: OfflineManifestSyncCopy = {
  checkingDevice: "checking",
  reconcilePendingOne: "one pending",
  reconcilePendingOther: "{count} pending",
  reconcileCaughtUp: "caught up",
  reconcileErrorFallback: "could not reach",
  savingMessage: "saving",
  saveErrorFallback: "save failed",
  offlineWithSavedCopy: "offline with copy",
  offlineNoSavedCopy: "offline no copy",
  refreshNoSignal: "no signal",
};

const payload: OfflineManifestPayload = {
  shop: {
    slug: "blue-mantis",
    name: "Blue Mantis Divers",
    timezone: "America/New_York",
    emergencyReference: { lines: [], vessel: "", shoreContact: "", plan: "" },
  },
  manifests: [
    {
      trip: {
        id: TRIP_ID,
        title: "Two-Tank Reef",
        startsAt: "2026-08-01T13:00:00.000Z",
        endsAt: "2026-08-01T16:30:00.000Z",
        plannedDives: 2,
      },
      checkpoint: "departure",
      crew: [],
      divers: [],
      summary: {
        totalDivers: 0,
        ready: 0,
        blocked: 0,
        boarded: 0,
        notBoarded: 0,
        notBackAboard: 0,
        awaiting: 0,
        unaccountedFor: 0,
        overCapacity: 0,
        notHere: 0,
      },
    },
  ],
};

function envelope(): OfflineManifestEnvelope {
  return {
    snapshot: {
      ...payload,
      version: 4,
      snapshotId: "snapshot-1",
      savedAt: "2026-08-01T09:00:00.000Z",
      expiresAt: "2026-08-15T09:00:00.000Z",
    },
    events: [],
    checklistEvents: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  // A browser with service workers but none registered for this page (a
  // private window, a refused registration): `ready` never settles. Asking
  // Background Sync to take over must not hold the page's own queue on it.
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: new Promise(() => {}),
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
  vi.mocked(loadOfflineManifest).mockResolvedValue(envelope());
  vi.mocked(primeOfflineManifestShell).mockResolvedValue(undefined);
  vi.mocked(saveOfflineManifest).mockResolvedValue(envelope());
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("useOfflineManifestSync on a network that stops answering", () => {
  it("refreshes the live page when sync discards only a checklist note", async () => {
    const checklistDiscarded = envelope();
    checklistDiscarded.checklistEvents = [
      {
        clientEventId: "33333333-3333-4333-8333-333333333333",
        snapshotId: "snapshot-1",
        snapshotSavedAt: "2026-08-01T09:00:00.000Z",
        tripId: TRIP_ID,
        checklistItemId: "44444444-4444-4444-8444-444444444444",
        status: "checked",
        note: null,
        occurredAt: "2026-08-01T09:10:00.000Z",
        syncStatus: "applied",
        noteDisposition: "discarded_erasure_cutoff",
      },
    ];
    vi.mocked(syncOfflineManifest).mockResolvedValue(checklistDiscarded);

    renderHook(() => useOfflineManifestSync(payload, copy));

    await waitFor(() => expect(mockRouter.refresh).toHaveBeenCalled());
  });

  it("releases the queue when a sync gives up, and runs the pass queued behind it", async () => {
    // The mount's own reconcile settles; from then on the first sync hangs
    // until the store's deadline gives up on it.
    vi.mocked(syncOfflineManifest).mockResolvedValueOnce(envelope());
    const { result } = renderHook(() => useOfflineManifestSync(payload, copy));
    await waitFor(() => expect(syncOfflineManifest).toHaveBeenCalledTimes(1));

    const hung = deferred<OfflineManifestEnvelope>();
    vi.mocked(syncOfflineManifest).mockReturnValueOnce(hung.promise);
    act(() => result.current.refresh({ manual: false }));
    await waitFor(() => expect(syncOfflineManifest).toHaveBeenCalledTimes(2));

    // A second trigger while the first is still waiting queues, not doubles.
    vi.mocked(syncOfflineManifest).mockResolvedValueOnce(envelope());
    act(() => result.current.refresh({ manual: false }));
    expect(syncOfflineManifest).toHaveBeenCalledTimes(2);

    // The deadline: the store gives up with the same code an unreachable
    // server gets. The queued pass must run next, not wait on Background Sync.
    await act(async () => hung.reject(new OfflineManifestError("sync_unreachable")));
    await waitFor(() => expect(syncOfflineManifest).toHaveBeenCalledTimes(3));

    // And the queue is free again for the next trigger.
    vi.mocked(syncOfflineManifest).mockResolvedValueOnce(envelope());
    act(() => result.current.refresh({ manual: false }));
    await waitFor(() => expect(syncOfflineManifest).toHaveBeenCalledTimes(4));
  });

  it("says it could not reach the server when a sync gives up", async () => {
    vi.mocked(syncOfflineManifest).mockRejectedValue(new OfflineManifestError("sync_unreachable"));
    const { result } = renderHook(() => useOfflineManifestSync(payload, copy));
    await waitFor(() => expect(result.current.message).toBe("could not reach"));
  });
});
