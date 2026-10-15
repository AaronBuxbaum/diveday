import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { fileScopedShopContext } from "@/test/db";
import { checkInBooking, undoCheckInBooking } from "./check-in";
import { getDisputeSheet } from "./dispute-sheet";
import { recordRollCall } from "./manifests";
import { activityEvents, orderLineItems, orders, shops, trips, waiverRecords } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

const ctx = fileScopedShopContext();
const referral = {
  ...emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
  responses: { ...emptyMedicalAnswers(RSTC_QUESTIONNAIRE).responses, q3: true },
};

/** The reef departure's first seat with a paid deposit order raised for it. */
async function paidSeat() {
  const { db, shop } = ctx;
  const [reef] = (await upcomingTripsWithCounts(db, shop.id)).filter(
    (trip) => trip.title === "Two-Tank Reef — Molasses & French",
  );
  const [staff] = await listStaff(db, shop.id);
  const [entry] = reef ? await getTripRoster(db, shop.id, reef.id) : [];
  if (!reef || !staff || !entry) throw new Error("seeded reef seat missing");
  const [order] = await db
    .insert(orders)
    .values({
      shopId: shop.id,
      bookingId: entry.booking.id,
      personId: entry.person.id,
      createdByPersonId: staff.person.id,
      status: "paid",
      currency: "usd",
      totalCents: 5400,
      taxCents: 400,
      amountPaidCents: 5400,
      description: "Trip deposit",
      stripeAccountId: "acct_dispute",
      stripeCustomerId: "cus_dispute",
      stripeInvoiceId: "in_dispute",
      paidAt: nowDate(),
    })
    .returning();
  if (!order) throw new Error("order insert failed");
  await db.insert(orderLineItems).values({
    shopId: shop.id,
    orderId: order.id,
    kind: "deposit",
    description: "Trip deposit",
    quantity: 1,
    unitAmountCents: 5000,
  });
  return { db, shop, reef, staff: staff.person, entry, order };
}

const sheetFor = (seat: Awaited<ReturnType<typeof paidSeat>>) =>
  getDisputeSheet(seat.db, seat.shop.id, seat.order.id, seat.shop.name, "UTC");

describe("getDisputeSheet", () => {
  it("assembles the order, signature, check-in and roll call for one seat", async () => {
    const seat = await paidSeat();
    const issued = await issueWaiverRequest(seat.db, {
      shopId: seat.shop.id,
      bookingId: seat.entry.booking.id,
    });
    if (!issued.ok) throw new Error("waiver issue failed");
    await completeWaiver(seat.db, issued.token, {
      signerName: seat.entry.person.fullName,
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
    });
    await checkInBooking(seat.db, {
      shopId: seat.shop.id,
      bookingId: seat.entry.booking.id,
      recordedByPersonId: seat.staff.id,
    });
    await recordRollCall(seat.db, {
      shopId: seat.shop.id,
      tripId: seat.reef.id,
      bookingId: seat.entry.booking.id,
      recordedByPersonId: seat.staff.id,
      status: "boarded",
    });

    const sheet = await sheetFor(seat);
    expect(sheet?.diverName).toBe(seat.entry.person.fullName);
    expect(sheet?.order.lines).toEqual([
      { description: "Trip deposit", kind: "deposit", quantity: 1, unitAmountCents: 5000 },
    ]);
    expect(sheet?.waiver).toMatchObject({
      signedName: seat.entry.person.fullName,
      method: "online",
      templateVersion: expect.any(Number),
    });
    expect(sheet?.checkIn?.recordedByName).toBe(seat.staff.fullName);
    expect(sheet?.rollCall[0]).toMatchObject({ checkpoint: "departure", result: "boarded" });
    expect(sheet?.rollCall[1]).toMatchObject({
      checkpoint: "after_dive_1",
      result: "not_recorded",
    });
    expect(sheet?.activity.map((line) => line.code)).toContain("counter_check_in");
  });

  it("prints no medical answer for a diver whose release was referred to a physician", async () => {
    const seat = await paidSeat();
    const issued = await issueWaiverRequest(seat.db, {
      shopId: seat.shop.id,
      bookingId: seat.entry.booking.id,
    });
    if (!issued.ok) throw new Error("waiver issue failed");
    await completeWaiver(seat.db, issued.token, {
      signerName: seat.entry.person.fullName,
      agreed: true,
      medicalAnswers: referral,
    });
    const [record] = await seat.db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.bookingId, seat.entry.booking.id));
    // The fixture is the point: this record really is a referral holding the
    // answers the sheet must not print.
    expect(record?.status).toBe("medical_review");
    expect(record?.medicalAnswers?.responses.q3).toBe(true);

    const sheet = await sheetFor(seat);
    // The signature itself is evidence and still prints.
    expect(sheet?.waiver?.signedName).toBe(seat.entry.person.fullName);
    const printed = JSON.stringify(sheet);
    for (const leaked of ["medical", "q3", "responses", "questionnaire", "review", "RSTC"]) {
      expect(printed).not.toContain(leaked);
    }
  });

  it("shows no check-in once the desk took the arrival back", async () => {
    const seat = await paidSeat();
    const input = {
      shopId: seat.shop.id,
      bookingId: seat.entry.booking.id,
      recordedByPersonId: seat.staff.id,
    };
    const issued = await issueWaiverRequest(seat.db, {
      shopId: seat.shop.id,
      bookingId: seat.entry.booking.id,
    });
    if (!issued.ok) throw new Error("waiver issue failed");
    await completeWaiver(seat.db, issued.token, {
      signerName: seat.entry.person.fullName,
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
    });
    await checkInBooking(seat.db, input);
    await undoCheckInBooking(seat.db, input);
    expect((await sheetFor(seat))?.checkIn).toBeNull();
  });

  it("does not show a release signed after the boat left", async () => {
    const seat = await paidSeat();
    const issued = await issueWaiverRequest(seat.db, {
      shopId: seat.shop.id,
      bookingId: seat.entry.booking.id,
    });
    if (!issued.ok) throw new Error("waiver issue failed");
    await completeWaiver(seat.db, issued.token, {
      signerName: seat.entry.person.fullName,
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
    });
    // The departure moves to before the signature: it was signed afterwards.
    await seat.db
      .update(trips)
      .set({ startsAt: new Date(nowDate().getTime() - 24 * 60 * 60 * 1000) })
      .where(eq(trips.id, seat.reef.id));
    expect((await sheetFor(seat))?.waiver).toBeNull();
  });

  it("leaves staff-only and medical-adjacent trail lines off the sheet", async () => {
    const seat = await paidSeat();
    await seat.db.insert(activityEvents).values([
      {
        shopId: seat.shop.id,
        tripId: seat.reef.id,
        bookingId: seat.entry.booking.id,
        actorPersonId: seat.staff.id,
        code: "medical_clearance_opened",
        params: { actor: seat.staff.fullName, diver: seat.entry.person.fullName },
      },
      {
        shopId: seat.shop.id,
        tripId: seat.reef.id,
        bookingId: seat.entry.booking.id,
        actorPersonId: seat.staff.id,
        code: "seat_added",
        params: { actor: seat.staff.fullName, diver: seat.entry.person.fullName },
      },
    ]);
    const codes = (await sheetFor(seat))?.activity.map((line) => line.code);
    expect(codes).toContain("seat_added");
    expect(codes).not.toContain("medical_clearance_opened");
  });

  it("resolves nothing for another shop's order, a junk id, or an order with no seat", async () => {
    const seat = await paidSeat();
    const [other] = await seat.db
      .insert(shops)
      .values({ name: "Elsewhere Diving", slug: "elsewhere-dispute", timezone: "UTC" })
      .returning({ id: shops.id });
    if (!other) throw new Error("shop insert failed");
    expect(await getDisputeSheet(seat.db, other.id, seat.order.id, "Elsewhere", "UTC")).toBeNull();
    expect(await getDisputeSheet(seat.db, seat.shop.id, "not-a-uuid", "x", "UTC")).toBeNull();

    await seat.db.update(orders).set({ bookingId: null }).where(eq(orders.id, seat.order.id));
    expect(await sheetFor(seat)).toBeNull();
  });
});
