// The device half runs the real offline store over an in-memory IndexedDB.
import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTripManifests } from "@/db/manifests";
import { bookings, people, trips } from "@/db/schema";
import {
  nextOfflineManifestSnapshotRevision,
  readOfflineManifestRoster,
} from "@/features/offline-manifest-snapshots";
import type { DiveDaySession } from "@/lib/auth";
import { signOfflineErasureEpoch } from "@/lib/offline-erasure-epoch";
import { loadOfflineManifest, saveOfflineManifest } from "@/lib/offline-manifest-store";
import {
  claimOfflineManifestSnapshot,
  OFFLINE_MANIFEST_STALE_READ,
  type OfflineManifestPayload,
  serializeManifests,
} from "@/lib/offline-manifests";
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
const { POST } = await import("./route");

const TITLE = "Two-Tank Reef — Molasses & French";
const WALK_UP = "Wren Walk-Up";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a page save that lands after a newer copy (dock-operator review, issue #4391)", () => {
  it("keeps the newer copy with the walk-up diver, and refuses the older read's claim", async () => {
    const { db, shop } = ctx;
    vi.mocked(getDb).mockResolvedValue(db);
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    authModule.auth.mockResolvedValue({
      user: {
        personId: owner,
        shopId: shop.id,
        shopSlug: shop.slug,
        name: "Owner",
        email: SEEDED_OWNER_EMAIL,
        roles: ["owner"],
      },
    });
    // The page's claim goes to the real route handler.
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const tripId = /\/api\/offline-manifests\/([^/]+)\/snapshot$/.exec(url)?.[1] ?? "";
      return POST(new Request(`http://localhost${url}`, init), {
        params: Promise.resolve({ tripId }),
      });
    });
    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.title, TITLE)))
      .limit(1);
    if (!trip) throw new Error("demo departure missing");
    const identity = {
      slug: shop.slug,
      name: shop.name,
      timezone: shop.timezone,
      emergencyReference: { lines: [], vessel: "", shoreContact: "", plan: "" },
    } as OfflineManifestPayload["shop"];
    // Earlier copies of this departure: the counter stands at 9.
    for (let issued = 0; issued < 9; issued += 1) {
      await nextOfflineManifestSnapshotRevision(db, shop.id, trip.id);
    }

    // This phone's page reads its rows (R1): the walk-up diver is not seated yet.
    const r1 = await readOfflineManifestRoster(db, shop.id, trip.id);
    if (!r1) throw new Error("roster missing");
    expect(r1.snapshotRevision).toBe(9);
    const pagePayload: OfflineManifestPayload = {
      ...serializeManifests(r1.manifests, identity, () => ""),
      readAt: { erasureEpoch: r1.erasureEpoch, snapshotRevision: r1.snapshotRevision },
    };

    // Another phone seats the walk-up diver.
    const [walkUp] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: WALK_UP })
      .returning({ id: people.id });
    if (!walkUp) throw new Error("walk-up diver missing");
    const [seat] = await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: trip.id, personId: walkUp.id, bookedAs: "diver" })
      .returning({ id: bookings.id });
    if (!seat) throw new Error("walk-up seat missing");

    // The layout's board saves a newer read (R2) first, at revision 10, as
    // `/api/offline-manifests/upcoming` does: revision taken, then rows read.
    const revision = await nextOfflineManifestSnapshotRevision(db, shop.id, trip.id);
    expect(revision).toBe(10);
    const r2 = await getTripManifests(db, shop.id, trip.id);
    if (!r2 || revision === null) throw new Error("board read missing");
    const boardSnapshotId = randomUUID();
    await saveOfflineManifest({
      ...serializeManifests(r2, identity, () => ""),
      snapshotId: boardSnapshotId,
      erasureEpochToken: signOfflineErasureEpoch({
        shopId: shop.id,
        tripId: trip.id,
        snapshotId: boardSnapshotId,
        epoch: r1.erasureEpoch,
        snapshotRevision: revision,
      }),
    });
    const seatedOn = (envelope: Awaited<ReturnType<typeof loadOfflineManifest>>) =>
      envelope?.snapshot.manifests[0]?.divers.some((diver) => diver.bookingId === seat.id);
    expect(seatedOn(await loadOfflineManifest(trip.id))).toBe(true);

    // The page's slow save of R1 lands after: the hook's claim, then its save.
    const claimed = await claimOfflineManifestSnapshot(pagePayload);
    if (claimed && claimed !== OFFLINE_MANIFEST_STALE_READ) await saveOfflineManifest(claimed);

    expect(claimed).toBe(OFFLINE_MANIFEST_STALE_READ);
    const kept = await loadOfflineManifest(trip.id);
    expect(seatedOn(kept)).toBe(true);
    expect(kept?.snapshot.snapshotId).toBe(boardSnapshotId);
  });
});
