import { and, eq, ne } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  issueOfflineManifestSnapshot,
  readOfflineManifestRoster,
} from "@/features/offline-manifest-snapshots";
import { verifyOfflineErasureEpoch } from "@/lib/offline-erasure-epoch";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { bookings, trips } from "./schema";
import { resetDemoSchedule, seedDemo } from "./seed";
import { DEMO_RECAP_BOOKING_ID, DEMO_TODAY_TRIP_ID } from "./seed-identifiers";
import { getShopBySlug } from "./shops";

describePostgres("offline snapshot identity across demo reset", () => {
  it("does not turn an old erasure token into proof of a new trip incarnation", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "history");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const beforeRead = await readOfflineManifestRoster(pg.db, shop.id, DEMO_TODAY_TRIP_ID);
    if (!beforeRead) throw new Error("original manifest missing");
    const before = await issueOfflineManifestSnapshot(
      pg.db,
      shop.id,
      DEMO_TODAY_TRIP_ID,
      beforeRead,
    );
    if (!before.ok) throw new Error(`original snapshot refused: ${before.reason}`);
    expect(before.snapshotRevision).toBe(1);
    const [originalBooking] = await pg.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.shopId, shop.id),
          eq(bookings.tripId, DEMO_TODAY_TRIP_ID),
          ne(bookings.id, DEMO_RECAP_BOOKING_ID),
        ),
      )
      .limit(1);
    if (!originalBooking) throw new Error("non-pinned booking missing");
    const originalEpoch = verifyOfflineErasureEpoch({
      token: before.erasureEpochToken,
      shopId: shop.id,
      tripId: DEMO_TODAY_TRIP_ID,
      snapshotId: before.snapshotId,
    });
    expect(originalEpoch).not.toBeNull();

    await resetDemoSchedule(pg.db, shop.id, "history");
    expect(
      await pg.db.select({ id: trips.id }).from(trips).where(eq(trips.id, DEMO_TODAY_TRIP_ID)),
    ).toEqual([{ id: DEMO_TODAY_TRIP_ID }]);
    expect(
      await pg.db
        .select({ id: bookings.id })
        .from(bookings)
        .where(eq(bookings.id, originalBooking.id)),
    ).toEqual([]);
    const afterRead = await readOfflineManifestRoster(pg.db, shop.id, DEMO_TODAY_TRIP_ID);
    if (!afterRead) throw new Error("reseeded manifest missing");
    const after = await issueOfflineManifestSnapshot(pg.db, shop.id, DEMO_TODAY_TRIP_ID, afterRead);
    if (!after.ok) throw new Error(`reseeded snapshot refused: ${after.reason}`);
    expect(after.snapshotId).not.toBe(before.snapshotId);
    expect(after.snapshotRevision).toBe(before.snapshotRevision);
    expect(
      verifyOfflineErasureEpoch({
        token: before.erasureEpochToken,
        shopId: shop.id,
        tripId: DEMO_TODAY_TRIP_ID,
        snapshotId: after.snapshotId,
      }),
    ).toBeNull();
    expect(
      verifyOfflineErasureEpoch({
        token: after.erasureEpochToken,
        shopId: shop.id,
        tripId: DEMO_TODAY_TRIP_ID,
        snapshotId: after.snapshotId,
      }),
    ).not.toBeNull();
    expect(
      verifyOfflineErasureEpoch({
        token: before.erasureEpochToken,
        shopId: shop.id,
        tripId: DEMO_TODAY_TRIP_ID,
        snapshotId: before.snapshotId,
      }),
    ).toBe(originalEpoch);
  });
});
