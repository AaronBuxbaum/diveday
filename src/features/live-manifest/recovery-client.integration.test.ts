// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { payload } from "@/components/offline-manifest/view-fixtures";
import { liveManifestSessionHandle } from "@/features/live-manifest-server";
import { nowMs } from "@/lib/clock";
import {
  appendOfflineRollCall,
  loadOfflineManifest,
  saveOfflineManifest,
} from "@/lib/offline-manifest-store";
import { captureLiveManifestFence, invalidateLiveManifestShop } from "./cache";
import { recoverLiveManifestShop } from "./recovery-client";

vi.mock("@/app/api/offline-manifests/staff-context", () => ({
  authorizeOfflineManifestStaff: vi.fn(),
  OFFLINE_MANIFEST_NO_STORE: { "Cache-Control": "private, no-store" },
}));
vi.mock("@/db/shops", () => ({ getShopOfflineErasureEpoch: vi.fn() }));
const { authorizeOfflineManifestStaff } = await import("@/app/api/offline-manifests/staff-context");
const { getShopOfflineErasureEpoch } = await import("@/db/shops");
const { POST } = await import("@/app/api/offline-manifests/recovery/route");
const shop = "recovery-integration-shop";
const sessionId = "recovery-integration-session";
const handle = liveManifestSessionHandle(shop, sessionId);
if (!handle) throw new Error("missing test session handle");
const scope = { shop, session: handle, trip: "trip", checkpoint: "departure" };

beforeAll(() => {
  vi.stubGlobal("crypto", webcrypto);
});
beforeEach(() => {
  vi.mocked(getShopOfflineErasureEpoch).mockResolvedValue(5);
  vi.mocked(authorizeOfflineManifestStaff).mockResolvedValue({
    ok: true,
    db: {},
    shop: { id: shop },
    user: { sessionId },
  } as never);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) =>
      POST(new Request(`http://localhost${url}`, init)),
    ),
  );
});

it("reopens a local erasure fence only after matching the server's live response", async () => {
  await captureLiveManifestFence(scope);
  await invalidateLiveManifestShop(scope.shop);
  expect(await recoverLiveManifestShop(scope)).toBe(true);
  expect(await captureLiveManifestFence(scope)).toBeDefined();
});

it("retains the fence when the live staff gate refuses", async () => {
  await invalidateLiveManifestShop(scope.shop);
  vi.mocked(authorizeOfflineManifestStaff).mockResolvedValueOnce({
    ok: false,
    response: new Response(null, { status: 401 }),
  } as never);
  expect(await recoverLiveManifestShop(scope)).toBe(false);
  await expect(captureLiveManifestFence(scope)).rejects.toThrow("live-manifest-cache-invalidated");
});

it("retains queued offline events when recovery is refused", async () => {
  const offline = payload(scope.trip, "Test trip", 1);
  const manifest = offline.manifests[0];
  if (!manifest) throw new Error("missing manifest");
  manifest.trip.startsAt = new Date(nowMs() + 60_000).toISOString();
  manifest.trip.endsAt = new Date(nowMs() + 3_600_000).toISOString();
  manifest.divers.push({
    bookingId: "booking-1",
    fullName: "Nora",
    email: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    readiness: { status: "ready", blockers: [] },
    rentalFit: { state: "not_recorded" },
    nitroxRequested: false,
  });
  await saveOfflineManifest(offline);
  const queued = await appendOfflineRollCall(scope.trip, {
    bookingId: "booking-1",
    checkpoint: "departure",
    status: "not_boarded",
  });
  expect(queued.events).toHaveLength(1);
  await invalidateLiveManifestShop(scope.shop);
  vi.mocked(authorizeOfflineManifestStaff).mockResolvedValueOnce({
    ok: false,
    response: new Response(null, { status: 401 }),
  } as never);
  expect(await recoverLiveManifestShop(scope)).toBe(false);
  expect((await loadOfflineManifest(scope.trip))?.events).toEqual(queued.events);
});
