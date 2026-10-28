import { and, eq, gt, isNotNull, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { verifyBookingCapability } from "./booking-capabilities";
import { issueCounterCourseForms } from "./course-counter-qr";
import { createCourseForm, setCourseFormRequirements } from "./course-forms";
import { bookings, people, trips } from "./schema";
import { listStaff } from "./trips";

const ctx = fileScopedShopContext();

async function fixture() {
  const { db, shop } = ctx;
  const [seat] = await db
    .select({
      id: bookings.id,
      personId: bookings.personId,
      tripId: trips.id,
      courseId: trips.courseId,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shop.id),
        isNotNull(trips.courseId),
        ne(bookings.status, "cancelled"),
        ne(trips.status, "cancelled"),
        gt(trips.startsAt, nowDate()),
      ),
    )
    .limit(1);
  if (!seat?.courseId) throw new Error("course seat missing");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("staff missing");
  await db.update(people).set({ dateOfBirth: "1990-04-02" }).where(eq(people.id, seat.personId));
  await db.update(bookings).set({ identityUnconfirmedAt: null }).where(eq(bookings.id, seat.id));
  const form = await createCourseForm(db, {
    shopId: shop.id,
    title: "Course release",
    body: "I will follow the instructor's plan for every in-water session.",
    actorPersonId: staff.person.id,
  });
  expect(
    await setCourseFormRequirements(db, {
      shopId: shop.id,
      courseId: seat.courseId,
      formIds: [form.id],
      mayNarrow: true,
    }),
  ).toEqual({ ok: true });
  return { db, shop, seat };
}

describe("counter course-form handoff", () => {
  it("issues a forms-only capability for exactly the selected roster seat", async () => {
    const { db, shop, seat } = await fixture();
    const result = await issueCounterCourseForms(db, {
      shopId: shop.id,
      tripId: seat.tripId,
      bookingId: seat.id,
    });
    if (!result) throw new Error("eligible seat refused");
    expect(
      await verifyBookingCapability(db, { token: result.token, purpose: "course_forms" }),
    ).toMatchObject({ shopId: shop.id, bookingId: seat.id });
    expect(
      await verifyBookingCapability(db, { token: result.token, purpose: "readiness" }),
    ).toBeNull();
  });

  it("refuses a wrong trip, wrong shop, held seat and canceled seat", async () => {
    const { db, shop, seat } = await fixture();
    const input = { shopId: shop.id, tripId: seat.tripId, bookingId: seat.id };
    expect(
      await issueCounterCourseForms(db, {
        ...input,
        tripId: "00000000-0000-4000-8000-000000000000",
      }),
    ).toBeNull();
    expect(
      await issueCounterCourseForms(db, {
        ...input,
        shopId: "00000000-0000-4000-8000-000000000000",
      }),
    ).toBeNull();
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate() })
      .where(eq(bookings.id, seat.id));
    expect(await issueCounterCourseForms(db, input)).toBeNull();
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: null, status: "cancelled" })
      .where(eq(bookings.id, seat.id));
    expect(await issueCounterCourseForms(db, input)).toBeNull();
  });
});
