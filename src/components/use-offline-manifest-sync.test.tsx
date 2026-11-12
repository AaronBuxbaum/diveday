// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginOfflineTenantVerificationRound,
  loadOfflineManifest,
  OfflineManifestError,
  primeOfflineManifestShell,
  saveOfflineManifest,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import {
  fetchOfflineManifestShopSlug,
  type OfflineManifestEnvelope,
  type OfflineManifestPayload,
} from "@/lib/offline-manifests";
import {
  forgetSavedOfflineReads,
  type OfflineManifestSyncCopy,
  useOfflineManifestSync,
} from "./use-offline-manifest-sync";

const mockRouter = { refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => mockRouter }));
vi.mock("@/lib/offline-manifest-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline-manifest-store")>();
  return {
    OfflineManifestError: actual.OfflineManifestError,
    beginOfflineTenantVerificationRound: vi.fn().mockResolvedValue(1),
    loadOfflineManifest: vi.fn(),
    primeOfflineManifestShell: vi.fn(),
    saveOfflineManifest: vi.fn(),
    syncOfflineManifest: vi.fn(),
  };
});

vi.mock("@/lib/offline-manifests", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline-manifests")>();
  return { ...actual, fetchOfflineManifestShopSlug: vi.fn().mockResolvedValue("blue-mantis") };
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
  forgetSavedOfflineReads();
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
  vi.mocked(beginOfflineTenantVerificationRound).mockResolvedValue(1);
  vi.mocked(fetchOfflineManifestShopSlug).mockResolvedValue("blue-mantis");
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

describe("useOfflineManifestSync saving the manifest page's rows (issue #4391)", () => {
  const SNAPSHOT_ID = "55555555-5555-4555-8555-555555555555";
  const SNAPSHOT_URL = `/api/offline-manifests/${TRIP_ID}/snapshot`;
  const pagePayload: OfflineManifestPayload = {
    ...payload,
    readAt: { erasureEpoch: 4, snapshotRevision: 9 },
  };
  /** The page's next render, as router.refresh() would deliver it. */
  const reread: OfflineManifestPayload = {
    ...payload,
    readAt: { erasureEpoch: 4, snapshotRevision: 10 },
  };
  const stale = () => Response.json({ error: "snapshot_superseded" }, { status: 409 });
  const issued = () => Response.json({ snapshotId: SNAPSHOT_ID, erasureEpochToken: "4.10.signed" });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderPage(initial: OfflineManifestPayload) {
    return renderHook(({ page }) => useOfflineManifestSync(page, copy), {
      initialProps: { page: initial },
    });
  }

  it("saves the rows under the snapshot the server issues for the epoch and revision they were read at", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => issued());
    vi.stubGlobal("fetch", fetchMock);

    renderPage(pagePayload);

    await waitFor(() => expect(saveOfflineManifest).toHaveBeenCalledTimes(1));
    const [saved] = vi.mocked(saveOfflineManifest).mock.calls[0] ?? [];
    expect(saved).toEqual({
      ...payload,
      snapshotId: SNAPSHOT_ID,
      erasureEpochToken: "4.10.signed",
    });
    expect(saved).not.toHaveProperty("readAt");
    const claim = fetchMock.mock.calls.find(([url]) => url === SNAPSHOT_URL);
    expect(claim?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(claim?.[1]?.body))).toEqual({ erasureEpoch: 4, snapshotRevision: 9 });
  });

  it("does not claim the same read twice when the page mounts again on a cached payload", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => issued());
    vi.stubGlobal("fetch", fetchMock);

    const first = renderPage(pagePayload);
    await waitFor(() => expect(saveOfflineManifest).toHaveBeenCalledTimes(1));
    first.unmount();
    const claims = () => fetchMock.mock.calls.filter(([url]) => url === SNAPSHOT_URL).length;
    expect(claims()).toBe(1);

    // Back or forward: the router serves the same read again.
    renderPage(pagePayload);
    await waitFor(() => expect(loadOfflineManifest).toHaveBeenCalled());
    expect(claims()).toBe(1);
    expect(mockRouter.refresh).not.toHaveBeenCalled();
    expect(saveOfflineManifest).toHaveBeenCalledTimes(1);
  });

  it("claims again when the saved copy is gone, and re-reads the page if that claim is stale", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => issued());
    vi.stubGlobal("fetch", fetchMock);

    const first = renderPage(pagePayload);
    await waitFor(() => expect(saveOfflineManifest).toHaveBeenCalledTimes(1));
    first.unmount();

    // Purged, expired or signed out since: nothing on the device to keep.
    vi.mocked(loadOfflineManifest).mockResolvedValue(null);
    fetchMock.mockImplementation(async () => stale());
    renderPage(pagePayload);

    await waitFor(() => expect(mockRouter.refresh).toHaveBeenCalledTimes(1));
    const claims = fetchMock.mock.calls.filter(([url]) => url === SNAPSHOT_URL).length;
    expect(claims).toBe(2);
    expect(saveOfflineManifest).toHaveBeenCalledTimes(1);
  });

  it("saves nothing and re-reads the page once when the read is stale, then saves the re-read", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      JSON.parse(String(init?.body)).snapshotRevision === 9 ? stale() : issued(),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = renderPage(pagePayload);

    await waitFor(() => expect(mockRouter.refresh).toHaveBeenCalledTimes(1));
    expect(saveOfflineManifest).not.toHaveBeenCalled();
    rerender({ page: reread });
    await waitFor(() => expect(saveOfflineManifest).toHaveBeenCalledTimes(1));
    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
  });

  it("asks for one re-read per stale claim, never a loop", async () => {
    const fetchMock = vi.fn(async () => stale());
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = renderPage(pagePayload);
    await waitFor(() => expect(mockRouter.refresh).toHaveBeenCalledTimes(1));

    // The re-read lands, and its claim is stale too (another copy again).
    rerender({ page: reread });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await act(async () => {});

    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
    expect(saveOfflineManifest).not.toHaveBeenCalled();
  });

  it("does not stay on Saving… after a manual refresh whose claim is stale and whose re-read never lands", async () => {
    let claims = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        claims += 1;
        return claims === 1 ? issued() : stale();
      }),
    );
    const { result, rerender } = renderPage(pagePayload);
    await waitFor(() => expect(saveOfflineManifest).toHaveBeenCalledTimes(1));

    act(() => result.current.refresh({ manual: true }));
    expect(result.current.message).toBe("saving");
    // The manual refresh's render lands; its claim is stale; the re-read it
    // asks for never arrives.
    rerender({ page: reread });
    await waitFor(() => expect(mockRouter.refresh).toHaveBeenCalledTimes(2));

    await waitFor(() => expect(result.current.message).not.toBe("saving"));
    expect(result.current.message).toBe("");
    expect(result.current.busy).toBe(false);
  });

  it("saves nothing when the snapshot cannot be issued", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "x" }, { status: 500 })),
    );

    const { result } = renderPage(pagePayload);

    await waitFor(() => expect(result.current.message).toBe("save failed"));
    expect(saveOfflineManifest).not.toHaveBeenCalled();
  });
});
