import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { deleteDiver } from "./divers";
import {
  checkOutGearReservation,
  createGearItem,
  deleteGearItem,
  gearRegisterGroups,
  getGearItemDetail,
  listAvailableGearUnits,
  listGearDueBack,
  listOverdueGearReservations,
  openServiceConcerns,
  releaseGearReservation,
  reserveGearUnit,
  returnGearReservation,
  setGearItemStatus,
} from "./gear";
import {
  COUNTER_RENTAL_MAX_UNITS,
  checkOutCounterRental,
  counterRentalTicketIdForOrder,
  createCounterRental,
  getCounterRentalTicket,
  linkCounterRentalOrder,
  listOpenCounterRentalsForPerson,
  releaseCounterRental,
  returnCounterRental,
} from "./gear-counter-rentals";
import { gearReservations, orders, people, personRoles, shops } from "./schema";
import { createTrip } from "./trips-create";

const TODAY = "2026-10-08";

/**
 * Every test gets a fresh database rather than the per-file rolled-back
 * transaction: a counter rental is identified by the stamp Postgres gives its
 * transaction, and inside one long test transaction every `now()` is the same
 * instant, which would fold two rentals into one.
 */
async function rentalShop(slug = "counter-test") {
  const db = await unseededTestDb();
  const shop = await insertShop(db, slug);
  return { db, shop };
}

async function insertShop(db: AppDb, slug: string) {
  const [shop] = await db
    .insert(shops)
    .values({ name: `Shop ${slug}`, slug, timezone: "America/New_York" })
    .returning();
  if (!shop) throw new Error("shop insert failed");
  return shop;
}

async function person(db: AppDb, shopId: string, fullName: string, email?: string) {
  const [row] = await db
    .insert(people)
    .values({ shopId, fullName, email: email ?? null })
    .returning();
  if (!row) throw new Error("person insert failed");
  await db.insert(personRoles).values({ personId: row.id, role: "diver" });
  return row;
}

async function unit(
  db: AppDb,
  shopId: string,
  label: string,
  kind: "bcd" | "regulator" | "fins" = "bcd",
) {
  const created = await createGearItem(db, { shopId, kind, label, size: "M" });
  if (!created.ok) throw new Error(`unit refused: ${created.reason}`);
  return created.item;
}

function rented(outcome: Awaited<ReturnType<typeof createCounterRental>>) {
  if (!outcome.ok) throw new Error(`rental refused: ${outcome.reason}`);
  return outcome;
}

describe("createCounterRental", () => {
  it("lends several units to a person in one act, held by the person and no booking", async () => {
    const { db, shop } = await rentalShop();
    const ana = await person(db, shop.id, "Ana Walk-In");
    const bcd = await unit(db, shop.id, "BCD #1");
    const reg = await unit(db, shop.id, "Reg #1", "regulator");

    const outcome = rented(
      await createCounterRental(db, {
        shopId: shop.id,
        personId: ana.id,
        gearItemIds: [bcd.id, reg.id],
        reservedFrom: TODAY,
        reservedUntil: "2026-10-10",
        todayLocal: TODAY,
      }),
    );
    expect(outcome.reservationIds).toHaveLength(2);

    const rows = await db
      .select()
      .from(gearReservations)
      .where(eq(gearReservations.shopId, shop.id));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.personId).toBe(ana.id);
      expect(row.bookingId).toBeNull();
      expect(row.reservedFrom).toBe(TODAY);
      expect(row.reservedUntil).toBe("2026-10-10");
      expect(row.checkedOutAt).toBeNull();
      expect(row.orderId).toBeNull();
    }
  });

  it("refuses a unit already spoken for on overlapping days, by name, and writes nothing", async () => {
    const { db, shop } = await rentalShop();
    const ana = await person(db, shop.id, "Ana Walk-In");
    const ben = await person(db, shop.id, "Ben Walk-In");
    const bcd = await unit(db, shop.id, "BCD #1");
    const reg = await unit(db, shop.id, "Reg #1", "regulator");
    rented(
      await createCounterRental(db, {
        shopId: shop.id,
        personId: ana.id,
        gearItemIds: [reg.id],
        reservedFrom: "2026-10-09",
        reservedUntil: "2026-10-11",
        todayLocal: TODAY,
      }),
    );

    // Ben wants the BCD (free) and the regulator (Ana's from the 9th).
    expect(
      await createCounterRental(db, {
        shopId: shop.id,
        personId: ben.id,
        gearItemIds: [bcd.id, reg.id],
        reservedFrom: TODAY,
        reservedUntil: "2026-10-09",
        todayLocal: TODAY,
      }),
    ).toEqual({ ok: false, reason: "unit_unavailable", unitLabel: "Reg #1" });

    // All or nothing: the free BCD was not lent either.
    const bens = await db
      .select()
      .from(gearReservations)
      .where(eq(gearReservations.personId, ben.id));
    expect(bens).toEqual([]);
  });

  it("is refused by the same constraint against a trip rental — one wall, two holder shapes", async () => {
    const { db, shop } = await rentalShop();
    const bcd = await unit(db, shop.id, "BCD #1");
    const startsAt = new Date("2026-10-09T12:00:00Z");
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Reef",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
      capacity: 6,
    });
    if (!trip) throw new Error("trip insert failed");
    const booking = await createBooking(db, {
      shopId: shop.id,
      tripId: trip.id,
      actor: "staff",
      fullName: "Cara Boat",
      email: "cara@example.com",
    });
    if (!booking.ok) throw new Error("booking failed");
    expect(
      (
        await reserveGearUnit(db, {
          shopId: shop.id,
          gearItemId: bcd.id,
          bookingId: booking.bookingId,
          reservedFrom: "2026-10-09",
          reservedUntil: "2026-10-09",
        })
      ).ok,
    ).toBe(true);

    const ana = await person(db, shop.id, "Ana Walk-In");
    expect(
      await createCounterRental(db, {
        shopId: shop.id,
        personId: ana.id,
        gearItemIds: [bcd.id],
        reservedFrom: TODAY,
        reservedUntil: "2026-10-12",
        todayLocal: TODAY,
      }),
    ).toEqual({ ok: false, reason: "unit_unavailable", unitLabel: "BCD #1" });

    // And the other way round: the trip writer is refused by a counter rental.
    const reg = await unit(db, shop.id, "Reg #1", "regulator");
    rented(
      await createCounterRental(db, {
        shopId: shop.id,
        personId: ana.id,
        gearItemIds: [reg.id],
        reservedFrom: TODAY,
        reservedUntil: "2026-10-12",
        todayLocal: TODAY,
      }),
    );
    expect(
      await reserveGearUnit(db, {
        shopId: shop.id,
        gearItemId: reg.id,
        bookingId: booking.bookingId,
        reservedFrom: "2026-10-09",
        reservedUntil: "2026-10-09",
      }),
    ).toEqual({ ok: false, reason: "unit_unavailable" });
  });

  it("refuses bad windows, empty and oversized sets before touching the database", async () => {
    const { db, shop } = await rentalShop();
    const ana = await person(db, shop.id, "Ana Walk-In");
    const bcd = await unit(db, shop.id, "BCD #1");
    const base = { shopId: shop.id, personId: ana.id, todayLocal: TODAY };

    expect(
      await createCounterRental(db, {
        ...base,
        gearItemIds: [bcd.id],
        reservedFrom: "2026-10-10",
        reservedUntil: "2026-10-09",
      }),
    ).toEqual({ ok: false, reason: "invalid_window" });
    expect(
      await createCounterRental(db, {
        ...base,
        gearItemIds: [bcd.id],
        reservedFrom: "2026-10-07",
        reservedUntil: "2026-10-09",
      }),
    ).toEqual({ ok: false, reason: "starts_in_past" });
    expect(
      await createCounterRental(db, {
        ...base,
        gearItemIds: [bcd.id],
        reservedFrom: TODAY,
        reservedUntil: "2027-10-08",
      }),
    ).toEqual({ ok: false, reason: "window_too_long" });
    expect(
      await createCounterRental(db, {
        ...base,
        gearItemIds: [],
        reservedFrom: TODAY,
        reservedUntil: TODAY,
      }),
    ).toEqual({ ok: false, reason: "no_units" });
    expect(
      await createCounterRental(db, {
        ...base,
        gearItemIds: Array.from(
          { length: COUNTER_RENTAL_MAX_UNITS + 1 },
          (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        ),
        reservedFrom: TODAY,
        reservedUntil: TODAY,
      }),
    ).toEqual({ ok: false, reason: "too_many_units" });
  });

  it("keeps tenancy: another shop's person or unit, a deleted unit or person, reads as not found", async () => {
    const { db, shop } = await rentalShop();
    const rival = await insertShop(db, "rival-counter");
    const ana = await person(db, shop.id, "Ana Walk-In");
    const rivalPerson = await person(db, rival.id, "Rival Diver");
    const bcd = await unit(db, shop.id, "BCD #1");
    const rivalUnit = await unit(db, rival.id, "BCD #9");
    const base = { shopId: shop.id, reservedFrom: TODAY, reservedUntil: TODAY, todayLocal: TODAY };

    expect(
      await createCounterRental(db, { ...base, personId: rivalPerson.id, gearItemIds: [bcd.id] }),
    ).toEqual({ ok: false, reason: "person_not_found" });
    expect(
      await createCounterRental(db, {
        ...base,
        personId: ana.id,
        gearItemIds: [bcd.id, rivalUnit.id],
      }),
    ).toEqual({ ok: false, reason: "unit_not_found" });

    const gone = await unit(db, shop.id, "BCD #2");
    expect(
      (await deleteGearItem(db, { shopId: shop.id, gearItemId: gone.id, todayLocal: TODAY })).ok,
    ).toBe(true);
    expect(
      await createCounterRental(db, { ...base, personId: ana.id, gearItemIds: [gone.id] }),
    ).toEqual({ ok: false, reason: "unit_not_found" });

    const benched = await unit(db, shop.id, "BCD #3");
    await setGearItemStatus(db, {
      shopId: shop.id,
      gearItemId: benched.id,
      status: "needs_service",
    });
    expect(
      await createCounterRental(db, { ...base, personId: ana.id, gearItemIds: [benched.id] }),
    ).toEqual({ ok: false, reason: "unit_out_of_service" });

    const removed = await person(db, shop.id, "Removed Diver");
    await deleteDiver(db, shop.id, removed.id);
    expect(
      await createCounterRental(db, { ...base, personId: removed.id, gearItemIds: [bcd.id] }),
    ).toEqual({ ok: false, reason: "person_not_found" });

    expect(await db.select().from(gearReservations)).toEqual([]);
  });

  it("checks out, returns with an outcome, and releases through the register's own writers", async () => {
    const { db, shop } = await rentalShop();
    const ana = await person(db, shop.id, "Ana Walk-In");
    const bcd = await unit(db, shop.id, "BCD #1");
    const reg = await unit(db, shop.id, "Reg #1", "regulator");
    const rental = rented(
      await createCounterRental(db, {
        shopId: shop.id,
        personId: ana.id,
        gearItemIds: [bcd.id, reg.id],
        reservedFrom: TODAY,
        reservedUntil: TODAY,
        todayLocal: TODAY,
      }),
    );
    const [first, second] = rental.reservationIds;
    if (!first || !second) throw new Error("two reservations expected");

    expect(await checkOutGearReservation(db, { shopId: shop.id, reservationId: first })).toEqual({
      ok: true,
    });
    expect(
      await returnGearReservation(db, {
        shopId: shop.id,
        reservationId: first,
        outcome: "service_concern",
        note: "Inflator sticks",
      }),
    ).toEqual({ ok: true });
    // The flag reaches the picker like a trip return's would.
    const [flagged] = await db
      .select({ gearItemId: gearReservations.gearItemId })
      .from(gearReservations)
      .where(eq(gearReservations.id, first));
    expect([...(await openServiceConcerns(db, shop.id, [bcd, reg]))]).toEqual([
      flagged?.gearItemId,
    ]);
    // Never collected: the release frees it.
    expect(await releaseGearReservation(db, { shopId: shop.id, reservationId: second })).toEqual({
      ok: true,
    });
    const open = await db
      .select()
      .from(gearReservations)
      .where(and(eq(gearReservations.shopId, shop.id), isNull(gearReservations.returnedAt)));
    expect(open).toEqual([]);
  });
});

describe("counter rental tickets", () => {
  it("finds the whole rental from any of its reservations, and keeps two rentals apart", async () => {
    const { db, shop } = await rentalShop();
    const ana = await person(db, shop.id, "Ana Walk-In");
    const bcd = await unit(db, shop.id, "BCD #1");
    const reg = await unit(db, shop.id, "Reg #1", "regulator");
    const fins = await unit(db, shop.id, "Fins #1", "fins");
    const first = rented(
      await createCounterRental(db, {
        shopId: shop.id,
        personId: ana.id,
        gearItemIds: [bcd.id, reg.id],
        reservedFrom: TODAY,
        reservedUntil: "2026-10-09",
        todayLocal: TODAY,
      }),
    );
    const second = rented(
      await createCounterRental(db, {
        shopId: shop.id,
        personId: ana.id,
        gearItemIds: [fins.id],
        reservedFrom: "2026-10-12",
        reservedUntil: "2026-10-12",
        todayLocal: TODAY,
      }),
    );

    for (const id of first.reservationIds) {
      const ticket = await getCounterRentalTicket(db, shop.id, id);
      expect(ticket?.personName).toBe("Ana Walk-In");
      expect(ticket?.units.map((row) => row.label).sort()).toEqual(["BCD #1", "Reg #1"]);
      expect(ticket?.reservedUntil).toBe("2026-10-09");
    }
    const finsTicket = await getCounterRentalTicket(db, shop.id, second.ticketId);
    expect(finsTicket?.units.map((row) => row.label)).toEqual(["Fins #1"]);

    const open = await listOpenCounterRentalsForPerson(db, shop.id, ana.id);
    expect(open.map((rental) => rental.units.map((row) => row.label).sort())).toEqual([
      ["BCD #1", "Reg #1"],
      ["Fins #1"],
    ]);
  });

  it("reads nothing for another shop, or for a booking-held reservation", async () => {
    const { db, shop } = await rentalShop();
    const rival = await insertShop(db, "rival-ticket");
    const ana = await person(db, shop.id, "Ana Walk-In");
    const bcd = await unit(db, shop.id, "BCD #1");
    const rental = rented(
      await createCounterRental(db, {
        shopId: shop.id,
        personId: ana.id,
        gearItemIds: [bcd.id],
        reservedFrom: TODAY,
        reservedUntil: TODAY,
        todayLocal: TODAY,
      }),
    );
    expect(await getCounterRentalTicket(db, rival.id, rental.ticketId)).toBeNull();
    expect(await listOpenCounterRentalsForPerson(db, rival.id, ana.id)).toEqual([]);
  });

  it("drops a rental from the person's open list once every unit is home, and keeps its ticket", async () => {
    const { db, shop } = await rentalShop();
    const ana = await person(db, shop.id, "Ana Walk-In");
    const bcd = await unit(db, shop.id, "BCD #1");
    const rental = rented(
      await createCounterRental(db, {
        shopId: shop.id,
        personId: ana.id,
        gearItemIds: [bcd.id],
        reservedFrom: TODAY,
        reservedUntil: TODAY,
        todayLocal: TODAY,
      }),
    );
    await checkOutGearReservation(db, { shopId: shop.id, reservationId: rental.ticketId });
    await returnGearReservation(db, {
      shopId: shop.id,
      reservationId: rental.ticketId,
      outcome: "all_good",
    });
    expect(await listOpenCounterRentalsForPerson(db, shop.id, ana.id)).toEqual([]);
    const ticket = await getCounterRentalTicket(db, shop.id, rental.ticketId);
    expect(ticket?.units[0]?.returnOutcome).toBe("all_good");
  });

  it("links the order both ways, only for the order's own person and only once", async () => {
    const { db, shop } = await rentalShop();
    const ana = await person(db, shop.id, "Ana Walk-In", "ana@example.com");
    const ben = await person(db, shop.id, "Ben Walk-In", "ben@example.com");
    const bcd = await unit(db, shop.id, "BCD #1");
    const rental = rented(
      await createCounterRental(db, {
        shopId: shop.id,
        personId: ana.id,
        gearItemIds: [bcd.id],
        reservedFrom: TODAY,
        reservedUntil: TODAY,
        todayLocal: TODAY,
      }),
    );
    const order = async (personId: string, suffix: string) => {
      const [row] = await db
        .insert(orders)
        .values({
          shopId: shop.id,
          personId,
          createdByPersonId: personId,
          currency: "usd",
          totalCents: 1500,
          stripeAccountId: "acct_test",
          stripeCustomerId: `cus_${suffix}`,
          stripeInvoiceId: `in_${suffix}`,
        })
        .returning();
      if (!row) throw new Error("order insert failed");
      return row;
    };
    const bensOrder = await order(ben.id, "ben");
    expect(
      await linkCounterRentalOrder(db, {
        shopId: shop.id,
        reservationIds: rental.reservationIds,
        orderId: bensOrder.id,
      }),
    ).toBe(0);

    const anasOrder = await order(ana.id, "ana");
    expect(
      await linkCounterRentalOrder(db, {
        shopId: shop.id,
        reservationIds: rental.reservationIds,
        orderId: anasOrder.id,
      }),
    ).toBe(1);
    expect((await getCounterRentalTicket(db, shop.id, rental.ticketId))?.orderId).toBe(
      anasOrder.id,
    );
    expect(await counterRentalTicketIdForOrder(db, shop.id, anasOrder.id)).toBe(rental.ticketId);

    // A second invoice cannot take the rental over.
    const second = await order(ana.id, "ana-2");
    expect(
      await linkCounterRentalOrder(db, {
        shopId: shop.id,
        reservationIds: rental.reservationIds,
        orderId: second.id,
      }),
    ).toBe(0);
  });
});

describe("register reads see counter rentals", () => {
  async function rentalOut(window: { from: string; until: string }, checkedOut: boolean) {
    const { db, shop } = await rentalShop();
    const ana = await person(db, shop.id, "Ana Walk-In");
    const bcd = await unit(db, shop.id, "BCD #1");
    // Written straight to the table for a window that has already begun or
    // lapsed, which the writer (rightly) will not create.
    const [row] = await db
      .insert(gearReservations)
      .values({
        shopId: shop.id,
        gearItemId: bcd.id,
        personId: ana.id,
        reservedFrom: window.from,
        reservedUntil: window.until,
        checkedOutAt: checkedOut ? new Date("2026-10-06T14:00:00Z") : null,
      })
      .returning();
    if (!row) throw new Error("reservation insert failed");
    return { db, shop, ana, bcd, reservation: row };
  }

  it("files an out counter rental in the register's Out group, with the holder's name", async () => {
    const { db, shop, bcd } = await rentalOut({ from: TODAY, until: "2026-10-10" }, true);
    const groups = await gearRegisterGroups(db, shop.id, { todayLocal: TODAY });
    expect(groups.out.map((row) => row.item.id)).toEqual([bcd.id]);
    expect(groups.out[0]?.reservation).toMatchObject({
      personName: "Ana Walk-In",
      bookingId: null,
      tripTitle: null,
      tripEndsAt: null,
    });
  });

  it("files a lapsed one in Overdue, and Today's overdue reader names the person", async () => {
    const { db, shop, ana, bcd } = await rentalOut(
      { from: "2026-10-05", until: "2026-10-07" },
      true,
    );
    const groups = await gearRegisterGroups(db, shop.id, { todayLocal: TODAY });
    expect(groups.overdue.map((row) => row.item.id)).toEqual([bcd.id]);
    const overdue = await listOverdueGearReservations(db, shop.id, TODAY);
    expect(overdue).toMatchObject([
      { label: "BCD #1", personId: ana.id, personName: "Ana Walk-In", tripTitle: null },
    ]);
  });

  it("is due back on its last day", async () => {
    const { db, shop, ana } = await rentalOut({ from: "2026-10-06", until: TODAY }, true);
    expect(await listGearDueBack(db, shop.id, TODAY)).toMatchObject([
      { label: "BCD #1", personId: ana.id, personName: "Ana Walk-In" },
    ]);
  });

  it("shows on the unit's own record, open and settled", async () => {
    const { db, shop, bcd, reservation } = await rentalOut({ from: TODAY, until: TODAY }, true);
    let detail = await getGearItemDetail(db, shop.id, bcd.id);
    expect(detail?.reservations).toMatchObject([
      { reservationId: reservation.id, personName: "Ana Walk-In", returnedAt: null },
    ]);
    await returnGearReservation(db, {
      shopId: shop.id,
      reservationId: reservation.id,
      outcome: "all_good",
    });
    detail = await getGearItemDetail(db, shop.id, bcd.id);
    expect(detail?.reservations[0]).toMatchObject({
      personName: "Ana Walk-In",
      returnOutcome: "all_good",
    });
  });

  it("keeps the unit off the picker for the window it is lent on", async () => {
    const { db, shop, bcd } = await rentalOut({ from: TODAY, until: "2026-10-10" }, false);
    const during = await listAvailableGearUnits(db, shop.id, {
      from: "2026-10-09",
      until: "2026-10-09",
      todayLocal: TODAY,
    });
    expect(during.map((row) => row.id)).not.toContain(bcd.id);
    const after = await listAvailableGearUnits(db, shop.id, {
      from: "2026-10-11",
      until: "2026-10-11",
      todayLocal: TODAY,
    });
    expect(after.map((row) => row.id)).toContain(bcd.id);
  });
});

describe("the whole rental in one act", () => {
  async function twoUnitRental() {
    const { db, shop } = await rentalShop();
    const ana = await person(db, shop.id, "Ana Walk-In");
    const ben = await person(db, shop.id, "Ben Walk-In");
    const bcd = await unit(db, shop.id, "BCD #1");
    const reg = await unit(db, shop.id, "Reg #1", "regulator");
    const fins = await unit(db, shop.id, "Fins #1", "fins");
    const rental = rented(
      await createCounterRental(db, {
        shopId: shop.id,
        personId: ana.id,
        gearItemIds: [bcd.id, reg.id],
        reservedFrom: TODAY,
        reservedUntil: TODAY,
        todayLocal: TODAY,
      }),
    );
    // Somebody else's rental, which no act on Ana's may touch.
    const other = rented(
      await createCounterRental(db, {
        shopId: shop.id,
        personId: ben.id,
        gearItemIds: [fins.id],
        reservedFrom: TODAY,
        reservedUntil: TODAY,
        todayLocal: TODAY,
      }),
    );
    return { db, shop, rental, other };
  }

  it("checks out every unit, then returns them with one outcome, touching no other rental", async () => {
    const { db, shop, rental, other } = await twoUnitRental();
    const ticket = { shopId: shop.id, ticketId: rental.ticketId };
    expect(await checkOutCounterRental(db, ticket)).toEqual({ ok: true });
    // A second tap has nothing left to hand over.
    expect(await checkOutCounterRental(db, ticket)).toEqual({ ok: false, reason: "not_found" });
    expect(await returnCounterRental(db, { ...ticket, outcome: "service_concern" })).toEqual({
      ok: false,
      reason: "concern_needs_words",
    });
    expect(await returnCounterRental(db, { ...ticket, outcome: "all_good" })).toEqual({
      ok: true,
    });

    const after = await getCounterRentalTicket(db, shop.id, rental.ticketId);
    expect(after?.units.every((row) => row.returnOutcome === "all_good")).toBe(true);
    const bens = await getCounterRentalTicket(db, shop.id, other.ticketId);
    expect(bens?.units[0]).toMatchObject({ checkedOutAt: null, returnedAt: null });
  });

  it("releases only what never left, and refuses another shop's ticket", async () => {
    const { db, shop, rental, other } = await twoUnitRental();
    const rival = await insertShop(db, "rival-release");
    const foreign = { shopId: rival.id, ticketId: rental.ticketId };
    expect(await releaseCounterRental(db, foreign)).toEqual({ ok: false, reason: "not_found" });
    expect(await checkOutCounterRental(db, foreign)).toEqual({ ok: false, reason: "not_found" });
    expect(await releaseCounterRental(db, { shopId: shop.id, ticketId: rental.ticketId })).toEqual({
      ok: true,
    });
    expect(await getCounterRentalTicket(db, shop.id, rental.ticketId)).toBeNull();
    expect(await getCounterRentalTicket(db, shop.id, other.ticketId)).not.toBeNull();
  });

  it("keeps a unit already out when the rest is released", async () => {
    const { db, shop, rental } = await twoUnitRental();
    const [first] = rental.reservationIds;
    if (!first) throw new Error("reservation expected");
    await checkOutGearReservation(db, { shopId: shop.id, reservationId: first });
    expect(await releaseCounterRental(db, { shopId: shop.id, ticketId: first })).toEqual({
      ok: true,
    });
    const after = await getCounterRentalTicket(db, shop.id, first);
    expect(after?.units.map((row) => row.reservationId)).toEqual([first]);
  });
});
