// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { syncOfflineManifest } from "@/lib/offline-manifest-store";
import { useSavedManifestList } from "./use-saved-manifest-list";
import { envelope, setOnline } from "./view-fixtures";

vi.mock("@/lib/offline-manifest-store", () => ({
  syncOfflineManifest: vi.fn(),
  readOfflineManifestInventory: vi.fn(),
  subscribeOfflineManifestChanges: vi.fn(() => () => {}),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

for (const scenario of ["same-round", "newer-verified", "newer-pending"] as const) {
  it(`handles a delayed tenant refusal after ${scenario} refresh`, async () => {
    setOnline(true);
    let reject!: (error: unknown) => void;
    vi.mocked(syncOfflineManifest).mockReturnValue(
      new Promise((_, failure) => {
        reject = failure;
      }),
    );
    let round = 1;
    let current = true;
    const changed = vi.fn();
    const saved = envelope("trip-1", "Trip");
    saved.events = [
      {
        clientEventId: "event-1",
        snapshotId: saved.snapshot.snapshotId,
        snapshotSavedAt: saved.snapshot.savedAt,
        tripId: "trip-1",
        bookingId: "booking-1",
        checkpoint: "departure",
        status: "boarded",
        occurredAt: saved.snapshot.savedAt,
        syncStatus: "pending",
      },
    ];
    const tenantSlugRef = { current: "blue-mantis" as string | null };
    const { result } = renderHook(() =>
      useSavedManifestList({
        tenantSlugRef,
        getTenantRound: () => round,
        initialListMessage: () => "",
        reconciledListMessage: () => "",
        setList: () => {},
        setMessage: () => {},
        handleTenantChanged: changed,
      }),
    );
    let finished!: Promise<void>;
    act(() => {
      finished = result.current([saved], "blue-mantis", false, () => current);
    });
    await waitFor(() => expect(syncOfflineManifest).toHaveBeenCalledOnce());
    current = false;
    if (scenario !== "same-round") round = 2;
    if (scenario === "newer-pending") tenantSlugRef.current = null;
    await act(async () => {
      reject({ code: "shop_changed" });
      await finished;
    });
    expect(changed).toHaveBeenCalledTimes(scenario === "newer-verified" ? 0 : 1);
  });
}
