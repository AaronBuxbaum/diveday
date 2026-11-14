// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManifestRosterFreshness } from "@/app/shop/[shopSlug]/trips/[id]/manifest/_components/ManifestRosterFreshness";
import { readManifestHistoryCookie } from "@/app/shop/[shopSlug]/trips/[id]/manifest/_components/manifest-history-cookie";
import {
  markManifestReadStale,
  resetManifestRereadForTests,
  subscribeManifestReread,
} from "@/components/manifest-stale-generation";
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
    subscribeOfflineManifestChanges: actual.subscribeOfflineManifestChanges,
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
  resetManifestRereadForTests(TRIP_ID);
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
  it("requests one roster refresh and reconciles when a cached manifest reconnects", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    render(
      <ManifestRosterFreshness
        tripId={TRIP_ID}
        renderId="offline"
        historyScope="scope-one"
        readCompletedAt={1_794_581_040_000}
        readCompletedLabel="last read completed"
        copy={{ unconfirmed: "Not checked", confirmed: "Checked" }}
      />,
    );
    renderHook(() => useOfflineManifestSync(payload, copy));
    await waitFor(() => expect(loadOfflineManifest).toHaveBeenCalled());
    expect(mockRouter.refresh).not.toHaveBeenCalled();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    act(() => window.dispatchEvent(new Event("online")));
    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Not checked")).toBeVisible();
    await waitFor(() => expect(syncOfflineManifest).toHaveBeenCalled());
    vi.unstubAllGlobals();
  });

  it("keeps the verified read time and pending change visible when sync outcome is unknown", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const pending = envelope();
    pending.events = [
      {
        clientEventId: "rollcall-1",
        snapshotId: "snapshot-1",
        snapshotSavedAt: "2026-08-01T09:00:00.000Z",
        tripId: TRIP_ID,
        crewPersonId: "crew-1",
        checkpoint: "departure",
        status: "boarded",
        occurredAt: "2026-08-01T09:10:00.000Z",
        syncStatus: "pending",
      },
    ];
    vi.mocked(loadOfflineManifest).mockResolvedValue(pending);
    const outcome = deferred<OfflineManifestEnvelope>();
    vi.mocked(syncOfflineManifest).mockReturnValueOnce(outcome.promise);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const status = { unconfirmed: "Not checked", confirmed: "Checked" };
    const view = (token?: string) => (
      <ManifestRosterFreshness
        tripId={TRIP_ID}
        renderId="historical"
        renderToken={token}
        renderProof={token ? "proof" : undefined}
        historyScope="scope-one"
        readCompletedAt={1_794_581_040_000}
        readCompletedLabel="last read completed at 9:42"
        copy={status}
      />
    );
    const freshness = render(view());
    const { result } = renderHook(() => useOfflineManifestSync(payload, copy));
    await waitFor(() => expect(result.current.saved).toEqual(pending));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    act(() => window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(syncOfflineManifest).toHaveBeenCalled());
    const token = readManifestHistoryCookie(document.cookie, TRIP_ID);
    freshness.rerender(view(token));
    await waitFor(() => expect(screen.getByText("Checked")).toBeVisible());
    await act(async () => outcome.reject(new OfflineManifestError("sync_unreachable")));
    await waitFor(() => expect(result.current.message).toBe("could not reach"));
    expect(screen.getByText("last read completed at 9:42")).toBeVisible();
    expect(result.current.saved?.events).toEqual(pending.events);
    vi.unstubAllGlobals();
  });

  it("refreshes and reconciles on reconnect when no freshness owner is mounted", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const { result } = renderHook(() => useOfflineManifestSync(payload, copy));
    await waitFor(() => expect(result.current.saved).not.toBeNull());
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    act(() => window.dispatchEvent(new Event("online")));
    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(syncOfflineManifest).toHaveBeenCalled());
  });

  it("reloads the device queue when another context completes a sync", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const channels: Array<{ name: string; onmessage: ((event: MessageEvent) => void) | null }> = [];
    class TestChannel {
      onmessage: ((event: MessageEvent) => void) | null = null;
      constructor(public name: string) {
        channels.push(this);
      }
      close() {}
      postMessage() {}
    }
    vi.stubGlobal("BroadcastChannel", TestChannel);
    const initial = envelope();
    const after = envelope();
    after.checklistEvents = [
      {
        clientEventId: "checklist-1",
        snapshotId: "snapshot-1",
        snapshotSavedAt: "2026-08-01T09:00:00.000Z",
        tripId: TRIP_ID,
        checklistItemId: "check-1",
        status: "checked",
        note: null,
        occurredAt: "2026-08-01T09:10:00.000Z",
        syncStatus: "pending",
      },
    ];
    vi.mocked(loadOfflineManifest).mockResolvedValue(initial);
    const { result } = renderHook(() => useOfflineManifestSync(payload, copy));
    await waitFor(() => expect(result.current.saved).toEqual(initial));
    vi.mocked(loadOfflineManifest).mockResolvedValue(after);
    const channel = channels.find((item) => item.name === "diveday-offline-manifest-changes-v1");
    expect(channel).toBeDefined();
    act(() =>
      channel?.onmessage?.(
        new MessageEvent("message", {
          data: { tripId: TRIP_ID, sourceId: "worker", reason: "sync" },
        }),
      ),
    );
    await waitFor(() => expect(result.current.saved).toEqual(after));
    vi.unstubAllGlobals();
  });

  it("refreshes after a worker sync even if the pending queue was never observed", async () => {
    const channels: Array<{ name: string; onmessage: ((event: MessageEvent) => void) | null }> = [];
    class TestChannel {
      onmessage: ((event: MessageEvent) => void) | null = null;
      constructor(public name: string) {
        channels.push(this);
      }
      close() {}
      postMessage() {}
    }
    vi.stubGlobal("BroadcastChannel", TestChannel);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);
    const { result } = renderHook(() => useOfflineManifestSync(payload, copy));
    await waitFor(() => expect(result.current.saved).not.toBeNull());
    mockRouter.refresh.mockClear();
    const channel = channels.find((item) => item.name === "diveday-offline-manifest-changes-v1");
    expect(channel).toBeDefined();
    act(() =>
      channel?.onmessage?.(
        new MessageEvent("message", {
          data: { tripId: TRIP_ID, sourceId: "worker", reason: "sync" },
        }),
      ),
    );
    await waitFor(() => expect(mockRouter.refresh).toHaveBeenCalledTimes(1));
    vi.unstubAllGlobals();
  });

  it("hands worker sync rereads to the mounted freshness owner", async () => {
    const channels: Array<{ name: string; onmessage: ((event: MessageEvent) => void) | null }> = [];
    class TestChannel {
      onmessage: ((event: MessageEvent) => void) | null = null;
      constructor(public name: string) {
        channels.push(this);
      }
      close() {}
      postMessage() {}
    }
    vi.stubGlobal("BroadcastChannel", TestChannel);
    vi.mocked(syncOfflineManifest).mockResolvedValue(null);
    const owner = vi.fn(() => true);
    const unsubscribe = subscribeManifestReread(TRIP_ID, owner);
    const { result } = renderHook(() => useOfflineManifestSync(payload, copy));
    await waitFor(() => expect(result.current.saved).not.toBeNull());
    act(() => {
      markManifestReadStale(TRIP_ID);
      markManifestReadStale(TRIP_ID);
      markManifestReadStale(TRIP_ID);
    });
    expect(owner).toHaveBeenCalledTimes(2);
    owner.mockClear();
    mockRouter.refresh.mockClear();
    const channel = channels.find((item) => item.name === "diveday-offline-manifest-changes-v1");
    expect(channel).toBeDefined();
    act(() =>
      channel?.onmessage?.(
        new MessageEvent("message", {
          data: { tripId: TRIP_ID, sourceId: "worker", reason: "sync" },
        }),
      ),
    );
    await waitFor(() => expect(owner).toHaveBeenCalledTimes(1));
    expect(mockRouter.refresh).not.toHaveBeenCalled();
    unsubscribe();
    vi.unstubAllGlobals();
  });

  it("reloads the device queue on focus when a worker message was missed", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const initial = envelope();
    const after = envelope();
    after.arrivalEvents = [
      {
        clientEventId: "arrival-1",
        snapshotId: "snapshot-1",
        snapshotSavedAt: "2026-08-01T09:00:00.000Z",
        tripId: TRIP_ID,
        bookingId: "booking-1",
        status: "arrived",
        occurredAt: "2026-08-01T09:10:00.000Z",
        syncStatus: "pending",
      },
    ];
    vi.mocked(loadOfflineManifest).mockResolvedValue(initial);
    const { result } = renderHook(() => useOfflineManifestSync(payload, copy));
    await waitFor(() => expect(result.current.saved).toEqual(initial));
    vi.mocked(loadOfflineManifest).mockResolvedValue(after);
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.saved).toEqual(after));
  });

  it("does not report no offline copy when an older initial read finishes last", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const oldRead = deferred<OfflineManifestEnvelope | null>();
    const newer = envelope();
    vi.mocked(loadOfflineManifest).mockReturnValueOnce(oldRead.promise).mockResolvedValue(newer);
    const { result } = renderHook(() => useOfflineManifestSync(payload, copy));
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.saved).toEqual(newer));
    await act(async () => oldRead.resolve(null));
    await waitFor(() => expect(result.current.message).toBe("offline with copy"));
    expect(result.current.saved).toEqual(newer);
  });

  it("does not replace a completed worker reload with an older sync result", async () => {
    const initial = envelope();
    const newer = envelope();
    newer.arrivalEvents = [
      {
        clientEventId: "arrival-1",
        snapshotId: "snapshot-1",
        snapshotSavedAt: "2026-08-01T09:00:00.000Z",
        tripId: TRIP_ID,
        bookingId: "booking-1",
        status: "arrived",
        occurredAt: "2026-08-01T09:10:00.000Z",
        syncStatus: "pending",
      },
    ];
    const oldSync = deferred<OfflineManifestEnvelope | null>();
    vi.mocked(loadOfflineManifest).mockResolvedValue(initial);
    vi.mocked(saveOfflineManifest).mockResolvedValue(initial);
    vi.mocked(syncOfflineManifest).mockReturnValueOnce(oldSync.promise);
    const { result } = renderHook(() => useOfflineManifestSync(payload, copy));
    await waitFor(() => expect(syncOfflineManifest).toHaveBeenCalled());
    vi.mocked(loadOfflineManifest).mockResolvedValue(newer);
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.saved).toEqual(newer));
    await act(async () => oldSync.resolve(initial));
    await waitFor(() => expect(result.current.saved).toEqual(newer));
    expect(result.current.message).not.toBe("caught up");
    vi.mocked(syncOfflineManifest).mockResolvedValue(initial);
    act(() => result.current.refresh({ manual: false }));
    await waitFor(() => expect(result.current.message).toBe("caught up"));
    expect(mockRouter.refresh).toHaveBeenCalled();
  });

  it("refreshes after a worker reload observes a pending queue settle during sync", async () => {
    const pending = envelope();
    pending.events = [
      {
        clientEventId: "rollcall-1",
        snapshotId: "snapshot-1",
        snapshotSavedAt: "2026-08-01T09:00:00.000Z",
        tripId: TRIP_ID,
        crewPersonId: "crew-1",
        checkpoint: "departure",
        status: "boarded",
        occurredAt: "2026-08-01T09:10:00.000Z",
        syncStatus: "pending",
      },
    ];
    const settled = envelope();
    const sync = deferred<OfflineManifestEnvelope | null>();
    vi.mocked(loadOfflineManifest).mockResolvedValue(pending);
    vi.mocked(saveOfflineManifest).mockResolvedValue(pending);
    vi.mocked(syncOfflineManifest).mockReturnValueOnce(sync.promise);
    const { result } = renderHook(() => useOfflineManifestSync(payload, copy));
    await waitFor(() => expect(syncOfflineManifest).toHaveBeenCalled());
    mockRouter.refresh.mockClear();
    vi.mocked(loadOfflineManifest).mockResolvedValue(settled);
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.saved).toEqual(settled));
    expect(mockRouter.refresh).toHaveBeenCalled();
    await act(async () => sync.resolve(settled));
  });

  it("retries a worker reload if an older local sync finishes first", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const initial = envelope();
    const newer = envelope();
    newer.arrivalEvents = [
      {
        clientEventId: "arrival-1",
        snapshotId: "snapshot-1",
        snapshotSavedAt: "2026-08-01T09:00:00.000Z",
        tripId: TRIP_ID,
        bookingId: "booking-1",
        status: "arrived",
        occurredAt: "2026-08-01T09:10:00.000Z",
        syncStatus: "pending",
      },
    ];
    vi.mocked(loadOfflineManifest).mockResolvedValue(initial);
    const { result } = renderHook(() => useOfflineManifestSync(payload, copy));
    await waitFor(() => expect(result.current.saved).toEqual(initial));
    const delayedWorkerRead = deferred<OfflineManifestEnvelope | null>();
    vi.mocked(loadOfflineManifest)
      .mockReturnValueOnce(delayedWorkerRead.promise)
      .mockResolvedValue(newer);
    act(() => window.dispatchEvent(new Event("focus")));
    vi.mocked(syncOfflineManifest).mockResolvedValue(initial);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    act(() => result.current.refresh({ manual: false }));
    await waitFor(() => expect(syncOfflineManifest).toHaveBeenCalled());
    await act(async () => delayedWorkerRead.resolve(newer));
    await waitFor(() => expect(result.current.saved).toEqual(newer));
  });

  it("does not show the previous trip's pending count while the next trip loads", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const otherTrip = "22222222-2222-4222-8222-222222222222";
    const old = envelope();
    old.events = [
      {
        clientEventId: "rollcall-1",
        snapshotId: "snapshot-1",
        snapshotSavedAt: "2026-08-01T09:00:00.000Z",
        tripId: TRIP_ID,
        crewPersonId: "crew-1",
        checkpoint: "departure",
        status: "boarded",
        occurredAt: "2026-08-01T09:10:00.000Z",
        syncStatus: "pending",
      },
    ];
    const next = envelope();
    next.snapshot = {
      ...next.snapshot,
      manifests: [
        {
          ...next.snapshot.manifests[0],
          trip: { ...next.snapshot.manifests[0].trip, id: otherTrip },
        },
      ],
    };
    const otherPayload: OfflineManifestPayload = {
      ...payload,
      manifests: [
        { ...payload.manifests[0], trip: { ...payload.manifests[0].trip, id: otherTrip } },
      ],
    };
    const nextRead = deferred<OfflineManifestEnvelope | null>();
    vi.mocked(loadOfflineManifest).mockImplementation(async (id) =>
      id === TRIP_ID ? old : nextRead.promise,
    );
    const { result, rerender } = renderHook(({ page }) => useOfflineManifestSync(page, copy), {
      initialProps: { page: payload },
    });
    await waitFor(() => expect(result.current.saved).toEqual(old));
    rerender({ page: otherPayload });
    expect(result.current.saved).toBeNull();
    await act(async () => nextRead.resolve(next));
    await waitFor(() => expect(result.current.saved).toEqual(next));
  });

  it("ignores a previous trip's delayed sync after the hook switches trips", async () => {
    const otherTrip = "22222222-2222-4222-8222-222222222222";
    const old = envelope();
    const next = envelope();
    next.snapshot = {
      ...next.snapshot,
      manifests: [
        {
          ...next.snapshot.manifests[0],
          trip: { ...next.snapshot.manifests[0].trip, id: otherTrip },
        },
      ],
    };
    const otherPayload: OfflineManifestPayload = {
      ...payload,
      manifests: [
        { ...payload.manifests[0], trip: { ...payload.manifests[0].trip, id: otherTrip } },
      ],
    };
    const delayedSync = deferred<OfflineManifestEnvelope | null>();
    vi.mocked(loadOfflineManifest).mockImplementation(async (id) => (id === TRIP_ID ? old : next));
    vi.mocked(saveOfflineManifest).mockImplementation(async (item) =>
      item.manifests[0]?.trip.id === TRIP_ID ? old : next,
    );
    vi.mocked(syncOfflineManifest).mockImplementation(async (id) =>
      id === TRIP_ID ? delayedSync.promise : next,
    );
    const { result, rerender } = renderHook(({ page }) => useOfflineManifestSync(page, copy), {
      initialProps: { page: payload },
    });
    await waitFor(() =>
      expect(syncOfflineManifest).toHaveBeenCalledWith(
        TRIP_ID,
        expect.anything(),
        expect.anything(),
      ),
    );
    rerender({ page: otherPayload });
    await waitFor(() =>
      expect(result.current.saved?.snapshot.manifests[0].trip.id).toBe(otherTrip),
    );
    await act(async () => delayedSync.resolve(old));
    expect(result.current.saved?.snapshot.manifests[0].trip.id).toBe(otherTrip);
  });

  it("does not replace a newer device queue with a delayed focus read", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const initial = envelope();
    const newer = envelope();
    newer.arrivalEvents = [
      {
        clientEventId: "arrival-1",
        snapshotId: "snapshot-1",
        snapshotSavedAt: "2026-08-01T09:00:00.000Z",
        tripId: TRIP_ID,
        bookingId: "booking-1",
        status: "arrived",
        occurredAt: "2026-08-01T09:10:00.000Z",
        syncStatus: "pending",
      },
    ];
    vi.mocked(loadOfflineManifest).mockResolvedValue(initial);
    const { result } = renderHook(() => useOfflineManifestSync(payload, copy));
    await waitFor(() => expect(result.current.saved).toEqual(initial));
    const oldRead = deferred<OfflineManifestEnvelope | null>();
    vi.mocked(loadOfflineManifest).mockReturnValueOnce(oldRead.promise).mockResolvedValue(newer);
    act(() => window.dispatchEvent(new Event("focus")));
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.saved).toEqual(newer));
    await act(async () => oldRead.resolve(initial));
    expect(result.current.saved).toEqual(newer);
  });

  it("does not say everything was sent while a checklist change is still pending", async () => {
    const before = envelope();
    before.events = [
      {
        clientEventId: "rollcall-1",
        snapshotId: "snapshot-1",
        snapshotSavedAt: "2026-08-01T09:00:00.000Z",
        tripId: TRIP_ID,
        crewPersonId: "crew-1",
        checkpoint: "departure",
        status: "boarded",
        occurredAt: "2026-08-01T09:10:00.000Z",
        syncStatus: "pending",
      },
    ];
    const after = envelope();
    after.checklistEvents = [
      {
        clientEventId: "checklist-1",
        snapshotId: "snapshot-1",
        snapshotSavedAt: "2026-08-01T09:00:00.000Z",
        tripId: TRIP_ID,
        checklistItemId: "check-1",
        status: "checked",
        note: null,
        occurredAt: "2026-08-01T09:10:00.000Z",
        syncStatus: "pending",
      },
    ];
    vi.mocked(loadOfflineManifest).mockResolvedValue(before);
    vi.mocked(saveOfflineManifest).mockResolvedValue(before);
    vi.mocked(syncOfflineManifest).mockResolvedValue(after);
    const { result } = renderHook(() => useOfflineManifestSync(payload, copy));
    await waitFor(() => expect(result.current.message).toBe("one pending"));
    expect(result.current.saved?.checklistEvents).toEqual(after.checklistEvents);
  });

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
    readAt: { erasureEpoch: 4, snapshotRevision: 9, scheduleVersion: "[]" },
  };
  /** The page's next render, as router.refresh() would deliver it. */
  const reread: OfflineManifestPayload = {
    ...payload,
    readAt: { erasureEpoch: 4, snapshotRevision: 10, scheduleVersion: "[]" },
  };
  const stale = () => Response.json({ error: "snapshot_superseded" }, { status: 409 });
  const issued = () =>
    Response.json({
      snapshotId: SNAPSHOT_ID,
      erasureEpochToken: "4.10.signed",
      meetingIdentityProofs: [],
    });

  let releaseRereadOwner: (() => void) | undefined;
  afterEach(() => {
    releaseRereadOwner?.();
    releaseRereadOwner = undefined;
    vi.unstubAllGlobals();
  });

  function mountRereadOwner() {
    releaseRereadOwner = subscribeManifestReread(TRIP_ID, () => {
      mockRouter.refresh();
      return true;
    });
  }

  function renderPage(initial: OfflineManifestPayload) {
    return renderHook(({ page }) => useOfflineManifestSync(page, copy), {
      initialProps: { page: initial },
    });
  }

  it("hands a stale snapshot to the mounted owner for one correlated reread", async () => {
    window.history.replaceState(null, "", "/manifest");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === SNAPSHOT_URL ? stale() : new Response(null, { status: 204 }),
      ),
    );
    const status = { unconfirmed: "Not checked", confirmed: "Checked" };
    const freshness = render(
      <ManifestRosterFreshness
        historyScope="scope-one"
        readCompletedAt={1_794_581_040_000}
        readCompletedLabel="read completed"
        tripId={TRIP_ID}
        renderId="first"
        copy={status}
      />,
    );
    await waitFor(() => expect(mockRouter.refresh).toHaveBeenCalledTimes(1));
    const first = readManifestHistoryCookie(document.cookie, TRIP_ID);
    renderPage(pagePayload);
    await waitFor(() => expect(mockRouter.refresh).toHaveBeenCalledTimes(2));
    const second = readManifestHistoryCookie(document.cookie, TRIP_ID);
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(screen.getByText(status.unconfirmed)).toBeVisible();
    freshness.rerender(
      <ManifestRosterFreshness
        historyScope="scope-one"
        readCompletedAt={1_794_581_040_000}
        readCompletedLabel="read completed"
        tripId={TRIP_ID}
        renderId="second"
        renderToken={second}
        renderProof="proof"
        copy={status}
      />,
    );
    await waitFor(() => expect(screen.getByText(status.confirmed)).toBeVisible());
    expect(mockRouter.refresh).toHaveBeenCalledTimes(2);
  });

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
      meetingIdentityProofs: [],
    });
    expect(saved).not.toHaveProperty("readAt");
    const claim = fetchMock.mock.calls.find(([url]) => url === SNAPSHOT_URL);
    expect(claim?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(claim?.[1]?.body))).toEqual({
      erasureEpoch: 4,
      snapshotRevision: 9,
      scheduleVersion: "[]",
    });
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
    mountRereadOwner();
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
    mountRereadOwner();
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

  it("does not stay on Saving… after a manual refresh whose claim is stale and whose re-read never lands", async () => {
    mountRereadOwner();
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
