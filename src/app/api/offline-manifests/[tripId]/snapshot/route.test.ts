import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { offlineManifestSnapshotRevisions, shops, trips } from "@/db/schema";
import { nextOfflineManifestSnapshotRevision } from "@/features/offline-manifest-snapshots";
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
  const epoch = row?.epoch ?? 0;
  const [counter] = await revisions(trip.id);
  // What the page read its rows at.
  const readAt = { erasureEpoch: epoch, snapshotRevision: counter?.revision ?? 0 };
  return { db, shop, tripId: trip.id, epoch, readAt };
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
  it("issues a snapshot signed at the epoch and next revision after the page's read", async () => {
    const { shop, tripId, epoch, readAt } = await departure();

    const response = await request(tripId, readAt);

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
    expect(body.erasureEpochToken.split(".")[1]).toBe(String(readAt.snapshotRevision + 1));
    expect(await revisions(tripId)).toEqual([{ revision: readAt.snapshotRevision + 1 }]);
  });

  it("refuses rows read before an erasure, writing no revision", async () => {
    const { db, shop, tripId, epoch, readAt } = await departure();
    const before = await revisions(tripId);
    // An erasure committed after the page read its rows.
    await db
      .update(shops)
      .set({ offlineErasureEpoch: epoch + 1 })
      .where(eq(shops.id, shop.id));

    const response = await request(tripId, readAt);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "erasure_epoch_moved" });
    expect(await revisions(tripId)).toEqual(before);
  });

  it("refuses rows read before another copy was issued, writing no revision", async () => {
    const { db, shop, tripId, readAt } = await departure();
    // The layout's board saved a newer read after the page read its rows.
    const newer = await nextOfflineManifestSnapshotRevision(db, shop.id, tripId);

    const response = await request(tripId, readAt);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "snapshot_superseded" });
    expect(await revisions(tripId)).toEqual([{ revision: newer }]);
  });

  it("refuses a request from another site before reading anything", async () => {
    const { tripId, readAt } = await departure();
    const response = await request(tripId, readAt, {
      Origin: "https://elsewhere.example",
      "Sec-Fetch-Site": "cross-site",
    });
    expect(response.status).toBe(403);
    expect(auth).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller", async () => {
    const { tripId, readAt } = await departure();
    auth.mockResolvedValue(null);
    expect((await request(tripId, readAt)).status).toBe(401);
  });

  it("answers not found for a trip that is not this shop's, writing nothing", async () => {
    const { epoch } = await departure();
    const foreign = "00000000-0000-4000-8000-000000000000";
    expect((await request(foreign, { erasureEpoch: epoch, snapshotRevision: 0 })).status).toBe(404);
    expect(await revisions(foreign)).toEqual([]);
  });

  it("refuses a body without a usable epoch and revision", async () => {
    const { tripId, epoch } = await departure();
    expect((await request(tripId, { erasureEpoch: -1, snapshotRevision: 0 })).status).toBe(400);
    expect((await request(tripId, { erasureEpoch: "3", snapshotRevision: 0 })).status).toBe(400);
    expect((await request(tripId, { erasureEpoch: epoch })).status).toBe(400);
    expect((await request(tripId, { erasureEpoch: epoch, snapshotRevision: -1 })).status).toBe(400);
    expect((await request(tripId, { erasureEpoch: epoch, snapshotRevision: 1.5 })).status).toBe(
      400,
    );
    expect((await request(tripId, {})).status).toBe(400);
  });
});
