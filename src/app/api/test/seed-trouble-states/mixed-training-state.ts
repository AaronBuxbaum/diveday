import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { createBooking } from "@/db/bookings";
import type { AppDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { courses, tripAssignments } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { createTrip, listStaff } from "@/db/trips";
import { HOUR_MS, nowDate } from "@/lib/clock";

/** A synthetic overlap, reachable only through the guarded trouble-state route. */
export async function mixedTrainingStateResponse(request: Request, db: AppDb) {
  const params = new URL(request.url).searchParams;
  if (params.get("mixedTraining") !== "1") return null;
  const shop = await getShopBySlug(db, params.get("shop") ?? DEMO_SHOP_SLUG);
  if (!shop?.isDemo) return NextResponse.json({ error: "not_available" }, { status: 404 });
  const catalog = await db.select().from(courses).where(eq(courses.shopId, shop.id));
  const intro = catalog.find((course) => course.isIntroCourse);
  const entry = catalog.find(
    (course) =>
      !course.isIntroCourse &&
      course.agency.toLowerCase() === "padi" &&
      !course.minimumCertificationLevel,
  );
  const instructor = (await listStaff(db, shop.id)).find((person) =>
    person.roles.includes("instructor"),
  );
  if (!intro || !entry || !instructor)
    throw new Error("mixed training fixture needs courses and an instructor");
  const startsAt = new Date(nowDate().getTime() + 48 * HOUR_MS);
  const make = (courseId: string, title: string) =>
    createTrip(db, {
      shopId: shop.id,
      courseId,
      title,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
      capacity: 8,
      plannedDives: 1,
    });
  const a = await make(intro.id, "Intro session");
  const b = await make(entry.id, "Open Water session");
  if (!a || !b) throw new Error("mixed training fixture sessions missing");
  await db.insert(tripAssignments).values([
    { tripId: a.id, personId: instructor.person.id },
    { tripId: b.id, personId: instructor.person.id },
  ]);
  const booking = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: b.id,
    fullName: "Training student",
    email: "training-student@example.test",
  });
  if (!booking.ok) throw new Error(`mixed training fixture enrollment failed: ${booking.reason}`);
  return NextResponse.json({ ok: true, mixedTraining: { tripId: a.id, otherTripId: b.id } });
}
