import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { AppDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { recordRollCall } from "@/db/manifests";
import { boats, bookings, courses, people, trips } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { listStaff } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { seedOperationalTrust } from "./operational-states";

/** A long, synthetic log for the guarded print harness; never real shop data. */
export async function fiveDivePrintResponse(request: Request, db: AppDb) {
  const params = new URL(request.url).searchParams;
  if (params.get("fiveDivePrint") !== "1") return null;
  const shop = await getShopBySlug(db, params.get("shop") ?? DEMO_SHOP_SLUG);
  if (!shop?.isDemo) return NextResponse.json({ error: "not_available" }, { status: 404 });
  const now = nowDate();
  const state = await seedOperationalTrust(db, shop, "capacity", now);
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.shopId, shop.id), eq(courses.isActive, true)))
    .limit(1);
  const [actor] = await listStaff(db, shop.id);
  if (!course || !actor) throw new Error("five-dive print fixture requires a course and crew");
  await db
    .update(boats)
    .set({ capacity: 20, certifiedTotalPersons: 22 })
    .where(eq(boats.id, state.boatId));
  await db
    .update(trips)
    .set({ courseId: course.id, plannedDives: 5, capacity: 20 })
    .where(and(eq(trips.shopId, shop.id), eq(trips.id, state.tripId)));
  const [first] = state.seats;
  if (!first) throw new Error("five-dive print fixture requires a passenger");
  await db
    .update(people)
    .set({
      emergencyContactName: "Alexandria Fitzgerald-Sullivan",
      emergencyContactPhone: "+1-305-555-0148",
    })
    .where(and(eq(people.shopId, shop.id), eq(people.id, first.personId)));
  for (let index = 0; index < 10; index++) {
    const [person] = await db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: `Print passenger ${index + 1}`,
        emergencyContactName: "Alexandria Fitzgerald-Sullivan",
        emergencyContactPhone: "+1-305-555-0148",
      })
      .returning();
    if (!person) throw new Error("five-dive print fixture passenger missing");
    await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: state.tripId, personId: person.id, bookedAs: "diver" });
  }
  const mark = await recordRollCall(db, {
    shopId: shop.id,
    tripId: state.tripId,
    bookingId: first.bookingId,
    recordedByPersonId: actor.person.id,
    checkpoint: "after_dive_5",
    status: "not_boarded",
    occurredAt: now,
  });
  if (!mark.ok) throw new Error(`five-dive print mark refused: ${mark.reason}`);
  return NextResponse.json({ ok: true, tripId: state.tripId });
}
