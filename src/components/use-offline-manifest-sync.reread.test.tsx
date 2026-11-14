// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManifestRosterFreshness } from "@/app/shop/[shopSlug]/trips/[id]/manifest/_components/ManifestRosterFreshness";
import { readManifestHistoryCookie } from "@/app/shop/[shopSlug]/trips/[id]/manifest/_components/manifest-history-cookie";
import {
  manifestStaleGeneration,
  markManifestRosterCommitted,
  resetManifestRereadForTests,
  subscribeManifestReread,
} from "@/components/manifest-stale-generation";
import {
  beginOfflineTenantVerificationRound,
  loadOfflineManifest,
  primeOfflineManifestShell,
  saveOfflineManifest,
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
  vi.unstubAllGlobals();
});

describe("repeated stale roster reads", () => {
  const SNAPSHOT_URL = `/api/offline-manifests/${TRIP_ID}/snapshot`;
  const pagePayload: OfflineManifestPayload = {
    ...payload,
    readAt: { erasureEpoch: 4, snapshotRevision: 9, scheduleVersion: "[]" },
  };
  const reread: OfflineManifestPayload = {
    ...payload,
    readAt: { erasureEpoch: 4, snapshotRevision: 10, scheduleVersion: "[]" },
  };
  const stale = () => Response.json({ error: "snapshot_superseded" }, { status: 409 });
  const issued = () =>
    Response.json({
      snapshotId: "55555555-5555-4555-8555-555555555555",
      erasureEpochToken: "4.10.signed",
      meetingIdentityProofs: [],
    });
  function renderPage(initial: OfflineManifestPayload) {
    return renderHook(({ page }) => useOfflineManifestSync(page, copy), {
      initialProps: { page: initial },
    });
  }
  let releaseRereadOwner: (() => void) | undefined;
  afterEach(() => {
    releaseRereadOwner?.();
    releaseRereadOwner = undefined;
  });
  function mountRereadOwner() {
    releaseRereadOwner = subscribeManifestReread(TRIP_ID, () => {
      mockRouter.refresh();
      return true;
    });
  }

  it("bounds consecutive stale-claim rereads", async () => {
    mountRereadOwner();
    const generation = manifestStaleGeneration(TRIP_ID);
    const fetchMock = vi.fn(async () => stale());
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = renderPage(pagePayload);
    await waitFor(() => expect(mockRouter.refresh).toHaveBeenCalledTimes(1));

    // Two consecutive refusals each need a new read; a third stays bounded.
    rerender({ page: reread });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockRouter.refresh).toHaveBeenCalledTimes(2));
    rerender({
      page: {
        ...payload,
        readAt: { erasureEpoch: 4, snapshotRevision: 11, scheduleVersion: "[]" },
      },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(mockRouter.refresh).toHaveBeenCalledTimes(2);
    expect(manifestStaleGeneration(TRIP_ID)).toBe(generation + 3);
    expect(saveOfflineManifest).not.toHaveBeenCalled();
  });

  it("requests a fresh read after two stale claims before accepting a newer claim", async () => {
    mountRereadOwner();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(stale())
      .mockResolvedValueOnce(stale())
      .mockResolvedValueOnce(issued());
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = renderPage(pagePayload);
    await waitFor(() => expect(mockRouter.refresh).toHaveBeenCalledTimes(1));
    rerender({ page: reread });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockRouter.refresh).toHaveBeenCalledTimes(2));
    rerender({
      page: {
        ...payload,
        readAt: { erasureEpoch: 4, snapshotRevision: 11, scheduleVersion: "[]" },
      },
    });
    await waitFor(() => expect(saveOfflineManifest).toHaveBeenCalledTimes(1));
    expect(mockRouter.refresh).toHaveBeenCalledTimes(2);
  });

  it("confirms only the committed read after two refusals cancel an older verifier", async () => {
    let resolveOld!: (response: Response) => void;
    let snapshotCalls = 0;
    let verifyCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === SNAPSHOT_URL) return ++snapshotCalls <= 2 ? stale() : issued();
        if (url.includes("roster-confirmation")) {
          verifyCalls += 1;
          if (verifyCalls === 1)
            return new Promise<Response>((resolve) => {
              resolveOld = resolve;
            });
        }
        return new Response(null, { status: 204 });
      }),
    );
    const status = { unconfirmed: "Not checked", confirmed: "Checked" };
    const freshnessView = (id: string, token?: string) => (
      <ManifestRosterFreshness
        historyScope="scope-one"
        readCompletedAt={1_794_581_040_000}
        readCompletedLabel="read completed"
        tripId={TRIP_ID}
        renderId={id}
        renderToken={token}
        renderProof={token ? "proof" : undefined}
        requireCommit
        copy={status}
      />
    );
    const freshness = render(freshnessView("initial"));
    await waitFor(() => expect(mockRouter.refresh).toHaveBeenCalledTimes(1));
    const page = renderPage(pagePayload);
    await waitFor(() => expect(mockRouter.refresh).toHaveBeenCalledTimes(2));
    const secondToken = readManifestHistoryCookie(document.cookie, TRIP_ID);
    expect(secondToken).toBeTruthy();
    freshness.rerender(freshnessView("second", secondToken));
    await waitFor(() => expect(verifyCalls).toBe(1));
    page.rerender({ page: reread });
    await waitFor(() => expect(mockRouter.refresh).toHaveBeenCalledTimes(3));
    const thirdToken = readManifestHistoryCookie(document.cookie, TRIP_ID);
    if (!thirdToken) throw new Error("third read did not request a challenge");
    expect(thirdToken).not.toBe(secondToken);
    await act(async () => resolveOld(new Response(null, { status: 204 })));
    expect(screen.queryByText(status.confirmed)).toBeNull();
    freshness.rerender(freshnessView("third", thirdToken));
    let unmark = () => {};
    act(() => {
      unmark = markManifestRosterCommitted(TRIP_ID, "third", thirdToken, "departure");
    });
    await waitFor(() => expect(screen.getByText(status.confirmed)).toBeVisible());
    unmark();
  });

  it("stays unconfirmed after exhausting the reread budget and recovers on reconnect", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === SNAPSHOT_URL ? stale() : new Response(null, { status: 204 }),
      ),
    );
    const status = { unconfirmed: "Not checked", confirmed: "Checked" };
    const freshnessView = (id: string, token?: string) => (
      <ManifestRosterFreshness
        historyScope="scope-one"
        readCompletedAt={1_794_581_040_000}
        readCompletedLabel="read completed"
        tripId={TRIP_ID}
        renderId={id}
        renderToken={token}
        renderProof={token ? "proof" : undefined}
        requireCommit
        copy={status}
      />
    );
    const freshness = render(freshnessView("initial"));
    await waitFor(() => expect(mockRouter.refresh).toHaveBeenCalledTimes(1));
    const page = renderPage(pagePayload);
    await waitFor(() => expect(mockRouter.refresh).toHaveBeenCalledTimes(2));
    page.rerender({ page: reread });
    await waitFor(() => expect(mockRouter.refresh).toHaveBeenCalledTimes(3));
    page.rerender({
      page: {
        ...payload,
        readAt: { erasureEpoch: 4, snapshotRevision: 11, scheduleVersion: "[]" },
      },
    });
    await waitFor(() => expect(manifestStaleGeneration(TRIP_ID)).toBeGreaterThanOrEqual(3));
    expect(mockRouter.refresh).toHaveBeenCalledTimes(3);
    expect(screen.queryByText(status.confirmed)).toBeNull();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    act(() => window.dispatchEvent(new Event("offline")));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    act(() => window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(mockRouter.refresh).toHaveBeenCalledTimes(4));
    const token = readManifestHistoryCookie(document.cookie, TRIP_ID);
    if (!token) throw new Error("reconnect did not request a challenge");
    freshness.rerender(freshnessView("reconnected", token));
    let unmark = () => {};
    act(() => {
      unmark = markManifestRosterCommitted(TRIP_ID, "reconnected", token, "departure");
    });
    await waitFor(() => expect(screen.getByText(status.confirmed)).toBeVisible());
    unmark();
  });
});
