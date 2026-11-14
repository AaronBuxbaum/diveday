// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfflineManifestTranslator } from "@/i18n/offline-manifest-messages";
import {
  acknowledgeDiscardedOfflineRecords,
  type DiscardedOfflineRecord,
  listOfflineManifests,
  loadOfflineManifest,
  readDiscardedOfflineRecords,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";
import { useSavedManifest } from "./use-saved-manifest";
import { setOnline } from "./view-fixtures";

const search = vi.hoisted(() => ({ params: new URLSearchParams() }));
const inventory = vi.hoisted(() => ({ incomplete: false }));
const tenant = vi.hoisted(() => ({
  slug: "blue-mantis" as string | null,
  setVerified: (_slug: string | null) => {},
}));
const purgeState = vi.hoisted(() => ({
  latest: null as null | {
    tenantChangeRevision: number;
    onTenantVerified: (slug: string) => void;
    onListPurged: (saved: OfflineManifestEnvelope[], slug: string) => void;
  },
}));

vi.mock("next/navigation", () => ({ useSearchParams: () => search.params }));
vi.mock("@/lib/offline-manifest-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline-manifest-store")>();
  const list = vi.fn();
  return {
    ...actual,
    acknowledgeDiscardedOfflineRecords: vi.fn(),
    listOfflineManifests: list,
    readOfflineManifestInventory: async () => ({
      manifests: await list(),
      incomplete: inventory.incomplete,
    }),
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
  inventory.incomplete = false;
  tenant.setVerified(null);
  purgeState.latest = null;
  setOnline(false);
});

afterEach(cleanup);

describe("useSavedManifest and what retention threw away", () => {
  const lost: DiscardedOfflineRecord = {
    noticeId: "notice-trip-9",
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
    act(() => result.current.acknowledgeDiscarded([lost]));
    expect(result.current.discarded).toEqual([]);
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(acknowledge).toHaveBeenCalledWith([lost]);
  });
});
