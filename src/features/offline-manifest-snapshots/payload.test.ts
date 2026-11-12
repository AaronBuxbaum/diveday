import { beforeEach, expect, it, vi } from "vitest";
import { EMPTY_EMERGENCY_REFERENCE } from "@/lib/emergency-reference";

vi.mock("@/db/boarding-certification-snapshot", () => ({
  lockBoardingCertificationEvidence: vi.fn(),
}));
vi.mock("@/db/shops", () => ({ getShopOfflineErasureEpoch: vi.fn() }));
vi.mock("@/db/manifests", () => ({ getTripManifests: vi.fn() }));
vi.mock("@/db/trip-meeting-windows", () => ({
  meetingWindowsByTrip: vi.fn(async () => new Map()),
}));
vi.mock("@/i18n/request", () => ({ requestLocale: vi.fn(async () => "en-US") }));
vi.mock("./store", () => ({ nextOfflineManifestSnapshotRevision: vi.fn() }));

const { getShopOfflineErasureEpoch } = await import("@/db/shops");
const { getTripManifests } = await import("@/db/manifests");
const { nextOfflineManifestSnapshotRevision } = await import("./store");
const { buildOfflineManifestCopies } = await import("./payload");
const db = {
  transaction: async (work: (tx: unknown) => unknown) => work({}),
} as unknown as Parameters<typeof buildOfflineManifestCopies>[0];
const shop = {
  id: "shop-1",
  slug: "owned-shop",
  name: "Owned shop",
  timezone: "America/New_York",
  defaultLocale: "en-US",
  emergencyReference: EMPTY_EMERGENCY_REFERENCE,
} as Parameters<typeof buildOfflineManifestCopies>[1];
beforeEach(() => {
  vi.mocked(getShopOfflineErasureEpoch).mockResolvedValue(0);
  vi.mocked(nextOfflineManifestSnapshotRevision).mockResolvedValue(1);
  vi.mocked(getTripManifests).mockResolvedValue(null);
});

for (const denied of ["erased shop", "unavailable revision", "removed trip"] as const) {
  it(`does not issue a usable roster or medical grant after ${denied}`, async () => {
    if (denied === "erased shop") vi.mocked(getShopOfflineErasureEpoch).mockResolvedValue(null);
    if (denied === "unavailable revision")
      vi.mocked(nextOfflineManifestSnapshotRevision).mockResolvedValue(null);
    const result = await buildOfflineManifestCopies(db, shop, "viewer-1", ["trip-1"]);
    expect(result).toMatchObject({
      shop: { slug: "owned-shop" },
      payloads: [],
      viewer: { personId: "viewer-1" },
      mayHoldMedicalAlertWords: {},
    });
    expect(JSON.stringify(result)).not.toContain("snapshotId");
  });
}
