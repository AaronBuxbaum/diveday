// @vitest-environment jsdom
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { offlineManifestTranslator } from "@/i18n/offline-manifest-messages";
import {
  listOfflineManifests,
  loadOfflineManifest,
  purgeOfflineManifestsExceptShop,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import type {
  OfflineChecklistEvent,
  OfflineManifestEnvelope,
  OfflineRollCallEvent,
} from "@/lib/offline-manifests";
import { pendingOfflineEventCount } from "@/lib/offline-manifests";
import { OfflineManifestList } from "./ManifestList";
import { useSavedManifest } from "./use-saved-manifest";
import { envelope, setOnline } from "./view-fixtures";

const search = vi.hoisted(() => ({ params: new URLSearchParams() }));
const identity = vi.hoisted(() => ({
  resolver: null as ((slug: string | null) => void) | null,
}));

vi.mock("next/navigation", () => ({ useSearchParams: () => search.params }));
vi.mock("@/lib/offline-manifest-store", () => ({
  acknowledgeDiscardedOfflineRecords: vi.fn(),
  getActiveOfflineShellVersion: vi.fn().mockResolvedValue(null),
  listOfflineManifests: vi.fn(),
  loadOfflineManifest: vi.fn(),
  purgeOfflineManifestsExceptShop: vi.fn(),
  readDiscardedOfflineRecords: vi.fn().mockResolvedValue([]),
  subscribeOfflineManifestChanges: vi.fn(() => () => {}),
  syncOfflineManifest: vi.fn(),
}));
vi.mock("@/lib/offline-manifests", async (original) => ({
  ...(await original<typeof import("@/lib/offline-manifests")>()),
  fetchOfflineManifestShopSlug: vi.fn(
    () => new Promise<string | null>((resolve) => (identity.resolver = resolve)),
  ),
}));

const listStore = vi.mocked(listOfflineManifests);
const loadStore = vi.mocked(loadOfflineManifest);
const purgeStore = vi.mocked(purgeOfflineManifestsExceptShop);
const syncStore = vi.mocked(syncOfflineManifest);
const locale = "en-US" as const;
const t = offlineManifestTranslator(locale);
let stored: OfflineManifestEnvelope[] = [];

function withDiscardedNote(tripId: string, shopSlug: string, reference: string) {
  const saved = envelope(tripId, "Synthetic saved trip", { shopSlug });
  const common = {
    snapshotId: saved.snapshot.snapshotId,
    snapshotSavedAt: saved.snapshot.savedAt,
    tripId,
    occurredAt: "2026-08-01T14:30:00.000Z",
    syncStatus: "applied" as const,
    note: null,
    noteDisposition: "discarded_erasure_cutoff" as const,
  };
  saved.events = [
    {
      ...common,
      clientEventId: `roll-${reference}`,
      bookingId: `booking-${reference}`,
      checkpoint: "departure",
      status: "boarded",
    },
  ] satisfies OfflineRollCallEvent[];
  saved.checklistEvents = [
    {
      ...common,
      clientEventId: `check-${reference}`,
      checklistItemId: `checklist-${reference}`,
      status: "checked",
    },
  ] satisfies OfflineChecklistEvent[];
  return saved;
}

function RootList() {
  const saved = useSavedManifest(t);
  return (
    <OfflineManifestList
      t={t}
      shellVersionCopy={{ staleBanner: "", updateBanner: "", refreshButton: "" }}
      list={saved.list}
      message={saved.message}
      discardNotice={null}
    />
  );
}

function mountRootList() {
  return render(<RootList />);
}

beforeEach(() => {
  stored = [];
  identity.resolver = null;
  listStore.mockReset().mockImplementation(async () => stored);
  loadStore
    .mockReset()
    .mockImplementation(
      async (tripId) =>
        stored.find((saved) => saved.snapshot.manifests[0]?.trip.id === tripId) ?? null,
    );
  purgeStore.mockReset().mockImplementation(async (shopSlug) => {
    const removedTripIds = stored
      .filter(
        (saved) => saved.snapshot.shop.slug !== shopSlug && pendingOfflineEventCount(saved) === 0,
      )
      .map((saved) => saved.snapshot.manifests[0]?.trip.id)
      .filter((tripId): tripId is string => Boolean(tripId));
    stored = stored.filter(
      (saved) => saved.snapshot.shop.slug === shopSlug || pendingOfflineEventCount(saved) > 0,
    );
    return removedTripIds;
  });
  syncStore.mockReset().mockResolvedValue(null);
  setOnline(false);
  search.params = new URLSearchParams();
});

afterEach(cleanup);

describe("root-list note loss and cross-shop purge", () => {
  it("shows offline references, then only the verified shop after purge and reload", async () => {
    const foreign = withDiscardedNote("foreign-trip-12345678", "other-shop", "FOREIGN1");
    const current = withDiscardedNote("current-trip-87654321", "blue-mantis", "LOCAL001");
    stored = [foreign, current];

    const first = mountRootList();
    await waitFor(() => expect(first.container.textContent).toContain("Synthetic saved trip"));
    // Product policy accepts non-name, non-note-text references on a shared
    // device until its server-verified shop is available.
    expect(first.container.textContent).toContain("LOCAL001");
    expect(first.container.textContent).toContain("FOREIGN1");
    expect(first.container.textContent).not.toContain("discarded private note");

    setOnline(true);
    await act(async () => identity.resolver?.("blue-mantis"));
    await waitFor(() => expect(purgeStore).toHaveBeenCalledWith("blue-mantis"));
    await waitFor(() => expect(stored).toEqual([current]));
    await waitFor(() => expect(first.container.textContent).not.toContain("FOREIGN1"));
    expect(first.container.textContent).toContain("LOCAL001");
    expect(first.container.textContent).not.toContain("foreign-trip-12345678");

    first.unmount();
    identity.resolver = null;
    const afterReload = mountRootList();
    await act(async () => identity.resolver?.("blue-mantis"));
    await waitFor(() => expect(afterReload.container.textContent).toContain("LOCAL001"));
    expect(afterReload.container.textContent).not.toContain("FOREIGN1");
    expect(afterReload.container.textContent).not.toContain("foreign-trip-12345678");
  });

  it("keeps only current-shop loss visible after partial sync while another trip waits", async () => {
    setOnline(true);
    const pending = envelope("current-trip-12345678", "Current synthetic title", {
      shopSlug: "blue-mantis",
      events: [
        {
          clientEventId: "pending-local",
          snapshotId: "pending-snapshot",
          snapshotSavedAt: new Date(0).toISOString(),
          tripId: "current-trip-12345678",
          bookingId: "booking-local",
          checkpoint: "departure",
          status: "boarded",
          note: "synthetic pending note",
          occurredAt: new Date(0).toISOString(),
          syncStatus: "pending",
        },
      ],
    });
    const waiting = envelope("current-trip-11112222", "Another current trip", {
      shopSlug: "blue-mantis",
      events: [
        {
          clientEventId: "pending-waiting",
          snapshotId: "waiting-snapshot",
          snapshotSavedAt: new Date(0).toISOString(),
          tripId: "current-trip-11112222",
          bookingId: "booking-waiting",
          checkpoint: "departure",
          status: "not_boarded",
          note: null,
          occurredAt: new Date(0).toISOString(),
          syncStatus: "pending",
        },
      ],
    });
    const foreign = withDiscardedNote("foreign-trip-87654321", "other-shop", "FOREIGN1");
    stored = [pending, waiting, foreign];
    const synced = withDiscardedNote("current-trip-12345678", "blue-mantis", "LOCAL001");
    syncStore.mockImplementation(async (tripId) => {
      if (tripId === "current-trip-12345678") {
        stored = stored.map((saved) =>
          saved.snapshot.manifests[0]?.trip.id === tripId ? synced : saved,
        );
        return synced;
      }
      throw new Error("temporary failure");
    });

    const mounted = mountRootList();
    await act(async () => identity.resolver?.("blue-mantis"));
    await waitFor(() =>
      expect(syncStore).toHaveBeenCalledWith("current-trip-12345678", "blue-mantis"),
    );
    await waitFor(() => expect(mounted.container.textContent).toContain("LOCAL001"));
    expect(mounted.container.textContent).not.toContain("FOREIGN1");
    expect(mounted.container.textContent).not.toContain("foreign-trip-87654321");
    expect(mounted.container.textContent).toContain(
      t("shared.offlineManifest.reconcile.pendingWaiting", { count: 1 }),
    );
  });

  it("keeps the saved list and trip copy openable offline when no tenant identity can be fetched", async () => {
    const current = withDiscardedNote("current-trip-22223333", "blue-mantis", "OFFLINE01");
    stored = [current];
    const root = mountRootList();
    await waitFor(() =>
      expect(root.container.querySelector("a[href*='current-trip-22223333']")).not.toBeNull(),
    );
    await waitFor(() => expect(identity.resolver).not.toBeNull());
    await act(async () => identity.resolver?.(null));
    identity.resolver = null;

    expect(purgeStore).not.toHaveBeenCalled();
    expect(root.container.textContent).toContain("Synthetic saved trip");
    expect(root.container.textContent).toContain("FFLINE01");
    root.unmount();

    search.params = new URLSearchParams("trip=current-trip-22223333");
    const opened = renderHook(() => useSavedManifest(t));
    await waitFor(() => expect(identity.resolver).not.toBeNull());
    await act(async () => identity.resolver?.(null));
    await waitFor(() => expect(opened.result.current.envelope).toBe(current));
    expect(opened.result.current.tripId).toBe("current-trip-22223333");
    expect(opened.result.current.tripNoteLossMessage).toContain("FFLINE01");
    expect(opened.result.current.tripNoteLossMessage).not.toContain("discarded private note");
    expect(loadStore).toHaveBeenCalledWith("current-trip-22223333");
  });

  it("removes a selected foreign trip's visible references after online purge", async () => {
    const foreign = withDiscardedNote("foreign-trip-44445555", "other-shop", "FOREIGN3");
    stored = [foreign];
    search.params = new URLSearchParams("trip=foreign-trip-44445555");
    const opened = renderHook(() => useSavedManifest(t));
    await waitFor(() => expect(opened.result.current.tripNoteLossMessage).toContain("FOREIGN3"));
    expect(opened.result.current.envelope).toBe(foreign);

    setOnline(true);
    await act(async () => identity.resolver?.("blue-mantis"));
    await waitFor(() => expect(stored).toEqual([]));
    await waitFor(() => expect(opened.result.current.envelope).toBeNull());
    expect(opened.result.current.tripNoteLossMessage).toBe("");
  });

  it("hides verified-foreign references even when pending evidence keeps the saved copy", async () => {
    const foreign = withDiscardedNote("foreign-trip-55556666", "other-shop", "FOREIGN4");
    foreign.events.push({
      clientEventId: "foreign-pending",
      snapshotId: foreign.snapshot.snapshotId,
      snapshotSavedAt: foreign.snapshot.savedAt,
      tripId: "foreign-trip-55556666",
      bookingId: "pending-foreign-booking",
      checkpoint: "departure",
      status: "not_boarded",
      note: null,
      occurredAt: new Date(0).toISOString(),
      syncStatus: "pending",
    });
    stored = [foreign];
    search.params = new URLSearchParams("trip=foreign-trip-55556666");
    const opened = renderHook(() => useSavedManifest(t));
    await waitFor(() => expect(opened.result.current.tripNoteLossMessage).toContain("FOREIGN4"));
    await waitFor(() => expect(identity.resolver).not.toBeNull());
    await act(async () => identity.resolver?.(null));

    setOnline(true);
    identity.resolver = null;
    await act(async () => window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(identity.resolver).not.toBeNull());
    await act(async () => identity.resolver?.("blue-mantis"));
    await waitFor(() => expect(opened.result.current.tripNoteLossMessage).toBe(""));
    expect(opened.result.current.envelope).toBe(foreign);
    expect(stored).toEqual([foreign]);
    expect(purgeStore).toHaveBeenCalledWith("blue-mantis");
  });

  it("clears a selected foreign trip's notice when online purge wins a load race", async () => {
    setOnline(true);
    const foreign = withDiscardedNote("foreign-trip-33334444", "other-shop", "FOREIGN2");
    stored = [foreign];
    let resolveStaleLoad: ((value: OfflineManifestEnvelope | null) => void) | undefined;
    loadStore.mockImplementationOnce(() => new Promise((resolve) => (resolveStaleLoad = resolve)));
    search.params = new URLSearchParams("trip=foreign-trip-33334444");
    const opened = renderHook(() => useSavedManifest(t));
    await waitFor(() => expect(identity.resolver).not.toBeNull());
    await act(async () => identity.resolver?.("blue-mantis"));
    await waitFor(() => expect(purgeStore).toHaveBeenCalledWith("blue-mantis"));
    await waitFor(() => expect(stored).toEqual([]));
    await waitFor(() => expect(opened.result.current.removedForOtherShop).toBe(true));

    await act(async () => resolveStaleLoad?.(foreign));
    expect(opened.result.current.envelope).toBeNull();
    expect(opened.result.current.tripNoteLossMessage).toBe("");
  });
});
