import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { activityEvents, bookings, shops } from "@/db/schema";
import { seedDemo } from "@/db/seed";
import { getTripRoster, listStaff } from "@/db/trips";
import { upcomingTripsWithCounts } from "@/db/trips-queries.test-support";
import { nowDate } from "@/lib/clock";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { claimCourseFollowup } from "./followup-store";

// PGlite cannot prove two independent writers competing for one revision.
describePostgres("course preparation claim concurrency", () => {
  it("allows exactly one simultaneous claim and appends exactly one audit row", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "history");
    const [shop] = await pg.db.select().from(shops).where(eq(shops.slug, "blue-mantis"));
    if (!shop) throw new Error("Missing shop");
    const course = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find(
      (row) => row.courseId,
    );
    const owner = (await listStaff(pg.db, shop.id)).find((row) => row.roles.includes("owner"));
    if (!course || !owner) throw new Error("Missing course or owner");
    const [seat] = await getTripRoster(pg.db, shop.id, course.id);
    if (!seat) throw new Error("Missing student");
    await pg.db
      .update(bookings)
      .set({
        identityUnconfirmedAt: nowDate(),
        identityBookedAs: "Student awaiting identity check",
      })
      .where(eq(bookings.id, seat.booking.id));
    const input = {
      shopId: shop.id,
      tripId: course.id,
      bookingId: seat.booking.id,
      personId: owner.person.id,
      expectedRevision: 0,
      intent: "claim" as const,
    };
    const results = await Promise.all([
      claimCourseFollowup(pg.db, input),
      claimCourseFollowup(pg.connect(), input),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(
      await pg.db
        .select()
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.shopId, shop.id),
            eq(activityEvents.bookingId, seat.booking.id),
            eq(activityEvents.code, "course_followup_claimed"),
          ),
        ),
    ).toHaveLength(1);
  });
});
