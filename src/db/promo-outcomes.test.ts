import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookings,
  courses,
  people,
  shopPromoCodes,
  shopPromoRedemptions,
  shops,
  tripLastMinutePromos,
  trips,
} from "./schema";
import { shopPromoOutcomes } from "./shop-promos";
import { lastMinuteDealOutcomes, tripIdsSuitedToADeal } from "./trip-promos";

/**
 * What a deal and a code sold (fifth loop, item 28), over an unseeded
 * database so every checkout is the test's own.
 */

async function fixture(db: AppDb, slug: string) {
  const [shop] = await db
    .insert(shops)
    .values({ name: slug, slug, timezone: "America/New_York" })
    .returning();
  if (!shop) throw new Error("shop insert failed");
  const start = new Date("2026-06-10T13:00:00Z");
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Wreck",
      startsAt: start,
      endsAt: new Date(start.getTime() + 3 * 3_600_000),
      capacity: 10,
    })
    .returning();
  if (!trip) throw new Error("trip insert failed");
  return { shopId: shop.id, tripId: trip.id };
}

let session = 0;

async function checkout(
  db: AppDb,
  shopId: string,
  tripId: string,
  values: Partial<typeof bookingCheckouts.$inferInsert> & { seats: number },
): Promise<string> {
  const { seats, ...rest } = values;
  session += 1;
  const [row] = await db
    .insert(bookingCheckouts)
    .values({
      shopId,
      tripId,
      status: "completed",
      stripeAccountId: "acct_promo",
      stripeSessionId: `cs_promo_${session}`,
      currency: "usd",
      amountPerDiverCents: 10_000,
      totalCents: 10_000 * seats,
      ...rest,
    })
    .returning();
  if (!row) throw new Error("checkout insert failed");
  for (let seat = 0; seat < seats; seat += 1) {
    const [person] = await db
      .insert(people)
      .values({ shopId, fullName: `Diver ${session}-${seat}` })
      .returning();
    if (!person) throw new Error("person insert failed");
    const [booking] = await db
      .insert(bookings)
      .values({ bookedAs: "diver", shopId, tripId, personId: person.id })
      .returning();
    if (!booking) throw new Error("booking insert failed");
    await db.insert(bookingCheckoutBookings).values({
      shopId,
      checkoutId: row.id,
      bookingId: booking.id,
      tripCents: 10_000,
    });
  }
  return row.id;
}

describe("lastMinuteDealOutcomes", () => {
  it("counts the seats completed checkouts took on the deal, and what they settled for net of tax", async () => {
    const db = await unseededTestDb();
    const { shopId, tripId } = await fixture(db, "deal-outcomes");
    const [deal] = await db
      .insert(tripLastMinutePromos)
      .values({
        shopId,
        tripId,
        status: "sent",
        discountPercent: 20,
        code: "SAVE20-A1",
        expiresAt: new Date("2026-06-10T13:00:00Z"),
        recipientCount: 8,
      })
      .returning();
    const [quiet] = await db
      .insert(tripLastMinutePromos)
      .values({
        shopId,
        tripId,
        status: "sent",
        discountPercent: 10,
        code: "SAVE10-B2",
        expiresAt: new Date("2026-06-10T13:00:00Z"),
      })
      .returning();
    if (!deal || !quiet) throw new Error("deal insert failed");
    // Two seats settled at $176 with $16 of tax: $160 in seats.
    await checkout(db, shopId, tripId, {
      seats: 2,
      tripPromoId: deal.id,
      settledTotalCents: 17_600,
      taxCents: 1_600,
    });
    // One seat with no settled figure: the asked total.
    await checkout(db, shopId, tripId, { seats: 1, tripPromoId: deal.id });
    // An abandoned checkout sold nothing.
    await checkout(db, shopId, tripId, { seats: 3, tripPromoId: deal.id, status: "expired" });

    const outcomes = await lastMinuteDealOutcomes(db, shopId, [deal.id, quiet.id]);
    expect(outcomes.get(deal.id)).toEqual({ seats: 3, seatsCents: 26_000 });
    expect(outcomes.get(quiet.id)).toBeUndefined();
  });

  it("never reads another shop's checkouts, and answers nothing for no deals", async () => {
    const db = await unseededTestDb();
    const { shopId, tripId } = await fixture(db, "deal-owner");
    const other = await fixture(db, "deal-other");
    const [deal] = await db
      .insert(tripLastMinutePromos)
      .values({
        shopId,
        tripId,
        status: "sent",
        discountPercent: 20,
        code: "SAVE20-C3",
        expiresAt: new Date("2026-06-10T13:00:00Z"),
      })
      .returning();
    if (!deal) throw new Error("deal insert failed");
    await checkout(db, shopId, tripId, { seats: 1, tripPromoId: deal.id });
    expect((await lastMinuteDealOutcomes(db, other.shopId, [deal.id])).size).toBe(0);
    expect((await lastMinuteDealOutcomes(db, shopId, [])).size).toBe(0);
  });
});

describe("shopPromoOutcomes", () => {
  it("sums what each code took off and the asked total it was taken off", async () => {
    const db = await unseededTestDb();
    const { shopId, tripId } = await fixture(db, "code-outcomes");
    const [code] = await db
      .insert(shopPromoCodes)
      .values({ shopId, code: "SPRING", discountPercent: 10, status: "active" })
      .returning();
    const [unused] = await db
      .insert(shopPromoCodes)
      .values({ shopId, code: "WINTER", discountAmountCents: 2_000, status: "active" })
      .returning();
    if (!code || !unused) throw new Error("code insert failed");
    const snapshot = await checkout(db, shopId, tripId, {
      seats: 2,
      promoCodeId: code.id,
      appliedDiscountCents: 2_000,
    });
    // No cents snapshot: the percent of the asked total.
    const percentOnly = await checkout(db, shopId, tripId, {
      seats: 1,
      promoCodeId: code.id,
      appliedDiscountPercent: 10,
    });
    for (const checkoutId of [snapshot, percentOnly]) {
      await db
        .insert(shopPromoRedemptions)
        .values({ shopId, promoCodeId: code.id, checkoutId, amountChargedCents: 9_000 });
    }

    const outcomes = await shopPromoOutcomes(db, shopId, [code.id, unused.id]);
    expect(outcomes.get(code.id)).toEqual({ offCents: 3_000, ofCents: 30_000 });
    expect(outcomes.get(unused.id)).toBeUndefined();
    expect((await shopPromoOutcomes(db, shopId, [])).size).toBe(0);
  });
});

describe("tripIdsSuitedToADeal (dive-domain review N7)", () => {
  it("keeps scheduled public boat departures, never a course session, a pool day or a charter", async () => {
    const db = await unseededTestDb();
    const { shopId, tripId: boat } = await fixture(db, "deal-suited");
    const [course] = await db
      .insert(courses)
      .values({ shopId, title: "Open Water", slug: "open-water" })
      .returning();
    if (!course) throw new Error("course insert failed");
    const start = new Date("2026-06-11T13:00:00Z");
    const departure = async (values: Partial<typeof trips.$inferInsert>) => {
      const [row] = await db
        .insert(trips)
        .values({
          shopId,
          title: "Other",
          startsAt: start,
          endsAt: new Date(start.getTime() + 3 * 3_600_000),
          capacity: 10,
          ...values,
        })
        .returning();
      if (!row) throw new Error("trip insert failed");
      return row.id;
    };
    const others = [
      await departure({ courseId: course.id }),
      await departure({ diveMode: "pool" }),
      await departure({ isPrivate: true }),
      await departure({ status: "cancelled" }),
    ];
    expect(await tripIdsSuitedToADeal(db, shopId, [boat, ...others])).toEqual(new Set([boat]));
  });
});
