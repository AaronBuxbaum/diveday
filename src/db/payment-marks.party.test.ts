import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { addPartySeat, createBooking } from "./bookings";
import { markPartyPaid, previewPartyPayment } from "./payment-marks";
import { getBookingPayment, setBookingPayment } from "./payments";
import { bookings, trips } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

const FARE = 12_000;

/** A lead and two friends on a priced departure, every seat unpaid. `seatIds` are in the order a payment reaches them: Ada, then Milo. */
async function aPartyOfThree() {
  const { db, shop } = ctx;
  const all = await upcomingTripsWithCounts(db, shop.id);
  const trip = all.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  const other = all.find((t) => t.id !== trip?.id);
  if (!trip || !other) throw new Error("expected seeded trips missing");
  await db.update(trips).set({ priceCents: FARE }).where(eq(trips.id, trip.id));
  const lead = await createBooking(db, {
    actor: "public",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Nora Quinn",
    email: "nora-party-pay@example.com",
  });
  if (!lead.ok) throw new Error(`lead booking failed: ${lead.reason}`);
  const seats: string[] = [];
  for (const seatName of ["Ada Quinn", "Milo Quinn"]) {
    const added = await addPartySeat(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
      seatName,
    });
    if (!added.ok) throw new Error(`seat ${seatName} refused`);
    seats.push(added.bookingId);
  }
  const [leadRow] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.id, lead.bookingId));
  const base = {
    shopId: shop.id,
    tripId: trip.id,
    leadBookingId: lead.bookingId,
    method: "cash" as const,
    // What the preview would have shown: the whole party owes three fares.
    expectedOwedCents: FARE * 3,
    currency: "usd",
    recordedByPersonId: leadRow?.personId ?? "",
  };
  return { db, shop, trip, other, leadId: lead.bookingId, seatIds: seats, base };
}

async function held(seatId: string) {
  const payment = await getBookingPayment(ctx.db, ctx.shop.id, seatId);
  return payment ? { status: payment.status, amountCents: payment.amountCents } : null;
}

describe("markPartyPaid", () => {
  it("pays every seat its balance when the amount is exactly what the party owes", async () => {
    const { leadId, seatIds, base, db } = await aPartyOfThree();
    const result = await markPartyPaid(db, { ...base, amountCents: FARE * 3 });
    expect(result.kind).toBe("split");
    for (const id of [leadId, ...seatIds]) {
      expect(await held(id)).toEqual({ status: "paid", amountCents: FARE });
    }
  });

  it("leaves a deposit on the seat the money runs out on and the rest owing, writing nothing off", async () => {
    const { leadId, seatIds, base, db } = await aPartyOfThree();
    const result = await markPartyPaid(db, { ...base, amountCents: FARE + 5_000 });
    expect(result).toMatchObject({ kind: "split", unspentCents: FARE * 3 - FARE - 5_000 });
    expect(await held(leadId)).toEqual({ status: "paid", amountCents: FARE });
    expect(await held(seatIds[0] as string)).toEqual({
      status: "deposit_paid",
      amountCents: 5_000,
    });
    expect(await held(seatIds[1] as string)).toBeNull();
  });

  it("adds to a deposit already taken by hand instead of replacing it", async () => {
    const { seatIds, base, db, shop, leadId } = await aPartyOfThree();
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: seatIds[0] as string,
      status: "deposit_paid",
      currency: "usd",
      amountCents: 3_000,
      method: "cash",
    });
    // The lead, then the deposit seat's remaining 9,000, then 1,000 on the last.
    await markPartyPaid(db, {
      ...base,
      expectedOwedCents: FARE * 3 - 3_000,
      amountCents: FARE + 9_000 + 1_000,
    });
    expect(await held(leadId)).toEqual({ status: "paid", amountCents: FARE });
    expect(await held(seatIds[0] as string)).toEqual({ status: "paid", amountCents: FARE });
    expect(await held(seatIds[1] as string)).toEqual({
      status: "deposit_paid",
      amountCents: 1_000,
    });
  });

  it("refuses more than the party owes and writes nothing", async () => {
    const { leadId, seatIds, base, db } = await aPartyOfThree();
    const result = await markPartyPaid(db, { ...base, amountCents: FARE * 3 + 1 });
    expect(result).toEqual({ kind: "over", owedCents: FARE * 3 });
    for (const id of [leadId, ...seatIds]) expect(await held(id)).toBeNull();
  });

  it("refuses the whole party when a seat that still owes was paid online", async () => {
    const { leadId, seatIds, base, db, shop } = await aPartyOfThree();
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: seatIds[1] as string,
      status: "deposit_paid",
      currency: "usd",
      amountCents: 2_000,
      provider: "stripe",
      providerRef: "pi_party",
    });
    const result = await markPartyPaid(db, { ...base, amountCents: FARE });
    expect(result.kind).toBe("refused");
    // Nothing landed on the seats that could have taken it, and the online
    // payment still points at its Stripe record.
    expect(await held(leadId)).toBeNull();
    expect((await getBookingPayment(db, shop.id, seatIds[1] as string))?.provider).toBe("stripe");
  });

  it("skips a seat already paid online in full rather than refusing", async () => {
    const { leadId, seatIds, base, db, shop } = await aPartyOfThree();
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: seatIds[0] as string,
      status: "paid",
      currency: "usd",
      amountCents: FARE,
      provider: "stripe",
      providerRef: "pi_whole",
    });
    const result = await markPartyPaid(db, {
      ...base,
      expectedOwedCents: FARE * 2,
      amountCents: FARE * 2,
    });
    expect(result.kind).toBe("split");
    expect(await held(leadId)).toEqual({ status: "paid", amountCents: FARE });
    expect((await getBookingPayment(db, shop.id, seatIds[0] as string))?.provider).toBe("stripe");
    expect(await held(seatIds[1] as string)).toEqual({ status: "paid", amountCents: FARE });
  });

  it("says so when no seat owes anything", async () => {
    const { base, db } = await aPartyOfThree();
    await markPartyPaid(db, { ...base, amountCents: FARE * 3 });
    expect(await markPartyPaid(db, { ...base, expectedOwedCents: 0, amountCents: 100 })).toEqual({
      kind: "nothing_owed",
    });
  });

  it("takes a payment once: a replay of the same confirm is refused and adds nothing (#2605)", async () => {
    const { leadId, seatIds, base, db } = await aPartyOfThree();
    const first = await markPartyPaid(db, { ...base, amountCents: 10_000 });
    expect(first.kind).toBe("split");
    const replay = await markPartyPaid(db, { ...base, amountCents: 10_000 });
    expect(replay).toEqual({ kind: "changed" });
    expect(await held(leadId)).toEqual({ status: "deposit_paid", amountCents: 10_000 });
    for (const id of seatIds) expect(await held(id)).toBeNull();
  });

  it("refuses a confirm whose preview named a different owed total, and writes nothing", async () => {
    const { leadId, seatIds, base, db } = await aPartyOfThree();
    const result = await markPartyPaid(db, {
      ...base,
      expectedOwedCents: FARE * 3 + 1,
      amountCents: FARE,
    });
    expect(result).toEqual({ kind: "changed" });
    for (const id of [leadId, ...seatIds]) expect(await held(id)).toBeNull();
  });

  it("does not pay a cancelled seat", async () => {
    const { base, db, seatIds, shop } = await aPartyOfThree();
    const { cancelBooking } = await import("./bookings");
    await cancelBooking(db, shop.id, seatIds[1] as string);
    const result = await markPartyPaid(db, { ...base, amountCents: FARE * 3 });
    expect(result).toEqual({ kind: "over", owedCents: FARE * 2 });
  });

  it("finds no party for a lead in another shop or on another departure", async () => {
    const { base, db, other } = await aPartyOfThree();
    const otherShop = "00000000-0000-4000-8000-000000000000";
    expect(await markPartyPaid(db, { ...base, shopId: otherShop, amountCents: FARE })).toEqual({
      kind: "not_found",
    });
    expect(await markPartyPaid(db, { ...base, tripId: other.id, amountCents: FARE })).toEqual({
      kind: "not_found",
    });
  });

  it("previews the same split without writing it", async () => {
    const { leadId, seatIds, base, db } = await aPartyOfThree();
    const preview = await previewPartyPayment(db, { ...base, amountCents: FARE + 5_000 });
    expect(preview).toMatchObject({
      kind: "split",
      unspentCents: FARE * 3 - FARE - 5_000,
      shares: [
        { bookingId: leadId, personName: "Nora Quinn", amountCents: FARE, settles: true },
        { bookingId: seatIds[0], personName: "Ada Quinn", amountCents: 5_000, settles: false },
      ],
    });
    for (const id of [leadId, ...seatIds]) expect(await held(id)).toBeNull();
  });
});
