import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate, nowMs } from "@/lib/clock";
import { manifestContext } from "@/test/substrate-fixtures/db/manifests-test-fixtures";
import { aboardAtSeaBookingIds } from "./aboard-at-sea";
import { getTripManifest } from "./manifests";
import { bookings, tripScheduleDays, trips } from "./schema";
import { seedRollCallEvidence } from "./seed-roll-call-evidence";

for (const role of ["diver", "crew"] as const) {
  it(`does not release today's at-risk seat using unknown-day retained ashore evidence for ${role}`, async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const base = nowMs();
    await db
      .update(trips)
      .set({ startsAt: new Date(base - 2 * 3_600_000), endsAt: new Date(base + 3_600_000) })
      .where(eq(trips.id, reef.id));
    await db.delete(tripScheduleDays).where(eq(tripScheduleDays.tripId, reef.id));
    await db.insert(tripScheduleDays).values(
      [0, 1].map((day) => ({
        tripId: reef.id,
        dayNumber: day + 1,
        startsAt: new Date(base + day * 86_400_000 - 2 * 3_600_000),
        endsAt: new Date(base + day * 86_400_000 + 3_600_000),
      })),
    );
    const crewId = (await getTripManifest(db, shop.id, reef.id, "departure"))?.crew[0]?.id;
    if (!crewId) throw new Error("fixture missing crew");
    let bookingId = booking.booking.id;
    if (role === "crew") {
      const [existing] = await db
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(eq(bookings.tripId, reef.id), eq(bookings.personId, crewId)));
      if (existing) bookingId = existing.id;
      else {
        const [created] = await db
          .insert(bookings)
          .values({ shopId: shop.id, tripId: reef.id, personId: crewId, bookedAs: "diver" })
          .returning({ id: bookings.id });
        if (!created) throw new Error("fixture crew passenger missing");
        bookingId = created.id;
      }
    }
    await seedRollCallEvidence(db, {
      shopId: shop.id,
      tripId: reef.id,
      ...(role === "diver" ? { bookingId } : { subjectKind: "crew", crewPersonId: crewId }),
      recordedByPersonId: staff.id,
      checkpoint: "departure",
      status: "not_boarded",
      meetingDay: -1,
      occurredAt: nowDate(),
    });
    expect(
      (
        await aboardAtSeaBookingIds(db, {
          shopId: shop.id,
          tripId: reef.id,
          now: nowDate(),
          bookingIds: [bookingId],
        })
      ).get(bookingId),
    ).toBe("uncounted");
  });
}
