import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { cancelBooking } from "./bookings";
import type { AppDb } from "./client";
import { listAvailableGearUnits } from "./gear-availability";
import { createGearItem, setGearItemStatus } from "./gear-items";
import {
  checkOutGearReservation,
  checkOutTripGearSet,
  reserveGearUnit,
  returnGearReservation,
  returnTripGearSet,
} from "./gear-reservations";
import {
  aSetOut,
  gearShopContext,
  mustCreate,
  SETUP_PICK,
  shopBooking,
} from "./gear-test-fixtures";
import { gearItems, gearReservations, gearServiceEvents } from "./schema";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/**
 * **A rental set goes out in one act** (issue #1185, delight report D25) — the
 * load-out half of the loop whose return half is the describe below.
 */
describe("handing a whole rental set over", () => {
  async function aSetReserved(db: AppDb, shopId: string, name = "Nadia Osei") {
    const bcd = mustCreate(
      await createGearItem(db, { shopId, kind: "bcd", label: `BCD for ${name}`, size: "M" }),
    );
    const reg = mustCreate(
      await createGearItem(db, { shopId, kind: "regulator", label: `Reg for ${name}` }),
    );
    const diver = await shopBooking(db, shopId, name);
    const reservationIds: string[] = [];
    for (const unit of [bcd, reg]) {
      const reserved = await reserveGearUnit(db, {
        shopId,
        gearItemId: unit.id,
        bookingId: diver.bookingId,
        reservedFrom: "2026-09-10",
        reservedUntil: "2026-09-11",
        screen: SETUP_PICK,
      });
      if (!reserved.ok) throw new Error("reserve failed");
      reservationIds.push(reserved.reservation.id);
    }
    return { bookingId: diver.bookingId, reservationIds };
  }

  async function stampsOf(db: AppDb, ids: string[]) {
    return db
      .select({
        id: gearReservations.id,
        checkedOutAt: gearReservations.checkedOutAt,
        returnedAt: gearReservations.returnedAt,
      })
      .from(gearReservations)
      .where(inArray(gearReservations.id, ids));
  }

  it("stamps every unit still on the wall in one act", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const { bookingId, reservationIds } = await aSetReserved(db, shop.id);

    expect(await checkOutTripGearSet(db, { shopId: shop.id, bookingId })).toEqual({ ok: true });

    const rows = await stampsOf(db, reservationIds);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.checkedOutAt).toBeInstanceOf(Date);
  });

  it("leaves an already-out unit's stamp exactly where it was", async () => {
    // The double-tap rule `checkOutGearReservation` states: `checked_out_at` is
    // the record of *when* the unit left, and nothing may quietly rewrite it.
    const { db, shop } = await gearShopContext(ctx);
    const { bookingId, reservationIds } = await aSetReserved(db, shop.id);
    const [first] = reservationIds;
    if (!first) throw new Error("expected a reservation");
    await checkOutGearReservation(db, { shopId: shop.id, reservationId: first });
    const [before] = await stampsOf(db, [first]);

    expect(await checkOutTripGearSet(db, { shopId: shop.id, bookingId })).toEqual({ ok: true });

    const [after] = await stampsOf(db, [first]);
    expect(after?.checkedOutAt).toEqual(before?.checkedOutAt);
  });

  it("leaves a returned unit alone and says the set is already out", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const { bookingId, reservationIds } = await aSetReserved(db, shop.id);
    await checkOutTripGearSet(db, { shopId: shop.id, bookingId });
    expect(
      await returnTripGearSet(db, { shopId: shop.id, bookingId, outcome: "all_good" }),
    ).toEqual({ ok: true, pulled: 0 });

    // A closed reservation is not something to hand over again.
    expect(await checkOutTripGearSet(db, { shopId: shop.id, bookingId })).toEqual({
      ok: false,
      reason: "not_found",
    });
    for (const row of await stampsOf(db, reservationIds)) {
      expect(row.returnedAt).toBeInstanceOf(Date);
    }
  });

  it("says nothing rather than reporting a success on a second tap", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const { bookingId } = await aSetReserved(db, shop.id);
    expect(await checkOutTripGearSet(db, { shopId: shop.id, bookingId })).toEqual({ ok: true });
    expect(await checkOutTripGearSet(db, { shopId: shop.id, bookingId })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("never touches another booking's units", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const mine = await aSetReserved(db, shop.id, "Nadia Osei");
    const theirs = await aSetReserved(db, shop.id, "Tomas Rivera");

    expect(await checkOutTripGearSet(db, { shopId: shop.id, bookingId: mine.bookingId })).toEqual({
      ok: true,
    });

    for (const row of await stampsOf(db, theirs.reservationIds)) {
      expect(row.checkedOutAt).toBeNull();
    }
  });
});

/**
 * **A rental set comes home in one act, and says how it went** (issue #1186,
 * delight report D26).
 *
 * The set rather than the piece, because that is what a counter is handed at
 * 4pm. The outcome is asked once and written to every unit that was actually
 * out — which is also what stops the fast path from becoming the paperwork it
 * replaces.
 */
describe("returning a whole rental set", () => {
  async function outcomesOf(db: AppDb, ids: string[]) {
    const rows = await db
      .select({
        id: gearReservations.id,
        returnedAt: gearReservations.returnedAt,
        outcome: gearReservations.returnOutcome,
        note: gearReservations.returnNote,
      })
      .from(gearReservations)
      .where(inArray(gearReservations.id, ids));
    return rows;
  }

  it("closes every unit in the set with the one answer the counter gave", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const { bookingId, reservationIds } = await aSetOut(db, shop.id);

    expect(
      await returnTripGearSet(db, { shopId: shop.id, bookingId, outcome: "all_good" }),
    ).toEqual({ ok: true, pulled: 0 });

    const rows = await outcomesOf(db, reservationIds);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.returnedAt).toBeInstanceOf(Date);
      expect(row.outcome).toBe("all_good");
    }
  });

  it("refuses a service concern with no words, and writes nothing", async () => {
    // A flag a technician cannot act on is worse than no flag, and the set must
    // not be half-closed on the way to finding that out.
    const { db, shop } = await gearShopContext(ctx);
    const { bookingId, reservationIds } = await aSetOut(db, shop.id);

    expect(
      await returnTripGearSet(db, { shopId: shop.id, bookingId, outcome: "service_concern" }),
    ).toEqual({ ok: false, reason: "concern_needs_words" });
    for (const row of await outcomesOf(db, reservationIds)) {
      expect(row.returnedAt).toBeNull();
      expect(row.outcome).toBeNull();
    }

    expect(
      await returnTripGearSet(db, {
        shopId: shop.id,
        bookingId,
        outcome: "service_concern",
        note: "second stage free-flowed on the descent",
      }),
    ).toEqual({ ok: true, pulled: 0 });
    for (const row of await outcomesOf(db, reservationIds)) {
      expect(row.outcome).toBe("service_concern");
      expect(row.note).toBe("second stage free-flowed on the descent");
    }
  });

  it("says nothing is out rather than reporting a success", async () => {
    // A staffer who taps Return on a set somebody else already brought back
    // should be told, not reassured — the same reason the single-unit path
    // distinguishes `already_returned` from a silent no-op.
    const { db, shop } = await gearShopContext(ctx);
    const { bookingId } = await aSetOut(db, shop.id);
    expect(
      await returnTripGearSet(db, { shopId: shop.id, bookingId, outcome: "all_good" }),
    ).toEqual({ ok: true, pulled: 0 });
    expect(
      await returnTripGearSet(db, { shopId: shop.id, bookingId, outcome: "all_good" }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("leaves a unit that never left the counter alone", async () => {
    // Reserved is not out. Closing it would erase the assignment rather than
    // record a return, and the register's release is the honest path for that.
    const { db, shop } = await gearShopContext(ctx);
    const { bookingId, reservationIds } = await aSetOut(db, shop.id);
    const stillOnTheWall = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "fins", label: "Fins #21" }),
    );
    const reserved = await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: stillOnTheWall.id,
      bookingId,
      reservedFrom: "2026-09-10",
      reservedUntil: "2026-09-11",
      screen: SETUP_PICK,
    });
    if (!reserved.ok) throw new Error("reserve failed");

    expect(
      await returnTripGearSet(db, { shopId: shop.id, bookingId, outcome: "all_good" }),
    ).toEqual({ ok: true, pulled: 0 });

    const [untouched] = await outcomesOf(db, [reserved.reservation.id]);
    expect(untouched?.returnedAt).toBeNull();
    expect(untouched?.outcome).toBeNull();
    expect(await outcomesOf(db, reservationIds)).toHaveLength(2);
  });

  /**
   * **Pulling a unit to the bench from the return** (issue #2205). Opt-in per
   * unit, only on a service concern, in the same transaction as the return,
   * and still no `gear_service_events` row.
   */
  describe("pulling a unit to the bench on a service concern", () => {
    async function unitsOf(db: AppDb, reservationIds: string[]) {
      const rows = await db
        .select({ id: gearItems.id, label: gearItems.label })
        .from(gearReservations)
        .innerJoin(gearItems, eq(gearItems.id, gearReservations.gearItemId))
        .where(inArray(gearReservations.id, reservationIds));
      const byLabel = new Map(rows.map((row) => [row.label, row.id]));
      const reg = byLabel.get("Reg #21");
      const bcd = byLabel.get("BCD #21");
      if (!reg || !bcd) throw new Error("set units missing");
      return { reg, bcd };
    }

    async function statusOf(db: AppDb, gearItemId: string) {
      const [row] = await db
        .select({ status: gearItems.status, serviceNote: gearItems.serviceNote })
        .from(gearItems)
        .where(eq(gearItems.id, gearItemId));
      return row;
    }

    async function onTheWall(db: AppDb, shopId: string) {
      const units = await listAvailableGearUnits(db, shopId, {
        from: "2026-09-20",
        until: "2026-09-20",
        todayLocal: "2026-09-20",
      });
      return new Set(units.map((unit) => unit.id));
    }

    it("pulls only the ticked unit, with the concern as its service note", async () => {
      const { db, shop } = await gearShopContext(ctx);
      const { bookingId, reservationIds } = await aSetOut(db, shop.id);
      const { reg, bcd } = await unitsOf(db, reservationIds);

      expect(
        await returnTripGearSet(db, {
          shopId: shop.id,
          bookingId,
          outcome: "service_concern",
          note: "second stage free-flowed on the descent",
          pullGearItemIds: [reg],
        }),
      ).toEqual({ ok: true, pulled: 1 });

      expect(await statusOf(db, reg)).toEqual({
        status: "needs_service",
        serviceNote: "second stage free-flowed on the descent",
      });
      // The BCD came home in the same armful and nobody ticked it.
      expect(await statusOf(db, bcd)).toEqual({ status: "in_service", serviceNote: null });
      const wall = await onTheWall(db, shop.id);
      expect(wall.has(reg)).toBe(false);
      expect(wall.has(bcd)).toBe(true);
      // A concern is still a flag, never a service record.
      const events = await db
        .select({ id: gearServiceEvents.id })
        .from(gearServiceEvents)
        .where(inArray(gearServiceEvents.gearItemId, [reg, bcd]));
      expect(events).toHaveLength(0);
      for (const row of await outcomesOf(db, reservationIds)) {
        expect(row.outcome).toBe("service_concern");
      }
    });

    it("leaves every unit in service when nothing is ticked", async () => {
      const { db, shop } = await gearShopContext(ctx);
      const { bookingId, reservationIds } = await aSetOut(db, shop.id);
      const { reg, bcd } = await unitsOf(db, reservationIds);

      expect(
        await returnTripGearSet(db, {
          shopId: shop.id,
          bookingId,
          outcome: "service_concern",
          note: "mask strap scratched",
        }),
      ).toEqual({ ok: true, pulled: 0 });

      expect((await statusOf(db, reg))?.status).toBe("in_service");
      expect((await statusOf(db, bcd))?.status).toBe("in_service");
      const wall = await onTheWall(db, shop.id);
      expect(wall.has(reg)).toBe(true);
    });

    it("ignores a tick on any outcome but a service concern", async () => {
      const { db, shop } = await gearShopContext(ctx);
      const { bookingId, reservationIds } = await aSetOut(db, shop.id);
      const { reg } = await unitsOf(db, reservationIds);

      await returnTripGearSet(db, {
        shopId: shop.id,
        bookingId,
        outcome: "all_good",
        pullGearItemIds: [reg],
      });
      expect((await statusOf(db, reg))?.status).toBe("in_service");
    });

    it("pulls nothing when the concern is refused for want of words", async () => {
      const { db, shop } = await gearShopContext(ctx);
      const { bookingId, reservationIds } = await aSetOut(db, shop.id);
      const { reg } = await unitsOf(db, reservationIds);

      expect(
        await returnTripGearSet(db, {
          shopId: shop.id,
          bookingId,
          outcome: "service_concern",
          pullGearItemIds: [reg],
        }),
      ).toEqual({ ok: false, reason: "concern_needs_words" });
      expect((await statusOf(db, reg))?.status).toBe("in_service");
    });

    it("never reaches a unit this return did not close", async () => {
      // An id from another set, or another shop, rides in on a forged form:
      // only the units this act brought home can be pulled by it.
      const { db, shop } = await gearShopContext(ctx);
      const { bookingId } = await aSetOut(db, shop.id);
      const elsewhere = mustCreate(
        await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "Reg #99" }),
      );

      await returnTripGearSet(db, {
        shopId: shop.id,
        bookingId,
        outcome: "service_concern",
        note: "free-flow",
        pullGearItemIds: [elsewhere.id],
      });
      expect((await statusOf(db, elsewhere.id))?.status).toBe("in_service");
    });

    it("keeps a technician's note on a unit already off the wall", async () => {
      const { db, shop } = await gearShopContext(ctx);
      const { bookingId, reservationIds } = await aSetOut(db, shop.id);
      const { reg } = await unitsOf(db, reservationIds);
      await setGearItemStatus(db, {
        shopId: shop.id,
        gearItemId: reg,
        status: "needs_service",
        serviceNote: "inflator sticks",
      });

      // Nothing moved, so the desk is not told it did (issue #2345).
      expect(
        await returnTripGearSet(db, {
          shopId: shop.id,
          bookingId,
          outcome: "service_concern",
          note: "free-flow",
          pullGearItemIds: [reg],
        }),
      ).toEqual({ ok: true, pulled: 0 });
      expect(await statusOf(db, reg)).toEqual({
        status: "needs_service",
        serviceNote: "inflator sticks",
      });
    });
  });

  it("leaves the outcome null when a reservation is closed without asking", async () => {
    // The cancellation path and the register's quick return close a row with
    // nobody looking at the gear. Null there means "nobody said", and putting
    // the reassuring answer on those is what would make the other two not worth
    // reading.
    const { db, shop } = await gearShopContext(ctx);
    const { reservationIds } = await aSetOut(db, shop.id);
    const [first] = reservationIds;
    if (!first) throw new Error("expected a reservation");
    expect(await returnGearReservation(db, { shopId: shop.id, reservationId: first })).toEqual({
      ok: true,
    });
    const [row] = await outcomesOf(db, [first]);
    expect(row?.returnedAt).toBeInstanceOf(Date);
    expect(row?.outcome).toBeNull();
  });
});

describe("reserving against a cancelled booking", () => {
  it("is refused inside the write, as if there were no booking", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const bcd = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #71", size: "M" }),
    );
    const maya = await shopBooking(db, shop.id, "Maya Reyes");
    await cancelBooking(db, shop.id, maya.bookingId);
    expect(
      await reserveGearUnit(db, {
        shopId: shop.id,
        gearItemId: bcd.id,
        bookingId: maya.bookingId,
        tripId: maya.trip.id,
        reservedFrom: "2026-09-01",
        reservedUntil: "2026-09-02",
        screen: SETUP_PICK,
      }),
    ).toEqual({ ok: false, reason: "booking_not_found" });
    expect(
      await db.select().from(gearReservations).where(eq(gearReservations.gearItemId, bcd.id)),
    ).toEqual([]);
  });
});
