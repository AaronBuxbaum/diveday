// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfflineManifestTranslator } from "@/i18n/offline-manifest-messages";
import {
  acknowledgeDiscardedOfflineRecords,
  type DiscardedOfflineRecord,
  listOfflineManifests,
  loadOfflineManifest,
  OfflineManifestError,
  readDiscardedOfflineRecords,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import type {
  OfflineChecklistEvent,
  OfflineManifestEnvelope,
  OfflineRollCallEvent,
} from "@/lib/offline-manifests";
import { useSavedManifest } from "./use-saved-manifest";
import { envelope, setOnline } from "./view-fixtures";

const search = vi.hoisted(() => ({ params: new URLSearchParams() }));
const tenant = vi.hoisted(() => ({
  slug: "blue-mantis" as string | null,
  setVerified: (_slug: string | null) => {},
}));
const purgeState = vi.hoisted(() => ({
  latest: null as null | { tenantChangeRevision: number; onTenantVerified: (slug: string) => void },
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
// The purge round has its own tests (`use-cross-shop-purge.test.tsx`).
vi.mock("./use-cross-shop-purge", () => ({
  useCrossShopPurge: (options: typeof purgeState.latest) => {
    if (options) purgeState.latest = options;
  },
}));
vi.mock("./use-offline-tenant", () => {
  const tenantSlugRef: { current: string | null } = { current: null };
  const getTenantRound = () => 1;
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
      getTenantRound,
      resolveTenant,
      invalidateTenantLookup,
    }),
  };
});

const acknowledge = vi.mocked(acknowledgeDiscardedOfflineRecords);
const list = vi.mocked(listOfflineManifests);
const load = vi.mocked(loadOfflineManifest);
const readDiscarded = vi.mocked(readDiscardedOfflineRecords);
const sync = vi.mocked(syncOfflineManifest);

/** The key, and its values when it has any: enough to tell every status line apart. */
const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key} ${JSON.stringify(values)}` : key) as unknown as OfflineManifestTranslator;
const line = (key: string) => `shared.offlineManifest.reconcile.${key}`;

/** A saved copy with `pending` and `rejected` roll-call events waiting on the server. */
function withEvents(
  tripId: string,
  counts: { pending?: number; rejected?: number },
  shopSlug = "blue-mantis",
): OfflineManifestEnvelope {
  const events = [
    ...Array.from({ length: counts.pending ?? 0 }, () => ({ syncStatus: "pending" })),
    ...Array.from({ length: counts.rejected ?? 0 }, () => ({ syncStatus: "rejected" })),
  ] as unknown as OfflineManifestEnvelope["events"];
  return envelope(tripId, `Trip ${tripId}`, { events, shopSlug });
}

function withDiscardedNotes(tripId: string, suffix: string): OfflineManifestEnvelope {
  const saved = envelope(tripId, `Trip ${tripId}`);
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
      clientEventId: `roll-call-${suffix}`,
      bookingId: `11111111-2222-3333-4444-${suffix}`,
      checkpoint: "after_dive_1",
      status: "boarded",
    },
  ] satisfies OfflineRollCallEvent[];
  saved.checklistEvents = [
    {
      ...common,
      clientEventId: `checklist-${suffix}`,
      checklistItemId: "22222222-3333-4444-5555-fedcba98",
      status: "checked",
    },
  ] satisfies OfflineChecklistEvent[];
  return saved;
}

function at(query: string) {
  search.params = new URLSearchParams(query);
  return renderHook(() => useSavedManifest(t));
}

beforeEach(() => {
  for (const mock of [acknowledge, list, load, readDiscarded, sync]) mock.mockReset();
  acknowledge.mockResolvedValue(undefined);
  list.mockResolvedValue([]);
  readDiscarded.mockResolvedValue([]);
  tenant.slug = "blue-mantis";
  tenant.setVerified(null);
  purgeState.latest = null;
  setOnline(false);
});

afterEach(cleanup);

describe("useSavedManifest on a trip", () => {
  it("reloads a selected trip when another tab commits an erasure disposition", async () => {
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
    const erased = withDiscardedNotes("trip-1", "abcdef12");
    load.mockResolvedValueOnce(stale).mockResolvedValueOnce(erased);
    const { result } = at("trip=trip-1");
    await waitFor(() =>
      expect(result.current.envelope?.events[0]?.note).toBe("Nora Quinn checked in"),
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent("diveday-offline-manifest-change", { detail: { tripId: "trip-1" } }),
      );
    });

    await waitFor(() =>
      expect(result.current.envelope?.events[0]).toMatchObject({
        note: null,
        noteDisposition: "discarded_erasure_cutoff",
      }),
    );
    expect(result.current.envelope?.events[0]?.status).toBe("boarded");
    expect(result.current.envelope?.events[0]?.occurredAt).toBe("2026-08-01T14:30:00.000Z");
    expect(result.current.tripNoteLossMessage).toContain("abcdef12");
    expect(result.current.tripNoteLossMessage).not.toContain("Nora Quinn");
  });

  it("claims nothing before the store is read, then shows the saved copy", async () => {
    const saved = envelope("trip-1", "Morning Two-Tank");
    load.mockResolvedValue(saved);
    const { result } = at("trip=trip-1");
    expect(result.current.storeRead).toBe(false);
    expect(result.current.message).toBe("shared.offlineManifest.loadingMessage");
    await waitFor(() => expect(result.current.storeRead).toBe(true));
    expect(result.current.tripId).toBe("trip-1");
    expect(result.current.envelope).toBe(saved);
    expect(result.current.message).toBe(line("ready"));
    expect(readDiscarded).toHaveBeenCalled();
  });

  it("says so when this device holds no copy of the trip", async () => {
    load.mockResolvedValue(null);
    const { result } = at("trip=trip-1");
    await waitFor(() => expect(result.current.storeRead).toBe(true));
    expect(result.current.envelope).toBeNull();
    expect(result.current.message).toBe(line("noneForTrip"));
    expect(result.current.storeReadFailed).toBe(false);
  });

  it("settles on an error line when the store cannot be read", async () => {
    load.mockRejectedValue(new Error("decrypt failed"));
    const { result } = at("trip=trip-1");
    await waitFor(() => expect(result.current.storeRead).toBe(true));
    expect(result.current.message).toBe(line("singleLoadError"));
    expect(result.current.storeReadFailed).toBe(true);
  });

  // Dive-domain review D9: a later read that works clears the failure.
  it("clears the read failure once a later read of another trip succeeds", async () => {
    load.mockRejectedValueOnce(new Error("decrypt failed"));
    const { result, rerender } = at("trip=trip-1");
    await waitFor(() => expect(result.current.storeReadFailed).toBe(true));
    load.mockResolvedValue(envelope("trip-2", "Night Dive"));
    search.params = new URLSearchParams("trip=trip-2");
    rerender();
    await waitFor(() =>
      expect(result.current.envelope?.snapshot.manifests[0]?.trip.id).toBe("trip-2"),
    );
    expect(result.current.storeReadFailed).toBe(false);
  });

  it("keeps a checkpoint from the URL the trip actually has", async () => {
    load.mockResolvedValue(envelope("trip-1", "Morning Two-Tank"));
    const { result } = at("trip=trip-1&checkpoint=after_dive_1");
    expect(result.current.checkpoint).toBe("after_dive_1");
    await waitFor(() => expect(result.current.storeRead).toBe(true));
    expect(result.current.checkpoint).toBe("after_dive_1");
  });

  it("repeats per-subject checkpoint notices after reload without reading stale names or note text", async () => {
    const saved = envelope("trip-1", "Morning Two-Tank", {
      events: [
        {
          clientEventId: "cutoff-one",
          snapshotId: "saved-snapshot",
          snapshotSavedAt: new Date(0).toISOString(),
          tripId: "trip-1",
          bookingId: "11111111-2222-3333-4444-abcdef123456",
          checkpoint: "after_dive_1",
          status: "not_boarded",
          note: "ERASED NAME MUST NOT APPEAR",
          occurredAt: new Date(0).toISOString(),
          syncStatus: "applied",
          noteDisposition: "discarded_erasure_cutoff",
        },
        {
          clientEventId: "unverified-two",
          snapshotId: "saved-snapshot",
          snapshotSavedAt: new Date(0).toISOString(),
          tripId: "trip-1",
          crewPersonId: "22222222-3333-4444-5555-fedcba987654",
          checkpoint: "departure",
          status: "boarded",
          note: null,
          occurredAt: new Date(0).toISOString(),
          syncStatus: "applied",
          noteDisposition: "discarded_unverified_snapshot",
        },
      ],
    });
    saved.checklistEvents.push({
      clientEventId: "checklist-third",
      snapshotId: "snap-trip-1",
      snapshotSavedAt: new Date(0).toISOString(),
      tripId: "trip-1",
      checklistItemId: "22222222-3333-4444-5555-fedcba112233",
      status: "checked",
      note: "CHECKLIST NOTE TEXT MUST NOT APPEAR",
      occurredAt: new Date(0).toISOString(),
      syncStatus: "applied",
      noteDisposition: "discarded_erasure_cutoff",
    });
    load.mockResolvedValue(saved);

    const first = at("trip=trip-1");
    await waitFor(() => expect(first.result.current.storeRead).toBe(true));
    const firstMessage = first.result.current.tripNoteLossMessage;
    expect(firstMessage.split("\n")).toHaveLength(5);
    expect(firstMessage.split("\n").every((line) => line.length > 0)).toBe(true);
    expect(firstMessage).toContain("ef123456");
    expect(firstMessage).toContain("afterDive");
    expect(firstMessage).toContain("ba987654");
    expect(firstMessage).toContain("departure");
    expect(firstMessage).toContain("noteChecklistReference");
    expect(firstMessage).toContain("ba112233");
    expect(firstMessage).toContain("checklistLocation");
    expect(firstMessage).not.toContain("ERASED NAME MUST NOT APPEAR");
    expect(firstMessage).not.toContain("CHECKLIST NOTE TEXT MUST NOT APPEAR");
    expect(firstMessage).not.toContain("Nora Quinn");

    first.unmount();
    const second = at("trip=trip-1");
    await waitFor(() => expect(second.result.current.storeRead).toBe(true));
    expect(second.result.current.tripNoteLossMessage).toBe(firstMessage);
  });

  it("falls back to departure for a checkpoint the saved trip does not have", async () => {
    // The fixture trip plans one dive, so there is no second after-dive count.
    load.mockResolvedValue(envelope("trip-1", "Morning Two-Tank"));
    const { result } = at("trip=trip-1&checkpoint=after_dive_2");
    expect(result.current.checkpoint).toBe("after_dive_2");
    await waitFor(() => expect(result.current.checkpoint).toBe("departure"));
  });

  it("ignores a checkpoint that is not one in shape", () => {
    load.mockReturnValue(new Promise(() => {}));
    const { result } = at("trip=trip-1&checkpoint=bogus");
    expect(result.current.checkpoint).toBe("departure");
  });

  it("syncs with signal and reports every queue caught up", async () => {
    setOnline(true);
    const saved = withEvents("trip-1", { pending: 1 });
    const synced = withEvents("trip-1", {});
    load.mockResolvedValue(saved);
    list.mockResolvedValue([synced]);
    sync.mockResolvedValue(synced);
    const { result } = at("trip=trip-1");
    act(() => purgeState.latest?.onTenantVerified("blue-mantis"));
    await waitFor(() => expect(result.current.message).toBe(line("allCaughtUp")));
    expect(sync).toHaveBeenCalledWith("trip-1", "blue-mantis", 1);
    expect(result.current.envelope).toBe(synced);
  });

  it("keeps the authoritative note-loss notice when late inventory finds a newer pending mark", async () => {
    setOnline(true);
    const initial = withEvents("trip-1", { pending: 1 });
    const syncedWithLoss = withDiscardedNotes("trip-1", "abcdef12");
    const newerPending = withEvents("trip-1", { pending: 1 });
    let resolveInventory: (saved: OfflineManifestEnvelope[]) => void = () => {};
    list.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInventory = resolve;
        }),
    );
    load.mockResolvedValue(initial);
    sync.mockResolvedValue(syncedWithLoss);
    const { result } = at("trip=trip-1");
    await waitFor(() => expect(result.current.storeRead).toBe(true));
    act(() => purgeState.latest?.onTenantVerified("blue-mantis"));
    await act(async () => result.current.reconcile());
    expect(result.current.tripNoteLossMessage).toContain("abcdef12");
    expect(result.current.message).not.toBe(line("allCaughtUp"));

    await act(async () => resolveInventory([newerPending]));
    await waitFor(() => expect(result.current.message).toContain(line("pendingWaiting")));
    expect(result.current.tripNoteLossMessage).toContain("abcdef12");
    expect(result.current.message).not.toBe(line("allCaughtUp"));
  });

  it("replaces caught-up status when reconnect cannot verify the shop after a new mark", async () => {
    setOnline(true);
    tenant.slug = "blue-mantis";
    const initial = withEvents("trip-1", { pending: 1 });
    const synced = withEvents("trip-1", {});
    const newlyPending = withEvents("trip-1", { pending: 1 });
    load.mockResolvedValue(initial);
    list.mockResolvedValue([synced]);
    sync.mockResolvedValue(synced);
    const { result } = at("trip=trip-1");
    act(() => purgeState.latest?.onTenantVerified("blue-mantis"));
    await waitFor(() => expect(result.current.message).toBe(line("allCaughtUp")));

    // A new dock mark is saved locally after the earlier successful sync.
    act(() => result.current.dispatchSaved({ type: "loaded", envelope: newlyPending }));
    load.mockResolvedValue(newlyPending);
    tenant.slug = null;
    const syncCallsBeforeReconnect = sync.mock.calls.length;
    await act(async () => window.dispatchEvent(new Event("online")));

    await waitFor(() => expect(result.current.message).toBe(line("reachError")));
    expect(sync).toHaveBeenCalledTimes(syncCallsBeforeReconnect);
    expect(result.current.envelope?.events[0]?.syncStatus).toBe("pending");
    expect(result.current.message).not.toBe(line("allCaughtUp"));
  });

  it("counts what is still waiting after a sync", async () => {
    setOnline(true);
    const pending = withEvents("trip-1", { pending: 2 });
    load.mockResolvedValue(pending);
    list.mockResolvedValue([pending]);
    sync.mockResolvedValue(pending);
    const { result } = at("trip=trip-1");
    act(() => purgeState.latest?.onTenantVerified("blue-mantis"));
    await waitFor(() =>
      expect(result.current.message).toBe(`${line("pendingWaiting")} {"count":2}`),
    );
  });

  it("puts a refused event ahead of anything still waiting", async () => {
    setOnline(true);
    load.mockResolvedValue(withEvents("trip-1", { pending: 1 }));
    sync.mockResolvedValue(withEvents("trip-1", { pending: 1, rejected: 1 }));
    const { result } = at("trip=trip-1");
    await waitFor(() =>
      expect(result.current.message).toBe(`${line("pendingRejectedSingle")} {"count":1}`),
    );
  });

  it("does not paint a stale tenant response after another shop is verified", async () => {
    setOnline(true);
    const saved = withEvents("trip-1", { pending: 1 });
    load.mockResolvedValue(saved);
    let release: (value: OfflineManifestEnvelope) => void = () => {};
    sync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { result } = at("trip=trip-1");
    await waitFor(() => expect(sync).toHaveBeenCalledWith("trip-1", "blue-mantis", 1));

    tenant.setVerified("reef-runners");
    await act(async () => {
      release(withEvents("trip-1", { rejected: 1 }));
    });

    expect(result.current.envelope?.events[0]?.syncStatus).toBe("pending");
    expect(result.current.message).toBe(line("ready"));
  });

  it("says the server could not be reached when the sync throws", async () => {
    setOnline(true);
    load.mockResolvedValue(withEvents("trip-1", { pending: 1 }));
    sync.mockRejectedValue(new Error("offline after all"));
    const { result } = at("trip=trip-1");
    await waitFor(() => expect(result.current.message).toBe(line("reachError")));
  });

  it("quarantines the saved roster on shop_changed and only restores it after fresh verification", async () => {
    setOnline(true);
    const saved = withEvents("trip-1", { pending: 1 });
    load.mockResolvedValue(saved);
    sync.mockRejectedValue(new OfflineManifestError("shop_changed"));
    const { result } = at("trip=trip-1");

    await waitFor(() => expect(result.current.tenantChangePending).toBe(true));
    expect(result.current.envelope).toBeNull();
    expect(result.current.message).toBe(line("tenantChanged"));
    expect(saved.events[0]?.syncStatus).toBe("pending");
    expect(purgeState.latest?.tenantChangeRevision).toBeGreaterThan(0);

    // If identity re-verification fails, no callback arrives and the old
    // roster remains quarantined. A successful B lookup is the only release.
    expect(result.current.tenantChangePending).toBe(true);
    tenant.slug = "reef-runners";
    await act(async () => purgeState.latest?.onTenantVerified("reef-runners"));
    await waitFor(() => expect(result.current.tenantChangePending).toBe(false));
    expect(result.current.verifiedTenantSlug).toBe("reef-runners");
    expect(result.current.message).toBe("");
    expect(saved.events[0]?.syncStatus).toBe("pending");
  });

  it("never submits another shop's saved events under the signed-in shop", async () => {
    setOnline(true);
    load.mockResolvedValue(withEvents("trip-1", { pending: 1 }, "other-shop"));
    const { result } = at("trip=trip-1");
    await waitFor(() => expect(result.current.storeRead).toBe(true));
    await act(async () => result.current.reconcile());
    expect(sync).not.toHaveBeenCalled();
    expect(result.current.message).toBe(line("ready"));
  });

  it("syncs nothing when it cannot tell which shop is signed in", async () => {
    setOnline(true);
    tenant.slug = null;
    load.mockResolvedValue(withEvents("trip-1", { pending: 1 }));
    const { result } = at("trip=trip-1");
    await waitFor(() => expect(result.current.storeRead).toBe(true));
    await act(async () => result.current.reconcile());
    expect(sync).not.toHaveBeenCalled();
  });

  it("syncs again when signal comes back", async () => {
    const saved = withEvents("trip-1", { pending: 1 });
    const synced = withEvents("trip-1", {});
    load.mockResolvedValue(saved);
    list.mockResolvedValue([synced]);
    sync.mockResolvedValue(synced);
    const { result } = at("trip=trip-1");
    act(() => purgeState.latest?.onTenantVerified("blue-mantis"));
    await waitFor(() => expect(result.current.storeRead).toBe(true));
    expect(sync).not.toHaveBeenCalled();
    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(result.current.message).toBe(line("allCaughtUp")));
  });
});

/**
 * Captain review S2: each roll-call tap asked for its own sync, and on a link
 * that carries nothing each one held the whole deadline, so a boat counted
 * back aboard sent one overlapping POST of the same pending events per name.
 */
describe("useSavedManifest's syncs while one hangs", () => {
  it("runs one at a time, and folds every ask made meanwhile into one more pass", async () => {
    setOnline(true);
    load.mockResolvedValue(withEvents("trip-1", { pending: 3 }));
    list.mockResolvedValue([withEvents("trip-1", {})]);
    let release: (envelope: OfflineManifestEnvelope) => void = () => {};
    sync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    sync.mockResolvedValue(withEvents("trip-1", {}));
    const { result } = at("trip=trip-1");
    act(() => purgeState.latest?.onTenantVerified("blue-mantis"));
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(1));

    let asks: Promise<void>[] = [];
    await act(async () => {
      asks = Array.from({ length: 5 }, () => result.current.reconcile());
    });
    expect(sync).toHaveBeenCalledTimes(1);

    await act(async () => {
      release(withEvents("trip-1", { pending: 3 }));
      await Promise.all(asks);
    });
    expect(sync).toHaveBeenCalledTimes(2);
    expect(result.current.message).toBe(line("allCaughtUp"));
  });
  it("never drops an ask made as a pass is finishing (re-review N10)", async () => {
    setOnline(true);
    load.mockResolvedValue(withEvents("trip-1", { pending: 1 }));
    // One ask, made a given number of microtasks after the hung pass is
    // answered: every one of them must be followed by a pass of its own,
    // including the one that lands after the pass has looked for a queued
    // ask and before it lets go.
    for (let ticks = 0; ticks < 8; ticks++) {
      sync.mockReset();
      let release: (envelope: OfflineManifestEnvelope) => void = () => {};
      sync.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      sync.mockResolvedValue(withEvents("trip-1", {}));
      const { result, unmount } = at("trip=trip-1");
      await waitFor(() => expect(sync).toHaveBeenCalledTimes(1));

      await act(async () => {
        release(withEvents("trip-1", { pending: 1 }));
        for (let tick = 0; tick < ticks; tick++) await Promise.resolve();
        await result.current.reconcile();
      });

      await waitFor(() => expect(sync, `an ask ${ticks} ticks in`).toHaveBeenCalledTimes(2));
      unmount();
    }
  });
});

describe("useSavedManifest and why the copy is on screen", () => {
  it("knows the worker sent the captain here because DiveDay did not answer", async () => {
    setOnline(true);
    load.mockResolvedValue(withEvents("trip-1", {}));
    const { result } = at("trip=trip-1&fallback=slow");
    await waitFor(() => expect(result.current.storeRead).toBe(true));
    expect(result.current.servedWithoutAnswer).toBe(true);
  });

  it("leaves the ordinary no-signal wording to a device that is offline", async () => {
    load.mockResolvedValue(withEvents("trip-1", {}));
    const { result } = at("trip=trip-1&fallback=failed");
    await waitFor(() => expect(result.current.storeRead).toBe(true));
    expect(result.current.servedWithoutAnswer).toBe(false);
    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current.servedWithoutAnswer).toBe(true);
  });

  it("knows a copy the captain opened is not one", async () => {
    setOnline(true);
    load.mockResolvedValue(withEvents("trip-1", {}));
    const { result } = at("trip=trip-1");
    await waitFor(() => expect(result.current.storeRead).toBe(true));
    expect(result.current.servedWithoutAnswer).toBe(false);
  });
});

/**
 * **When the roll call says this copy may be missing someone** (issue #2980,
 * domain reviews 2026-10-24): on a copy reached without a live answer, and on
 * any copy while the device is offline, whatever brought the captain to it.
 * Losing signal mid-count must never take the warning away.
 */
describe("useSavedManifest and the copy's roll-call caveat", () => {
  it("names a copy reached without an answer, and keeps a caveat when signal then drops", async () => {
    setOnline(true);
    load.mockResolvedValue(withEvents("trip-1", {}));
    const { result } = at("trip=trip-1&fallback=slow");
    await waitFor(() => expect(result.current.storeRead).toBe(true));
    expect(result.current.copyCaveat).toBe("unanswered");
    setOnline(false);
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.copyCaveat).toBe("offline");
  });

  it("names a copy the captain opened while the device is offline", async () => {
    setOnline(false);
    load.mockResolvedValue(withEvents("trip-1", {}));
    const { result } = at("trip=trip-1");
    await waitFor(() => expect(result.current.storeRead).toBe(true));
    expect(result.current.copyCaveat).toBe("offline");
  });

  /** Re-review 2026-10-24: any saved copy may be short, a copy opened with signal too. */
  it("names a copy the captain opened with signal as well", async () => {
    setOnline(true);
    load.mockResolvedValue(withEvents("trip-1", {}));
    const { result } = at("trip=trip-1");
    await waitFor(() => expect(result.current.storeRead).toBe(true));
    expect(result.current.copyCaveat).toBe("online");
  });
});

describe("useSavedManifest on the list", () => {
  it("lists what the device holds and counts it", async () => {
    const saved = [envelope("trip-1", "Morning"), envelope("trip-2", "Night")];
    list.mockResolvedValue(saved);
    const { result } = at("");
    await waitFor(() => expect(result.current.storeRead).toBe(true));
    expect(result.current.tripId).toBe("");
    expect(result.current.list).toBe(saved);
    expect(result.current.message).toBe(`${line("savedCount")} {"count":2}`);
  });

  it("leaves the status line empty when nothing is saved", async () => {
    list.mockResolvedValue([]);
    const { result } = at("");
    await waitFor(() => expect(result.current.storeRead).toBe(true));
    expect(result.current.list).toEqual([]);
    expect(result.current.message).toBe("");
  });

  it("settles on an error line when the list cannot be read", async () => {
    list.mockRejectedValue(new Error("store unreadable"));
    const { result } = at("");
    await waitFor(() => expect(result.current.storeRead).toBe(true));
    expect(result.current.message).toBe(line("listLoadError"));
    expect(result.current.storeReadFailed).toBe(true);
  });

  it("syncs only the signed-in shop's copies with pending events, and merges them back", async () => {
    setOnline(true);
    const mine = withEvents("trip-1", { pending: 1 });
    const theirs = withEvents("trip-2", { pending: 1 }, "other-shop");
    const quiet = withEvents("trip-3", {});
    const synced = withEvents("trip-1", {});
    list.mockResolvedValue([mine, theirs, quiet]);
    sync.mockResolvedValue(synced);
    const { result } = at("");
    await waitFor(() => expect(result.current.list?.[0]).toBe(synced));
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith("trip-1", "blue-mantis", 1);
    expect(result.current.list).toEqual([synced, theirs, quiet]);
    // The foreign copy's event remains pending and is never submitted. The
    // hook leaves aggregate status empty rather than saying all trips are sent;
    // the root list owns the tenant-neutral recovery notice.
    expect(result.current.message).toBe("");
  });

  it("shows persisted roll-call and checklist note loss per saved trip after reload", async () => {
    setOnline(true);
    const saved = [
      withDiscardedNotes("trip-12345678", "abcdef01"),
      withDiscardedNotes("trip-87654321", "9876abcd"),
    ];
    list.mockResolvedValue(saved);

    const first = at("");
    await waitFor(() => expect(first.result.current.storeRead).toBe(true));
    const firstMessage = first.result.current.message;
    expect(firstMessage).toContain(line("noteDiscardedList"));
    expect(firstMessage).toContain(line("noteTripReference"));
    expect(firstMessage).toContain("12345678");
    expect(firstMessage).toContain("87654321");
    expect(firstMessage).toContain("abcdef01");
    expect(firstMessage).toContain("9876abcd");
    expect(firstMessage).toContain("fedcba98");
    expect(firstMessage).toContain("checklistLocation");
    expect(firstMessage.split("\n")).toHaveLength(6);
    expect(firstMessage).not.toContain("Everything’s sent");
    expect(firstMessage).not.toContain("Nora Quinn");
    expect(firstMessage).not.toContain("note text");
    first.unmount();

    const afterReload = at("");
    await waitFor(() => expect(afterReload.result.current.storeRead).toBe(true));
    expect(afterReload.result.current.message).toBe(firstMessage);
  });

  it("keeps loss visible when one trip sync applies dispositions and another sync fails", async () => {
    setOnline(true);
    const unsynced = withEvents("trip-12345678", { pending: 1 });
    const failedTrip = withEvents("trip-87654321", { pending: 1 });
    const syncedWithLoss = withDiscardedNotes("trip-12345678", "abcdef01");
    list.mockResolvedValue([unsynced, failedTrip]);
    sync.mockResolvedValueOnce(syncedWithLoss).mockRejectedValueOnce(new Error("offline"));

    const { result } = at("");
    await waitFor(() => expect(result.current.list?.[0]).toBe(syncedWithLoss));
    await waitFor(() => expect(result.current.message).toContain(line("noteDiscardedList")));
    expect(result.current.message).toContain("12345678");
    expect(result.current.message).toContain("abcdef01");
    expect(result.current.message).toContain("fedcba98");
    expect(result.current.message).toContain("checklistLocation");
    expect(result.current.message).toContain(line("pendingWaiting"));
    expect(result.current.message).not.toContain(line("listAllCaughtUp"));
    expect(result.current.list?.[0]?.events[0]).toMatchObject({
      status: "boarded",
      occurredAt: "2026-08-01T14:30:00.000Z",
      note: null,
      noteDisposition: "discarded_erasure_cutoff",
    });
    expect(result.current.list?.[0]?.checklistEvents[0]).toMatchObject({
      status: "checked",
      occurredAt: "2026-08-01T14:30:00.000Z",
      note: null,
      noteDisposition: "discarded_erasure_cutoff",
    });
  });

  it("says all caught up once nothing on the device is pending", async () => {
    setOnline(true);
    list.mockResolvedValue([withEvents("trip-1", { pending: 1 })]);
    sync.mockResolvedValue(withEvents("trip-1", {}));
    const { result } = at("");
    await waitFor(() => expect(result.current.message).toBe(line("listAllCaughtUp")));
  });

  it("counts the refusals across the list", async () => {
    setOnline(true);
    list.mockResolvedValue([withEvents("trip-1", { pending: 2 })]);
    sync.mockResolvedValue(withEvents("trip-1", { rejected: 2 }));
    const { result } = at("");
    await waitFor(() =>
      expect(result.current.message).toBe(`${line("listPendingRejected")} {"count":2}`),
    );
  });
});

describe("useSavedManifest and what retention threw away", () => {
  const lost: DiscardedOfflineRecord = {
    tripId: "trip-9",
    tripTitle: "Wreck Dive",
    shopName: "Blue Mantis Divers",
    shopSlug: "blue-mantis",
    pendingEvents: 3,
    discardedAt: "2026-08-01T12:00:00.000Z",
  };

  it("reads the discarded records after the store is opened", async () => {
    list.mockResolvedValue([]);
    readDiscarded.mockResolvedValue([lost]);
    const { result } = at("");
    await waitFor(() => expect(result.current.discarded).toEqual([lost]));
  });

  it("clears the notice at once when acknowledged, and records the acknowledgement", async () => {
    list.mockResolvedValue([]);
    readDiscarded.mockResolvedValue([lost]);
    const { result } = at("");
    await waitFor(() => expect(result.current.discarded).toEqual([lost]));
    act(() => result.current.acknowledgeDiscarded());
    expect(result.current.discarded).toEqual([]);
    expect(acknowledge).toHaveBeenCalledTimes(1);
  });
});
