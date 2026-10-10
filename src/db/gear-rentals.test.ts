import { describe, expect, it } from "vitest";
import { fileScopedShopContext, unseededTestDb } from "@/test/db";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { createGearItem, deleteGearItem, reserveGearUnit } from "./gear";
import { createCounterRental, linkCounterRentalOrder } from "./gear-counter-rentals";
import { countGearRentalHolders, listGearRentals } from "./gear-rentals";
import { bookingPayments, gearReservations, orders, people, shops } from "./schema";
import { createTrip } from "./trips-create";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/** A setup reservation: a hand pick whose staffer already said "Assign anyway". */
const SETUP_PICK = { proposed: false, assignAnyway: true } as const;

const TODAY = "2026-10-08";

/**
 * A shop of this suite's own, like `gear.test.ts`: the demo fleet ships with
 * seeded reservations, and asserting against it would pin the demo. A fresh
 * shop also proves the reader is shop-scoped.
 */
async function rentalShop() {
  const { db } = ctx;
  const [shop] = await db
    .insert(shops)
    .values({ name: "Rental Test Divers", slug: "rental-test", timezone: "America/New_York" })
    .returning();
  if (!shop) throw new Error("rental test shop insert failed");
  return { db, shop };
}

async function unit(
  db: AppDb,
  shopId: string,
  label: string,
  size?: string,
  kind: Parameters<typeof createGearItem>[1]["kind"] = "bcd",
) {
  const outcome = await createGearItem(db, { shopId, kind, label, size });
  if (!outcome.ok) throw new Error(`create refused: ${outcome.reason}`);
  return outcome.item;
}

async function tripBooking(db: AppDb, shopId: string, name: string, title = `Reef — ${name}`) {
  const startsAt = new Date("2026-10-10T12:00:00Z");
  const trip = await createTrip(db, {
    shopId,
    title,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
    capacity: 8,
    plannedDives: 2,
  });
  if (!trip) throw new Error("trip insert failed");
  const booking = await createBooking(db, {
    shopId,
    tripId: trip.id,
    actor: "staff",
    fullName: name,
    email: `${name.toLowerCase().replace(/[^a-z]+/g, "-")}@example.com`,
  });
  if (!booking.ok) throw new Error(`booking failed: ${booking.reason}`);
  return { trip, bookingId: booking.bookingId, personId: booking.personId };
}

async function walkIn(db: AppDb, shopId: string, fullName: string) {
  const [person] = await db.insert(people).values({ shopId, fullName }).returning();
  if (!person) throw new Error("person insert failed");
  return person;
}

async function reserve(
  db: AppDb,
  input: { shopId: string; gearItemId: string; bookingId: string; from: string; until: string },
) {
  const outcome = await reserveGearUnit(db, {
    shopId: input.shopId,
    gearItemId: input.gearItemId,
    bookingId: input.bookingId,
    reservedFrom: input.from,
    reservedUntil: input.until,
    screen: SETUP_PICK,
  });
  if (!outcome.ok) throw new Error(`reserve refused: ${outcome.reason}`);
  return outcome.reservation;
}

/** A counter rental row: held by a person, no booking (the 2026-08-25 amendment). */
async function counterRental(
  db: AppDb,
  input: { shopId: string; gearItemId: string; personId: string; from: string; until: string },
  stamps: { checkedOutAt?: Date; returnedAt?: Date } = {},
) {
  const [row] = await db
    .insert(gearReservations)
    .values({
      shopId: input.shopId,
      gearItemId: input.gearItemId,
      personId: input.personId,
      reservedFrom: input.from,
      reservedUntil: input.until,
      // One stamp for every row a test writes for a person: a counter rental is
      // named by its transaction's stamp, and these rows stand in for one.
      createdAt: new Date("2026-10-08T12:00:00Z"),
      ...stamps,
    })
    .returning();
  if (!row) throw new Error("counter rental insert failed");
  return row;
}

describe("listGearRentals", () => {
  it("lists trip rentals and counter rentals together, each under its holder", async () => {
    const { db, shop } = await rentalShop();
    const bcd = await unit(db, shop.id, "BCD #1", "M");
    const reg = await unit(db, shop.id, "Reg #1");
    const ana = await tripBooking(db, shop.id, "Ana Diaz", "Wreck Trip");
    await reserve(db, {
      shopId: shop.id,
      gearItemId: bcd.id,
      bookingId: ana.bookingId,
      from: "2026-10-10",
      until: "2026-10-10",
    });
    const walker = await walkIn(db, shop.id, "Walk In");
    await counterRental(db, {
      shopId: shop.id,
      gearItemId: reg.id,
      personId: walker.id,
      from: "2026-10-08",
      until: "2026-10-09",
    });

    const page = await listGearRentals(db, shop.id, { todayLocal: TODAY });
    expect(page.total).toBe(2);
    expect(page.rows.map((holder) => holder.name)).toEqual(["Walk In", "Ana Diaz"]);

    const [counter, trip] = page.rows;
    expect(counter?.personId).toBe(walker.id);
    expect(counter?.rentals[0]).toMatchObject({ bookingId: null, phase: "reserved" });
    expect(counter?.rentals[0]?.units[0]).toMatchObject({
      label: "Reg #1",
      kind: "bcd",
      tripId: null,
      tripTitle: null,
      money: null,
    });

    expect(trip?.personId).toBe(ana.personId);
    expect(trip?.rentals[0]).toMatchObject({
      bookingId: ana.bookingId,
      from: "2026-10-10",
      until: "2026-10-10",
    });
    expect(trip?.rentals[0]?.units[0]).toMatchObject({
      label: "BCD #1",
      size: "M",
      tripId: ana.trip.id,
      tripTitle: "Wreck Trip",
    });
  });

  it("leaves out what came home, what was deleted, and what another shop holds", async () => {
    const { db, shop } = await rentalShop();
    const home = await unit(db, shop.id, "BCD #home");
    const gone = await unit(db, shop.id, "BCD #gone");
    const kept = await unit(db, shop.id, "BCD #kept");
    const diver = await walkIn(db, shop.id, "Pat Lee");
    await counterRental(
      db,
      { shopId: shop.id, gearItemId: home.id, personId: diver.id, from: TODAY, until: TODAY },
      {
        checkedOutAt: new Date("2026-10-08T12:00:00Z"),
        returnedAt: new Date("2026-10-08T18:00:00Z"),
      },
    );
    // A lapsed claim nobody collected does not stop a delete (`deleteGearItem`),
    // so its open row outlives the unit — and must not outlive it here.
    await counterRental(db, {
      shopId: shop.id,
      gearItemId: gone.id,
      personId: diver.id,
      from: "2026-09-01",
      until: "2026-09-02",
    });
    const deleted = await deleteGearItem(db, {
      shopId: shop.id,
      gearItemId: gone.id,
      todayLocal: TODAY,
    });
    expect(deleted.ok).toBe(true);
    await counterRental(db, {
      shopId: shop.id,
      gearItemId: kept.id,
      personId: diver.id,
      from: "2026-11-01",
      until: "2026-11-02",
    });

    const rival = await rivalShop(db);
    const rivalUnit = await unit(db, rival.id, "BCD #rival");
    const rivalDiver = await walkIn(db, rival.id, "Rival Diver");
    await counterRental(db, {
      shopId: rival.id,
      gearItemId: rivalUnit.id,
      personId: rivalDiver.id,
      from: TODAY,
      until: TODAY,
    });

    const page = await listGearRentals(db, shop.id, { todayLocal: TODAY });
    const labels = page.rows.flatMap((holder) =>
      holder.rentals.flatMap((rental) => rental.units.map((row) => row.label)),
    );
    expect(labels).toEqual(["BCD #kept"]);
    expect(await countGearRentalHolders(db, shop.id)).toBe(1);
    expect(await countGearRentalHolders(db, rival.id)).toBe(1);
  });

  it("includes a reservation that starts next month, and leads with the overdue", async () => {
    const { db, shop } = await rentalShop();
    const late = await unit(db, shop.id, "BCD #late");
    const later = await unit(db, shop.id, "BCD #later");
    const early = await walkIn(db, shop.id, "Zoe Late");
    const future = await walkIn(db, shop.id, "Abe Future");
    await counterRental(
      db,
      {
        shopId: shop.id,
        gearItemId: late.id,
        personId: early.id,
        from: "2026-10-01",
        until: "2026-10-03",
      },
      { checkedOutAt: new Date("2026-10-01T12:00:00Z") },
    );
    await counterRental(db, {
      shopId: shop.id,
      gearItemId: later.id,
      personId: future.id,
      from: "2026-11-20",
      until: "2026-11-21",
    });

    const page = await listGearRentals(db, shop.id, { todayLocal: TODAY });
    expect(page.rows.map((holder) => [holder.name, holder.rentals[0]?.phase])).toEqual([
      ["Zoe Late", "overdue"],
      ["Abe Future", "reserved"],
    ]);
  });

  it("says whether a trip rental is paid: the booking's order first, then its payment row", async () => {
    const { db, shop } = await rentalShop();
    const ordered = await tripBooking(db, shop.id, "Olga Order");
    const marked = await tripBooking(db, shop.id, "Pia Payment");
    const silent = await tripBooking(db, shop.id, "Sam Silent");
    for (const [index, booking] of [ordered, marked, silent].entries()) {
      const item = await unit(db, shop.id, `BCD #${index}`);
      await reserve(db, {
        shopId: shop.id,
        gearItemId: item.id,
        bookingId: booking.bookingId,
        from: "2026-10-10",
        until: "2026-10-10",
      });
    }
    // The order outranks the booking's payment row, as on the diver record.
    await db.insert(bookingPayments).values([
      { shopId: shop.id, bookingId: ordered.bookingId, status: "unpaid", currency: "usd" },
      { shopId: shop.id, bookingId: marked.bookingId, status: "paid", currency: "usd" },
    ]);
    const [order] = await db
      .insert(orders)
      .values({
        shopId: shop.id,
        bookingId: ordered.bookingId,
        personId: ordered.personId,
        createdByPersonId: ordered.personId,
        status: "paid",
        currency: "usd",
        totalCents: 4500,
        stripeAccountId: "acct_rental",
        stripeCustomerId: "cus_rental",
        stripeInvoiceId: "in_rental_paid",
      })
      .returning();
    if (!order) throw new Error("order insert failed");

    const page = await listGearRentals(db, shop.id, { todayLocal: TODAY });
    const moneyOf = (name: string) =>
      page.rows.find((holder) => holder.name === name)?.rentals[0]?.units[0]?.money;
    expect(moneyOf("Olga Order")).toEqual({ source: "order", status: "paid", orderId: order.id });
    expect(moneyOf("Pia Payment")).toEqual({ source: "payment", status: "paid" });
    expect(moneyOf("Sam Silent")).toBeNull();
  });

  it("pages by holder, so one diver's set never splits across two pages", async () => {
    const { db, shop } = await rentalShop();
    for (const name of ["Ann", "Ben", "Cat"]) {
      const diver = await walkIn(db, shop.id, name);
      for (const n of [1, 2]) {
        const item = await unit(db, shop.id, `BCD ${name} ${n}`);
        await counterRental(db, {
          shopId: shop.id,
          gearItemId: item.id,
          personId: diver.id,
          from: TODAY,
          until: TODAY,
        });
      }
    }
    const first = await listGearRentals(db, shop.id, { todayLocal: TODAY, pageSize: 2 });
    expect(first).toMatchObject({ page: 1, pageCount: 2, total: 3 });
    expect(first.rows.map((holder) => holder.rentals[0]?.units.length)).toEqual([2, 2]);
    const second = await listGearRentals(db, shop.id, { todayLocal: TODAY, pageSize: 2, page: 9 });
    expect(second.page).toBe(2);
    expect(second.rows).toHaveLength(1);
  });
});

describe("listGearRentals, counter rentals", () => {
  /**
   * A fresh database rather than the per-file rolled-back transaction, as in
   * `gear-counter-rentals.test.ts`: a counter rental is named by the stamp
   * Postgres gives its own transaction, and one long test transaction would
   * give two rentals the same instant.
   */
  async function counterShop() {
    const db = await unseededTestDb();
    const [shop] = await db
      .insert(shops)
      .values({
        name: "Counter Rentals",
        slug: "counter-rentals-view",
        timezone: "America/New_York",
      })
      .returning();
    if (!shop) throw new Error("shop insert failed");
    return { db, shop };
  }

  it("keeps one person's two counter rentals apart, each with its own invoice's money word", async () => {
    const { db, shop } = await counterShop();
    const ana = await walkIn(db, shop.id, "Ana Walk-In");
    // Soft goods: a walk-in with no verified card may rent them, where a BCD
    // or a regulator would be refused at the counter (layer 1's card check).
    const mask = await unit(db, shop.id, "Mask #1", undefined, "mask");
    const suit = await unit(db, shop.id, "3mm #1", "M", "wetsuit");
    const fins = await unit(db, shop.id, "Fins #1", undefined, "fins");
    const first = await createCounterRental(db, {
      shopId: shop.id,
      personId: ana.id,
      gearItemIds: [mask.id, suit.id],
      reservedFrom: TODAY,
      reservedUntil: "2026-10-09",
      todayLocal: TODAY,
    });
    const second = await createCounterRental(db, {
      shopId: shop.id,
      personId: ana.id,
      gearItemIds: [fins.id],
      reservedFrom: "2026-10-12",
      reservedUntil: "2026-10-12",
      todayLocal: TODAY,
    });
    if (!first.ok || !second.ok) throw new Error("rental refused");
    const [order] = await db
      .insert(orders)
      .values({
        shopId: shop.id,
        personId: ana.id,
        createdByPersonId: ana.id,
        status: "paid",
        currency: "usd",
        totalCents: 6000,
        stripeAccountId: "acct_counter",
        stripeCustomerId: "cus_counter",
        stripeInvoiceId: "in_counter_paid",
      })
      .returning();
    if (!order) throw new Error("order insert failed");
    await linkCounterRentalOrder(db, {
      shopId: shop.id,
      reservationIds: first.reservationIds,
      orderId: order.id,
    });

    const page = await listGearRentals(db, shop.id, { todayLocal: TODAY });
    expect(page.total).toBe(1);
    const rentals = page.rows[0]?.rentals ?? [];
    expect(rentals.map((rental) => rental.units.map((row) => row.label))).toEqual([
      ["3mm #1", "Mask #1"],
      ["Fins #1"],
    ]);
    expect(rentals.every((rental) => rental.bookingId === null)).toBe(true);
    expect(rentals[0]?.units[0]?.money).toEqual({
      source: "order",
      status: "paid",
      orderId: order.id,
    });
    expect(rentals[1]?.units[0]?.money).toBeNull();
  });
});

async function rivalShop(db: AppDb) {
  const [rival] = await db
    .insert(shops)
    .values({ name: "Rival Rentals", slug: "rival-rentals", timezone: "America/New_York" })
    .returning();
  if (!rival) throw new Error("rival shop insert failed");
  return rival;
}
