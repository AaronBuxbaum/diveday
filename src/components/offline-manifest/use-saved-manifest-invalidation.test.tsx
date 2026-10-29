// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfflineManifestTranslator } from "@/i18n/offline-manifest-messages";
import {
  acknowledgeDiscardedOfflineRecords,
  listOfflineManifests,
  loadOfflineManifest,
  readDiscardedOfflineRecords,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";
import { useSavedManifest } from "./use-saved-manifest";
import { envelope, setOnline } from "./view-fixtures";

const search = vi.hoisted(() => ({ params: new URLSearchParams() }));
const tenant = vi.hoisted(() => ({
  slug: "blue-mantis" as string | null,
  setVerified: (_slug: string | null) => {},
}));
const purgeState = vi.hoisted(() => ({
  latest: null as null | { onTenantVerified: (slug: string) => void },
}));

vi.mock("next/navigation", () => ({ useSearchParams: () => search.params }));
vi.mock("@/lib/offline-manifest-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline-manifest-store")>();
  return {
    ...actual,
    acknowledgeDiscardedOfflineRecords: vi.fn(),
    listOfflineManifests: vi.fn(),
    loadOfflineManifest: vi.fn(),
    readDiscardedOfflineRecords: vi.fn(),
    syncOfflineManifest: vi.fn(),
  };
});
vi.mock("./use-cross-shop-purge", () => ({
  useCrossShopPurge: (options: typeof purgeState.latest) => {
    if (options) purgeState.latest = options;
  },
}));
vi.mock("./use-offline-tenant", () => {
  const tenantSlugRef: { current: string | null } = { current: null };
  tenant.setVerified = (slug) => {
    tenantSlugRef.current = slug;
  };
  const resolveTenant = async () => {
    tenantSlugRef.current = tenant.slug;
    return tenant.slug;
  };
  const invalidateTenantLookup = () => {
    tenantSlugRef.current = null;
  };
  return {
    useOfflineTenant: () => ({
      tenantSlugRef,
      resolveTenant,
      invalidateTenantLookup,
    }),
  };
});

const list = vi.mocked(listOfflineManifests);
const load = vi.mocked(loadOfflineManifest);
const readDiscarded = vi.mocked(readDiscardedOfflineRecords);
const t = ((key: string) => key) as unknown as OfflineManifestTranslator;

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
      (channel) => channel !== this,
    );
  }
}

function at(query: string) {
  search.params = new URLSearchParams(query);
  return renderHook(() => useSavedManifest(t));
}

function pendingForeignEnvelope(): OfflineManifestEnvelope {
  const saved = envelope("trip-foreign", "Private trip title", { shopSlug: "shop-a" });
  saved.events = [{ syncStatus: "pending" }] as unknown as OfflineManifestEnvelope["events"];
  return saved;
}

beforeEach(() => {
  vi.mocked(acknowledgeDiscardedOfflineRecords).mockResolvedValue(undefined);
  list.mockReset().mockResolvedValue([]);
  load.mockReset();
  readDiscarded.mockReset().mockResolvedValue([]);
  vi.mocked(syncOfflineManifest).mockReset();
  tenant.slug = "blue-mantis";
  tenant.setVerified(null);
  purgeState.latest = null;
  setOnline(false);
});

afterEach(() => {
  cleanup();
  TestBroadcastChannel.channels = [];
  vi.unstubAllGlobals();
});

describe("selected-trip invalidation", () => {
  it("refreshes pending inventory after a worker changes a selected foreign trip", async () => {
    vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
    const selected = envelope("trip-foreign", "Private trip title", { shopSlug: "shop-a" });
    const newlyPending = pendingForeignEnvelope();
    load
      .mockResolvedValueOnce(selected)
      .mockResolvedValueOnce(selected)
      .mockResolvedValue(newlyPending);
    const { result } = at("trip=trip-foreign");
    await waitFor(() => expect(result.current.envelope).toBe(selected));

    act(() => purgeState.latest?.onTenantVerified("blue-mantis"));
    await waitFor(() => expect(result.current.verifiedTenantSlug).toBe("blue-mantis"));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    const inventoryReads = list.mock.calls.length;

    list.mockResolvedValue([newlyPending]);
    const worker = new TestBroadcastChannel("diveday-offline-manifest-changes-v1");
    act(() => worker.postMessage({ tripId: "trip-foreign" }));

    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(inventoryReads));
    await waitFor(() => expect(result.current.foreignPendingChanges).toBe(true));
    expect(result.current.message).not.toContain("shop-a");
    expect(result.current.message).not.toContain("Private trip title");
    worker.close();
  });

  it("masks existing notes before a notified reread can fail", async () => {
    const stale = envelope("trip-1", "Morning Two-Tank");
    stale.events = [
      {
        clientEventId: "roll-call-abcdef12",
        snapshotId: stale.snapshot.snapshotId,
        snapshotSavedAt: stale.snapshot.savedAt,
        tripId: "trip-1",
        bookingId: "11111111-2222-3333-4444-abcdef12",
        checkpoint: "after_dive_1",
        status: "boarded",
        occurredAt: "2026-08-01T14:30:00.000Z",
        syncStatus: "applied",
        note: "Nora Quinn checked in",
      },
    ];
    stale.checklistEvents = [
      {
        clientEventId: "checklist-abcdef12",
        snapshotId: stale.snapshot.snapshotId,
        snapshotSavedAt: stale.snapshot.savedAt,
        tripId: "trip-1",
        checklistItemId: "check-1",
        status: "checked",
        occurredAt: "2026-08-01T14:31:00.000Z",
        syncStatus: "applied",
        note: "Nora Quinn checked the kit",
      },
    ];
    let rejectReload: (error: Error) => void = () => {};
    load.mockResolvedValueOnce(stale).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectReload = reject;
        }),
    );
    const { result } = at("trip=trip-1");
    await waitFor(() =>
      expect(result.current.envelope?.events[0]?.note).toBe("Nora Quinn checked in"),
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent("diveday-offline-manifest-change", { detail: { tripId: "trip-1" } }),
      );
    });
    expect(result.current.envelope?.events[0]?.note).toBeNull();

    await act(async () => rejectReload(new Error("indexeddb unavailable")));
    await waitFor(() => expect(result.current.storeReadFailed).toBe(true));
    expect(result.current.envelope?.events[0]).toMatchObject({
      note: null,
      status: "boarded",
      occurredAt: "2026-08-01T14:30:00.000Z",
    });
    expect(result.current.envelope?.checklistEvents[0]).toMatchObject({
      note: null,
      status: "checked",
      occurredAt: "2026-08-01T14:31:00.000Z",
    });
    expect(result.current.message).toBe("shared.offlineManifest.reconcile.singleLoadError");
  });

  it("settles a cold load when an invalidation supersedes it and the reload fails", async () => {
    const stale = envelope("trip-1", "Morning Two-Tank");
    stale.events = [
      {
        clientEventId: "roll-call-abcdef12",
        snapshotId: stale.snapshot.snapshotId,
        snapshotSavedAt: stale.snapshot.savedAt,
        tripId: "trip-1",
        bookingId: "11111111-2222-3333-4444-abcdef12",
        checkpoint: "after_dive_1",
        status: "boarded",
        occurredAt: "2026-08-01T14:30:00.000Z",
        syncStatus: "applied",
        note: "Nora Quinn checked in",
      },
    ];
    let resolveInitial: (saved: OfflineManifestEnvelope) => void = () => {};
    let rejectReload: (error: Error) => void = () => {};
    load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInitial = resolve;
        }),
    );
    load.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectReload = reject;
        }),
    );
    const { result } = at("trip=trip-1");
    expect(result.current.storeRead).toBe(false);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("diveday-offline-manifest-change", { detail: { tripId: "trip-1" } }),
      );
    });
    expect(result.current.envelope).toBeNull();

    await act(async () => rejectReload(new Error("indexeddb unavailable")));
    await waitFor(() => expect(result.current.storeReadFailed).toBe(true));
    expect(result.current.storeRead).toBe(true);
    expect(result.current.message).toBe("shared.offlineManifest.reconcile.singleLoadError");

    // The superseded cold read completing late cannot replace the recovery
    // state or restore the note masked when the invalidation arrived.
    await act(async () => resolveInitial(stale));
    expect(result.current.storeRead).toBe(true);
    expect(result.current.storeReadFailed).toBe(true);
    expect(result.current.envelope).toBeNull();
  });
});
