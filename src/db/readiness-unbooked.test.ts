import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { createPerson } from "./people";
import { issueShopNitroxCertification } from "./readiness";
import { bookings, courses, tripAssignments } from "./schema";
import { createTrip, listStaff } from "./trips";

const context = fileScopedShopContext();
it("refuses a diver who is not booked on the session while issuing only pending evidence for its booked student", async () => {
  const { db, shop } = context;
  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Open Water Diver")));
  if (!course) throw new Error("seeded course missing");
  const instructor = (await listStaff(db, shop.id)).find((entry) =>
    entry.roles.includes("instructor"),
  );
  if (!instructor) throw new Error("seeded instructor missing");
  const startsAt = nowDate();
  const trip = await createTrip(db, {
    shopId: shop.id,
    courseId: course.id,
    title: "Unbooked session",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
    capacity: 8,
    plannedDives: 2,
  });
  if (!trip) throw new Error("course trip refused");
  await db.insert(tripAssignments).values({ tripId: trip.id, personId: instructor.person.id });
  const party = await createBookingParty(db, [
    {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Booked specialty student",
      email: "booked-specialty@example.com",
    },
  ]);
  if (!party.ok) throw new Error(`course booking refused: ${party.reason}`);
  const [seat] = party.bookings;
  if (!seat) throw new Error("course booking missing");
  // An arbitrary live person can be the student just booked. Create a separate
  // person and prove the unbooked premise before exercising the refusal.
  const stranger = await createPerson(db, {
    shopId: shop.id,
    fullName: "Unbooked specialty student",
    email: null,
    phone: null,
    origin: "counter",
  });
  expect(
    await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.shopId, shop.id),
          eq(bookings.tripId, trip.id),
          eq(bookings.personId, stranger.id),
        ),
      ),
  ).toHaveLength(0);
  const issuer = { shopId: shop.id, tripId: trip.id, issuedByPersonId: instructor.person.id };
  expect(await issueShopNitroxCertification(db, { ...issuer, personId: stranger.id })).toBeNull();
  // The valid participant proves the course/instructor fixture can issue a record;
  // pending evidence still provides no verified nitrox authorization.
  expect(
    await issueShopNitroxCertification(db, { ...issuer, personId: seat.personId }),
  ).toMatchObject({
    status: "pending",
    personId: seat.personId,
    issuedFromTripId: trip.id,
  });
});
