// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  listOfflineManifests,
  loadOfflineManifest,
  OfflineManifestError,
  purgeOfflineManifestsExceptShop,
  readDiscardedOfflineRecords,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";
import { OfflineManifestView } from "./OfflineManifestView";
import {
  FROZEN_MS,
  identityResponse,
  richEnvelope,
  setOnline,
} from "./offline-manifest/view-fixtures";

let searchParams = new URLSearchParams("trip=trip-1");
vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams }));
vi.mock("@/lib/offline-manifest-store", async () => ({
  OfflineManifestError: (
    await vi.importActual<typeof import("@/lib/offline-manifest-store")>(
      "@/lib/offline-manifest-store",
    )
  ).OfflineManifestError,
  acknowledgeDiscardedOfflineRecords: vi.fn().mockResolvedValue(undefined),
  getActiveOfflineShellVersion: vi.fn().mockResolvedValue(null),
  loadOfflineManifest: vi.fn(),
  listOfflineManifests: vi.fn(),
  purgeOfflineManifestsExceptShop: vi.fn().mockResolvedValue(undefined),
  readDiscardedOfflineRecords: vi.fn().mockResolvedValue([]),
  syncOfflineManifest: vi.fn(),
}));

beforeEach(() => {
  searchParams = new URLSearchParams("trip=trip-1");
  setOnline(true);
  vi.mocked(loadOfflineManifest).mockReset();
  vi.mocked(listOfflineManifests).mockReset();
  vi.mocked(purgeOfflineManifestsExceptShop).mockClear();
  vi.mocked(syncOfflineManifest).mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

it("quarantines the root list as soon as one trip detects a shop switch", async () => {
  searchParams = new URLSearchParams();
  const first = richEnvelope("trip-1");
  const second = richEnvelope("trip-2");
  for (const saved of [first, second]) {
    const tripId = saved.snapshot.manifests[0]?.trip.id;
    expect(tripId).toBeDefined();
    saved.events.push({
      clientEventId: `event-${tripId}`,
      snapshotId: saved.snapshot.snapshotId,
      snapshotSavedAt: saved.snapshot.savedAt,
      tripId: tripId ?? "missing-trip",
      bookingId: "synthetic-booking",
      checkpoint: "departure",
      status: "boarded",
      occurredAt: new Date(FROZEN_MS).toISOString(),
      note: null,
      syncStatus: "pending",
    });
  }
  vi.mocked(listOfflineManifests).mockResolvedValue([first, second]);

  let rejectFirst: (error: Error) => void = () => {};
  let resolveSecond: (envelope: OfflineManifestEnvelope | null) => void = () => {};
  vi.mocked(syncOfflineManifest).mockImplementation((tripId) =>
    tripId === "trip-1"
      ? new Promise((_, reject) => {
          rejectFirst = reject;
        })
      : new Promise((resolve) => {
          resolveSecond = resolve;
        }),
  );
  let mismatch = false;
  let allowShopB = false;
  vi.mocked(fetch).mockImplementation(async (input) => {
    if (String(input) !== "/api/offline-manifests/identity") return new Response(null);
    if (!mismatch) return identityResponse("blue-mantis");
    if (!allowShopB) throw new Error("identity lookup unavailable");
    return identityResponse("reef-runners");
  });

  render(<OfflineManifestView />);
  await waitFor(() => expect(syncOfflineManifest).toHaveBeenCalledTimes(2));
  expect(screen.getByText(/Saved/)).toBeInTheDocument();

  mismatch = true;
  await act(async () => rejectFirst(new OfflineManifestError("shop_changed")));
  expect(
    await screen.findByRole("heading", { name: "Checking this device’s shop" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Dana Divemaster")).not.toBeInTheDocument();
  expect(screen.queryAllByRole("link")).toHaveLength(0);
  expect(first.events[0]?.syncStatus).toBe("pending");
  expect(second.events[0]?.syncStatus).toBe("pending");

  // The second trip has not completed; its late response must not repaint the
  // Shop A list or settle its retained pending event.
  await act(async () => resolveSecond(null));
  expect(screen.getByRole("heading", { name: "Checking this device’s shop" })).toBeInTheDocument();
  expect(screen.queryByText("Dana Divemaster")).not.toBeInTheDocument();
  expect(first.events[0]?.syncStatus).toBe("pending");
  expect(second.events[0]?.syncStatus).toBe("pending");
  allowShopB = true;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("quarantines a selected roster through failed verification, then scopes it after Shop B verifies", async () => {
  const saved = richEnvelope(
    "trip-1",
    {},
    {
      events: [
        {
          clientEventId: "synthetic-event",
          snapshotId: "snap-trip-1",
          snapshotSavedAt: new Date(FROZEN_MS).toISOString(),
          tripId: "trip-1",
          bookingId: "synthetic-booking",
          checkpoint: "departure",
          status: "boarded",
          occurredAt: new Date(FROZEN_MS).toISOString(),
          note: null,
          syncStatus: "pending",
        } as OfflineManifestEnvelope["events"][number],
      ],
    },
  );
  vi.mocked(loadOfflineManifest).mockResolvedValue(saved);

  let rejectSync: (error: Error) => void = () => {};
  vi.mocked(syncOfflineManifest).mockReturnValue(
    new Promise((_, reject) => {
      rejectSync = reject;
    }),
  );
  let mismatch = false;
  let allowShopB = false;
  let deferNextIdentity = false;
  let resolveDeferredIdentity: ((response: Response) => void) | null = null;
  let identityLookups = 0;
  vi.mocked(fetch).mockImplementation(async (input) => {
    if (String(input) !== "/api/offline-manifests/identity") {
      return new Response(null, { status: 200 });
    }
    identityLookups += 1;
    if (!mismatch) return identityResponse("blue-mantis");
    if (deferNextIdentity) {
      deferNextIdentity = false;
      return new Promise<Response>((resolve) => {
        resolveDeferredIdentity = resolve;
      });
    }
    if (!allowShopB) throw new Error("identity lookup unavailable");
    return identityResponse("reef-runners");
  });

  render(<OfflineManifestView />);
  expect(await screen.findByText("Dana Divemaster")).toBeInTheDocument();
  await waitFor(() => expect(syncOfflineManifest).toHaveBeenCalledWith("trip-1", "blue-mantis"));

  const lookupsBeforeMismatch = identityLookups;
  mismatch = true;
  deferNextIdentity = true;
  await act(async () => window.dispatchEvent(new Event("online")));
  await waitFor(() => expect(identityLookups).toBeGreaterThan(lookupsBeforeMismatch));
  await waitFor(() => expect(resolveDeferredIdentity).not.toBeNull());
  await act(async () => rejectSync(new OfflineManifestError("shop_changed")));
  expect(
    await screen.findByRole("heading", { name: "Checking this device’s shop" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Dana Divemaster")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /board/i })).not.toBeInTheDocument();
  expect(screen.getByRole("status").textContent).toContain("Pending changes remain saved");
  expect(saved.events[0]?.syncStatus).toBe("pending");

  // The pre-mismatch lookup resolves with stale Shop A after invalidation; it
  // must not cache A or release quarantine. A failed fresh lookup stays hidden.
  await act(async () => resolveDeferredIdentity?.(identityResponse("blue-mantis")));
  expect(screen.getByRole("heading", { name: "Checking this device’s shop" })).toBeInTheDocument();
  allowShopB = true;
  await act(async () => window.dispatchEvent(new Event("online")));
  await waitFor(() => expect(purgeOfflineManifestsExceptShop).toHaveBeenCalledWith("reef-runners"));
  expect(
    await screen.findByRole("heading", { name: "This trip isn’t available here" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Dana Divemaster")).not.toBeInTheDocument();
  expect(syncOfflineManifest).toHaveBeenCalledTimes(1);
  expect(saved.events[0]?.syncStatus).toBe("pending");
  expect(readDiscardedOfflineRecords).toHaveBeenCalled();
});
