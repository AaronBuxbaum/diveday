// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listOfflineManifests,
  loadOfflineManifest,
  purgeOfflineManifestsExceptShop,
} from "@/lib/offline-manifest-store";
import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";
import { useCrossShopPurge } from "./use-cross-shop-purge";
import { envelope } from "./view-fixtures";

vi.mock("@/lib/offline-manifest-store", () => ({
  listOfflineManifests: vi.fn(),
  loadOfflineManifest: vi.fn(),
  purgeOfflineManifestsExceptShop: vi.fn(),
}));

const list = vi.mocked(listOfflineManifests);
const load = vi.mocked(loadOfflineManifest);
const purge = vi.mocked(purgeOfflineManifestsExceptShop);

/**
 * The hook's collaborators, each a spy. `tenantSlugRef` starts holding a stale
 * answer so a test can see the round clear it before asking again.
 */
function setup(tripId: string, tenant: string | null) {
  const props = {
    tripId,
    tenantSlugRef: { current: "stale-shop" as string | null },
    resolveTenant: vi.fn(async () => tenant),
    dispatchSaved: vi.fn(),
    setList: vi.fn(),
    onListPurged: vi.fn(),
    onTenantVerified: vi.fn(),
    onTripPurged: vi.fn(),
    refreshDiscarded: vi.fn(),
    tenantChangeRevision: 0,
  };
  const hook = renderHook(() => useCrossShopPurge(props));
  return { props, ...hook };
}

/** Run the `setList` updater the round handed over against `current`. */
function listAfter(
  setList: ReturnType<typeof vi.fn>,
  current: OfflineManifestEnvelope[] | null,
): OfflineManifestEnvelope[] | null {
  const updater = setList.mock.calls.at(-1)?.[0] as (
    value: OfflineManifestEnvelope[] | null,
  ) => OfflineManifestEnvelope[] | null;
  return updater(current);
}

beforeEach(() => {
  list.mockReset();
  load.mockReset();
  purge.mockReset();
  purge.mockResolvedValue([]);
  list.mockResolvedValue([]);
  load.mockResolvedValue(null);
});

afterEach(cleanup);

describe("useCrossShopPurge", () => {
  it("re-asks the tenant every round instead of trusting the cached answer", async () => {
    const { props } = setup("", "blue-mantis");
    expect(props.tenantSlugRef.current).toBeNull();
    await waitFor(() => expect(props.resolveTenant).toHaveBeenCalledTimes(1));
    expect(props.onTenantVerified).toHaveBeenCalledWith("blue-mantis");
  });

  it("re-verifies and purges again after a sync detects a shop switch", async () => {
    const { props, rerender } = setup("", "reef-runners");
    await waitFor(() => expect(props.resolveTenant).toHaveBeenCalledTimes(1));
    props.tenantChangeRevision = 1;
    rerender();
    await waitFor(() => expect(props.resolveTenant).toHaveBeenCalledTimes(2));
    expect(props.onTenantVerified).toHaveBeenLastCalledWith("reef-runners");
    expect(purge).toHaveBeenLastCalledWith(
      "reef-runners",
      expect.objectContaining({ isCurrent: expect.any(Function) }),
    );
  });

  it("purges nothing and repaints nothing when no shop is signed in", async () => {
    const { props } = setup("", null);
    await waitFor(() => expect(props.resolveTenant).toHaveBeenCalled());
    await act(async () => {});
    expect(purge).not.toHaveBeenCalled();
    expect(props.setList).not.toHaveBeenCalled();
    expect(props.dispatchSaved).not.toHaveBeenCalled();
    expect(props.refreshDiscarded).not.toHaveBeenCalled();
  });

  it("on the list, keeps only the signed-in shop's copies and repaints from the store", async () => {
    const kept = [envelope("trip-1", "Morning Two-Tank")];
    list.mockResolvedValue(kept);
    const { props } = setup("", "blue-mantis");
    await waitFor(() => expect(props.refreshDiscarded).toHaveBeenCalledTimes(1));
    expect(purge).toHaveBeenCalledWith(
      "blue-mantis",
      expect.objectContaining({ isCurrent: expect.any(Function) }),
    );
    // A list already painted is replaced; one not yet read stays unread, so the
    // purge can never assert "nothing saved" before the store was opened.
    expect(listAfter(props.setList, [])).toBe(kept);
    expect(listAfter(props.setList, null)).toBeNull();
    expect(props.onListPurged).toHaveBeenCalledWith(kept, "blue-mantis");
  });

  it("keeps the list it already painted when the re-read fails", async () => {
    list.mockRejectedValue(new Error("store unreadable"));
    const { props } = setup("", "blue-mantis");
    await waitFor(() => expect(props.refreshDiscarded).toHaveBeenCalledTimes(1));
    expect(props.setList).not.toHaveBeenCalled();
  });

  it("on a trip, reports the copy gone under this tenant when the store answers that it is", async () => {
    load.mockResolvedValue(null);
    const { props } = setup("trip-1", "blue-mantis");
    await waitFor(() => expect(props.refreshDiscarded).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenCalledWith("trip-1");
    expect(props.dispatchSaved).toHaveBeenCalledWith({ type: "gone", tenant: "blue-mantis" });
    expect(props.onTripPurged).toHaveBeenCalledTimes(1);
    expect(list).not.toHaveBeenCalled();
  });

  it("marks a selected copy as removed by another shop when this purge deleted it", async () => {
    purge.mockResolvedValue(["trip-1"]);
    load.mockResolvedValue(null);
    const { props } = setup("trip-1", "blue-mantis");
    await waitFor(() => expect(props.refreshDiscarded).toHaveBeenCalledTimes(1));
    expect(props.dispatchSaved).toHaveBeenCalledWith({
      type: "gone",
      tenant: "blue-mantis",
      removedForOtherShop: true,
    });
    expect(props.onTripPurged).toHaveBeenCalledTimes(1);
  });

  it("on a trip, says nothing when the copy survived the purge", async () => {
    load.mockResolvedValue(envelope("trip-1", "Morning Two-Tank"));
    const { props } = setup("trip-1", "blue-mantis");
    await waitFor(() => expect(props.refreshDiscarded).toHaveBeenCalledTimes(1));
    expect(props.dispatchSaved).not.toHaveBeenCalled();
  });

  it("on a trip, never blanks the roster on a failed read", async () => {
    load.mockRejectedValue(new Error("decrypt failed"));
    const { props } = setup("trip-1", "blue-mantis");
    await waitFor(() => expect(props.refreshDiscarded).toHaveBeenCalledTimes(1));
    expect(props.dispatchSaved).not.toHaveBeenCalled();
  });

  it("changes nothing on screen when the purge itself throws", async () => {
    purge.mockRejectedValue(new Error("quota"));
    const { props } = setup("trip-1", "blue-mantis");
    await waitFor(() => expect(purge).toHaveBeenCalled());
    await act(async () => {});
    expect(load).not.toHaveBeenCalled();
    expect(props.dispatchSaved).not.toHaveBeenCalled();
    expect(props.refreshDiscarded).not.toHaveBeenCalled();
  });

  it("invalidates an older purge as soon as a newer verification round starts", async () => {
    let releaseOldPurge!: (ids: string[]) => void;
    purge
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseOldPurge = resolve;
          }),
      )
      .mockResolvedValueOnce([]);
    const { props } = setup("trip-1", "reef-runners");
    await waitFor(() => expect(purge).toHaveBeenCalledTimes(1));
    const oldGuard = purge.mock.calls[0][1]?.isCurrent;
    expect(oldGuard?.()).toBe(true);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(purge).toHaveBeenCalledTimes(2));
    const newGuard = purge.mock.calls[1][1]?.isCurrent;

    expect(oldGuard?.()).toBe(false);
    expect(newGuard?.()).toBe(true);
    releaseOldPurge(["trip-1"]);
    await act(async () => {});
    // Only the current round's empty read may report the missing copy; the
    // stale round's deletion result must not attach a foreign-purge reason.
    expect(props.dispatchSaved).toHaveBeenCalledTimes(1);
    expect(props.dispatchSaved).toHaveBeenCalledWith({ type: "gone", tenant: "reef-runners" });
    expect(props.onTripPurged).toHaveBeenCalledTimes(1);
  });

  it("runs another round on every reconnect", async () => {
    list.mockResolvedValue([]);
    const { props } = setup("", "blue-mantis");
    await waitFor(() => expect(props.refreshDiscarded).toHaveBeenCalledTimes(1));
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(props.refreshDiscarded).toHaveBeenCalledTimes(2));
    expect(purge).toHaveBeenCalledTimes(2);
  });

  it("reports nothing once unmounted, and stops listening for reconnects", async () => {
    let answer: (slug: string | null) => void = () => {};
    const { props, unmount } = setup("trip-1", null);
    props.resolveTenant.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          answer = resolve;
        }),
    );
    // The first round already asked (and got null); a reconnect asks again and
    // is still waiting when the view goes away.
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    unmount();
    await act(async () => answer("blue-mantis"));
    expect(purge).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("online"));
    expect(props.resolveTenant).toHaveBeenCalledTimes(2);
  });
});
