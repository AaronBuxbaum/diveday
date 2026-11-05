import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { markReferralStudent, recordReferralPaper } from "./referral-students";
import { bookings } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

/**
 * **A referral student** (loop 5, row 10): staff mark a course seat as finished
 * theory and pool elsewhere, then tick the two papers the desk collects. A
 * staff record, never a gate, and refused on a departure that teaches nothing.
 */
const ctx = fileScopedShopContext();
const OTHER_SHOP = "00000000-0000-4000-8000-0000000000ff";

async function courseContext() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const session = trips.find((trip) => trip.title.startsWith("Advanced Open Water Diver"));
  const funDive = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!session || !funDive) throw new Error("the seeded shop is missing a course session");
  const [student] = await getTripRoster(db, shop.id, session.id);
  const [diver] = await getTripRoster(db, shop.id, funDive.id);
  if (!student || !diver) throw new Error("the seeded departures have empty rosters");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("the seeded shop has no staff");
  return {
    db,
    shop,
    staffId: staff.person.id,
    studentBookingId: student.booking.id,
    funDiveBookingId: diver.booking.id,
  };
}

async function stored(db: (typeof ctx)["db"], bookingId: string) {
  const [row] = await db
    .select({
      referredInAt: bookings.referredInAt,
      referredInBy: bookings.referredInByPersonId,
      formAt: bookings.referralFormAt,
      formBy: bookings.referralFormByPersonId,
      recordAt: bookings.referralRecordAt,
      recordBy: bookings.referralRecordByPersonId,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row;
}

describe("markReferralStudent", () => {
  it("stamps a course seat as a referral, with who said so", async () => {
    const { db, shop, staffId, studentBookingId } = await courseContext();
    const now = new Date("2026-11-05T15:00:00Z");
    expect(
      await markReferralStudent(db, {
        shopId: shop.id,
        bookingId: studentBookingId,
        staffPersonId: staffId,
        referred: true,
        now,
      }),
    ).toEqual({ ok: true });
    expect(await stored(db, studentBookingId)).toMatchObject({
      referredInAt: now,
      referredInBy: staffId,
      formAt: null,
      recordAt: null,
    });
  });

  it("keeps the first stamp when it is marked again", async () => {
    const { db, shop, staffId, studentBookingId } = await courseContext();
    const base = { shopId: shop.id, bookingId: studentBookingId, staffPersonId: staffId };
    const first = new Date("2026-11-01T09:00:00Z");
    await markReferralStudent(db, { ...base, referred: true, now: first });
    await markReferralStudent(db, { ...base, referred: true, now: new Date("2026-11-05T09:00Z") });
    expect((await stored(db, studentBookingId))?.referredInAt).toEqual(first);
  });

  it("refuses a fun dive's seat and another shop's", async () => {
    const { db, shop, staffId, studentBookingId, funDiveBookingId } = await courseContext();
    expect(
      await markReferralStudent(db, {
        shopId: shop.id,
        bookingId: funDiveBookingId,
        staffPersonId: staffId,
        referred: true,
      }),
    ).toEqual({ ok: false, reason: "not_a_course_session" });
    expect(
      await markReferralStudent(db, {
        shopId: OTHER_SHOP,
        bookingId: studentBookingId,
        staffPersonId: staffId,
        referred: true,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect((await stored(db, funDiveBookingId))?.referredInAt).toBeNull();
    expect((await stored(db, studentBookingId))?.referredInAt).toBeNull();
  });

  it("clears the referral and both papers together", async () => {
    const { db, shop, staffId, studentBookingId } = await courseContext();
    const base = { shopId: shop.id, bookingId: studentBookingId, staffPersonId: staffId };
    await markReferralStudent(db, { ...base, referred: true });
    await recordReferralPaper(db, { ...base, paper: "form", collected: true });
    await markReferralStudent(db, { ...base, referred: false });
    expect(await stored(db, studentBookingId)).toEqual({
      referredInAt: null,
      referredInBy: null,
      formAt: null,
      formBy: null,
      recordAt: null,
      recordBy: null,
    });
  });
});

describe("recordReferralPaper", () => {
  it("stamps each paper with who collected it, and takes it back", async () => {
    const { db, shop, staffId, studentBookingId } = await courseContext();
    const base = { shopId: shop.id, bookingId: studentBookingId, staffPersonId: staffId };
    const now = new Date("2026-11-05T16:00:00Z");
    await markReferralStudent(db, { ...base, referred: true });
    expect(
      await recordReferralPaper(db, { ...base, paper: "record", collected: true, now }),
    ).toEqual({ ok: true });
    expect(await stored(db, studentBookingId)).toMatchObject({
      formAt: null,
      recordAt: now,
      recordBy: staffId,
    });
    await recordReferralPaper(db, { ...base, paper: "record", collected: false });
    expect(await stored(db, studentBookingId)).toMatchObject({ recordAt: null, recordBy: null });
  });

  it("refuses a paper for a seat nobody marked as a referral", async () => {
    const { db, shop, staffId, studentBookingId } = await courseContext();
    expect(
      await recordReferralPaper(db, {
        shopId: shop.id,
        bookingId: studentBookingId,
        staffPersonId: staffId,
        paper: "form",
        collected: true,
      }),
    ).toEqual({ ok: false, reason: "not_referred" });
  });

  it("reaches nothing in another shop", async () => {
    const { db, staffId, studentBookingId, shop } = await courseContext();
    await markReferralStudent(db, {
      shopId: shop.id,
      bookingId: studentBookingId,
      staffPersonId: staffId,
      referred: true,
    });
    expect(
      await recordReferralPaper(db, {
        shopId: OTHER_SHOP,
        bookingId: studentBookingId,
        staffPersonId: staffId,
        paper: "form",
        collected: true,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect((await stored(db, studentBookingId))?.formAt).toBeNull();
  });
});
