import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { offlineManifestSnapshotRevisions, shops, trips } from "@/db/schema";
import type { DiveDaySession } from "@/lib/auth";
import type { Role } from "@/lib/authz";
import { verifyOfflineErasureEpoch } from "@/lib/offline-erasure-epoch";
import type { OfflineManifestSnapshotResponse } from "@/lib/offline-manifests";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

const ctx = fileScopedShopContext();

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};
const auth = authModule.auth;
const { POST } = await import("./route");

const TITLE = "Two-Tank Reef — Molasses & French";

const session = (shopId: string, personId: string, roles: Role[]): DiveDaySession => ({
  user: {
    personId,
    shopId,
    shopSlug: "blue-mantis",
    name: "Staff",
    email: "staff@demo.invalid",
    roles,
  },
});

function request(tripId: string, body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request(`http://localhost/api/offline-manifests/${tripId}/snapshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ tripId }) },
  );
}

async function departure() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.shopId, shop.id), eq(trips.title, TITLE)))
    .limit(1);
  if (!trip) throw new Error("demo departure missing");
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  auth.mockResolvedValue(session(shop.id, owner, ["owner"]));
  const [row] = await db
    .select({ epoch: shops.offlineErasureEpoch })
    .from(shops)
    .where(eq(shops.id, shop.id));
  return { db, shop, tripId: trip.id, epoch: row?.epoch ?? 0 };
}

async function revisions(tripId: string) {
  return ctx.db
    .select({ revision: offlineManifestSnapshotRevisions.revision })
    .from(offlineManifestSnapshotRevisions)
    .where(eq(offlineManifestSnapshotRevisions.tripId, tripId));
}

beforeEach(() => {
  auth.mockReset();
});

describe("POST /api/offline-manifests/[tripId]/snapshot (issue #4391)", () => {
  it("issues a snapshot signed at the epoch the page read its rows at", async () => {
    const { shop, tripId, epoch } = await departure();
    const before = (await revisions(tripId))[0]?.revision ?? 0;

    const response = await request(tripId, { erasureEpoch: epoch });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = (await response.json()) as OfflineManifestSnapshotResponse;
    expect(
      verifyOfflineErasureEpoch({
        token: body.erasureEpochToken,
        shopId: shop.id,
        tripId,
        snapshotId: body.snapshotId,
      }),
    ).toBe(epoch);
    expect(await revisions(tripId)).toEqual([{ revision: before + 1 }]);
  });

  it("refuses rows read before an erasure, writing no revision", async () => {
    const { db, shop, tripId, epoch } = await departure();
    const before = await revisions(tripId);
    // An erasure committed after the page read its rows.
    await db
      .update(shops)
      .set({ offlineErasureEpoch: epoch + 1 })
      .where(eq(shops.id, shop.id));

    const response = await request(tripId, { erasureEpoch: epoch });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "erasure_epoch_moved" });
    expect(await revisions(tripId)).toEqual(before);
  });

  it("refuses a request from another site before reading anything", async () => {
    const { tripId, epoch } = await departure();
    const response = await request(
      tripId,
      { erasureEpoch: epoch },
      { Origin: "https://elsewhere.example", "Sec-Fetch-Site": "cross-site" },
    );
    expect(response.status).toBe(403);
    expect(auth).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller", async () => {
    const { tripId, epoch } = await departure();
    auth.mockResolvedValue(null);
    expect((await request(tripId, { erasureEpoch: epoch })).status).toBe(401);
  });

  it("answers not found for a trip that is not this shop's, writing nothing", async () => {
    const { epoch } = await departure();
    const foreign = "00000000-0000-4000-8000-000000000000";
    expect((await request(foreign, { erasureEpoch: epoch })).status).toBe(404);
    expect(await revisions(foreign)).toEqual([]);
  });

  it("refuses a body with no usable epoch", async () => {
    const { tripId } = await departure();
    expect((await request(tripId, { erasureEpoch: -1 })).status).toBe(400);
    expect((await request(tripId, { erasureEpoch: "3" })).status).toBe(400);
    expect((await request(tripId, {})).status).toBe(400);
  });
});
