import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { createBooking } from "@/db/bookings";
import type { AppDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { bookings, courses } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { markTrainingDive } from "@/db/training-marks";
import { createTrip, listStaff } from "@/db/trips";
import { HOUR_MS, nowDate } from "@/lib/clock";

/** A charter with two recorded course marks, only in the guarded test route. */
export async function mixedDepthStateResponse(request: Request, db: AppDb) {
  const params = new URL(request.url).searchParams;
  if (params.get("mixedDepth") !== "1") return null;
  const shop = await getShopBySlug(db, params.get("shop") ?? DEMO_SHOP_SLUG);
  if (!shop?.isDemo) return NextResponse.json({ error: "not_available" }, { status: 404 });
  const catalog = await db.select().from(courses).where(eq(courses.shopId, shop.id));
  const intro = catalog.find((course) => course.isIntroCourse);
  const other = catalog.find(
    (course) => !course.isIntroCourse && course.certifiesLevel === "open_water",
  );
  const owner = (await listStaff(db, shop.id)).find((person) => person.roles.includes("owner"));
  if (!intro || !other || !owner) throw new Error("mixed depth fixture needs courses and owner");
  const startsAt = new Date(nowDate().getTime() + 48 * HOUR_MS);
  const endsAt = new Date(startsAt.getTime() + 4 * HOUR_MS);
  const make = (title: string, courseId?: string) =>
    createTrip(db, {
      shopId: shop.id,
      title,
      courseId,
      startsAt,
      endsAt,
      capacity: 8,
      plannedDives: 2,
    });
  const charter = await make("Mixed training charter");
  const introSession = await make("Intro session", intro.id);
  const otherSession = await make("Open Water session", other.id);
  if (!charter || !introSession || !otherSession) throw new Error("mixed depth departures missing");
  for (const [index, session] of [introSession, otherSession].entries()) {
    const seat = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: charter.id,
      fullName: index === 0 ? "Maya" : "Noah",
      email: `mixed-depth-${index}@example.test`,
    });
    if (!seat.ok) throw new Error(`mixed depth charter seat failed: ${seat.reason}`);
    const [enrollment] = await db
      .insert(bookings)
      .values({
        shopId: shop.id,
        tripId: session.id,
        personId: seat.personId,
        bookedAs: "diver",
      })
      .returning();
    if (!enrollment) throw new Error("mixed depth enrollment missing");
    const result = await markTrainingDive(db, {
      shopId: shop.id,
      bookingId: seat.bookingId,
      enrollmentBookingId: enrollment.id,
      actorPersonId: owner.person.id,
    });
    if (!result.ok) throw new Error(`mixed depth mark failed: ${result.reason}`);
  }
  return NextResponse.json({ ok: true, mixedDepth: { tripId: charter.id } });
}
