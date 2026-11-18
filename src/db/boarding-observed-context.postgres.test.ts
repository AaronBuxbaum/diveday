import { and, eq, ne } from "drizzle-orm";
import { expect, it } from "vitest";
import { readActiveStaffRoles } from "@/db/authz";
import { isStaff } from "@/lib/authz";
import { observeRealContextForTest } from "@/test/boarding-receipt-prototype/observe-real-context";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { recordBoardingObservation } from "./boarding-observations";
import { DemoSightingCleanupBlocked } from "./demo-sighting-guard";
import { boardingObservations, bookings } from "./schema";
import { resetDemoSchedule, seedDemo } from "./seed";
import { DEMO_RECAP_BOOKING_ID, DEMO_TODAY_TRIP_ID } from "./seed-identifiers";
import { getShopBySlug } from "./shops";
import { listStaff } from "./trips";

describePostgres("real rows remain observations, not original meeting authority", () => {
  it("keeps a real booked context when a committed sighting makes reset refuse", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "history");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    let actorId: string | undefined;
    for (const member of await listStaff(pg.db, shop.id)) {
      const roles = await readActiveStaffRoles(pg.db, shop.id, member.person.id);
      if (roles && isStaff(roles)) {
        actorId = member.person.id;
        break;
      }
    }
    if (!actorId) throw new Error("active staff missing");
    const [booking] = await pg.db
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
    if (!booking) throw new Error("original booking missing");
    await pg.db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, booking.id));
    const [before] = await pg.db.select().from(bookings).where(eq(bookings.id, booking.id));
    if (!before) throw new Error("booking missing after setup");
    const args = { shopId: shop.id, actorId, tripId: DEMO_TODAY_TRIP_ID, bookingId: booking.id };
    expect(await observeRealContextForTest(pg.db, args)).toMatchObject({
      kind: "observed_only",
      ...args,
      generation: "unknown",
    });
    const clientKey = crypto.randomUUID();
    const sighting = await recordBoardingObservation(pg.connect(), {
      shopId: shop.id,
      tripId: args.tripId,
      bookingId: args.bookingId,
      recordedByPersonId: actorId,
      clientKey,
    });
    expect(sighting).toMatchObject({
      ok: true,
      bookingId: booking.id,
      tripId: args.tripId,
      replay: false,
    });
    if (!sighting.ok) throw new Error("sighting not recorded");
    const beforeEvidence = await pg.db
      .select()
      .from(boardingObservations)
      .where(
        and(
          eq(boardingObservations.shopId, shop.id),
          eq(boardingObservations.id, sighting.observationId),
        ),
      );
    expect(beforeEvidence).toMatchObject([
      { bookingId: booking.id, tripId: args.tripId, clientKey, state: "pending" },
    ]);
    await expect(resetDemoSchedule(pg.connect(), shop.id, "history")).rejects.toBeInstanceOf(
      DemoSightingCleanupBlocked,
    );
    expect(await pg.db.select().from(bookings).where(eq(bookings.id, booking.id))).toEqual([
      before,
    ]);
    expect(
      await pg.db
        .select()
        .from(boardingObservations)
        .where(
          and(
            eq(boardingObservations.shopId, shop.id),
            eq(boardingObservations.id, sighting.observationId),
          ),
        ),
    ).toEqual(beforeEvidence);
    expect(await observeRealContextForTest(pg.db, args)).toMatchObject({
      kind: "observed_only",
      ...args,
      generation: "unknown",
    });
  });
});
