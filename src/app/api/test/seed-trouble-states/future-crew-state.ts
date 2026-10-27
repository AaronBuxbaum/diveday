import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { createBooking } from "@/db/bookings";
import type { AppDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { courses, people, personRoles, staffCredentials, tripAssignments } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { createTrip } from "@/db/trips";
import { calendarDateInTimezone, shiftCalendarDate } from "@/lib/calendar-date";
import { HOUR_MS, nowDate } from "@/lib/clock";

/** A fictional legacy rating, only for a private demo behind the test-route gate. */
export async function futureCrewStateResponse(request: Request, db: AppDb) {
  const params = new URL(request.url).searchParams;
  if (params.get("futureCrew") !== "1") return null;
  const slug = params.get("shop");
  if (!slug || slug === DEMO_SHOP_SLUG)
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  const shop = await getShopBySlug(db, slug);
  if (!shop?.isDemo) return NextResponse.json({ error: "not_available" }, { status: 404 });
  const catalog = await db.select().from(courses).where(eq(courses.shopId, shop.id));
  const course = catalog.find(
    (row) =>
      !row.isIntroCourse && row.agency.toLowerCase() === "padi" && !row.minimumCertificationLevel,
  );
  if (!course) throw new Error("future crew fixture needs an entry course");
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Alex Future" })
    .returning();
  if (!person) throw new Error("future crew fixture needs a person");
  await db.insert(personRoles).values({ personId: person.id, role: "instructor" });
  const startsAt = new Date(nowDate().getTime() + 3 * HOUR_MS);
  const issueDate = shiftCalendarDate(calendarDateInTimezone(startsAt, shop.timezone), 1);
  await db.insert(staffCredentials).values({
    shopId: shop.id,
    personId: person.id,
    kind: "instructor_rating",
    name: "Synthetic instructor rating",
    issuedAt: issueDate,
    renewsAt: shiftCalendarDate(issueDate, 365),
  });
  const trip = await createTrip(db, {
    shopId: shop.id,
    courseId: course.id,
    title: "Legacy rating check",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
    capacity: 8,
    plannedDives: 1,
  });
  if (!trip) throw new Error("future crew fixture needs a departure");
  const emptyTrip = await createTrip(db, {
    shopId: shop.id,
    courseId: course.id,
    title: "Unstaffed course",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
    capacity: 8,
    plannedDives: 1,
  });
  if (!emptyTrip) throw new Error("future crew fixture needs a roster control");
  await db.insert(tripAssignments).values({ tripId: trip.id, personId: person.id });
  const booking = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Synthetic student",
    email: "future-crew-student@example.test",
  });
  if (!booking.ok) throw new Error(`future crew fixture booking failed: ${booking.reason}`);
  return NextResponse.json({
    ok: true,
    futureCrew: { tripId: trip.id, uncrewedTripId: emptyTrip.id, issueDate },
  });
}
