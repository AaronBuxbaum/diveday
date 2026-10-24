import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate, nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { listAvailableGearUnits, listTripGearAssignments } from "./gear-availability";
import { createGearItem, deleteGearItem, setGearItemStatus } from "./gear-items";
import { listGearItems } from "./gear-register";
import {
  checkOutGearReservation,
  reserveGearUnit,
  returnGearReservation,
} from "./gear-reservations";
import { recordGearService } from "./gear-service";
import {
  gearShopContext,
  mustCreate,
  rivalShop,
  SETUP_PICK,
  shopBooking,
  TODAY,
} from "./gear-test-fixtures";
import { gearReservations, gearServiceEvents } from "./schema";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

describe("gear register readers: the picker and a departure's assignments", () => {
  it("only the counter opt-in includes unavailable units, with current reasons and tenant isolation", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const free = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "Free" }),
    );
    const busy = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "Busy" }),
    );
    const pulled = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "Pulled" }),
    );
    const removed = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "Deleted" }),
    );
    await deleteGearItem(db, { shopId: shop.id, gearItemId: removed.id, todayLocal: TODAY });
    await setGearItemStatus(db, {
      shopId: shop.id,
      gearItemId: pulled.id,
      status: "needs_service",
    });
    const booking = await shopBooking(db, shop.id, "Busy Bea");
    await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: busy.id,
      bookingId: booking.bookingId,
      reservedFrom: "2026-09-01",
      reservedUntil: "2026-09-02",
      screen: SETUP_PICK,
    });
    const other = await rivalShop(db);
    mustCreate(await createGearItem(db, { shopId: other.id, kind: "bcd", label: "Other tenant" }));
    const window = {
      from: "2026-09-01",
      until: "2026-09-01",
      todayLocal: TODAY,
      kind: "bcd" as const,
    };
    expect((await listAvailableGearUnits(db, shop.id, window)).map((unit) => unit.id)).toEqual([
      free.id,
    ]);
    const counter = await listAvailableGearUnits(db, shop.id, {
      ...window,
      includeUnavailable: true,
    });
    expect(counter.map((unit) => [unit.id, unit.unavailable])).toEqual([
      [busy.id, "unit_unavailable"],
      [free.id, null],
      [pulled.id, "unit_out_of_service"],
    ]);
  });

  it("says whether a tank's O2-clean record stands on the service day, and nothing for other kinds (issue #2719)", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const cleaned = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "tank", label: "Tank cleaned" }),
    );
    const lapsed = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "tank", label: "Tank lapsed" }),
    );
    const never = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "tank", label: "Tank never" }),
    );
    const vest = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "Vest" }),
    );
    for (const [unit, servicedOn, nextDueOn] of [
      [cleaned, "2026-03-01", "2027-03-01"],
      [lapsed, "2025-08-01", "2026-09-02"],
    ] as const) {
      expect(
        await recordGearService(db, {
          shopId: shop.id,
          gearItemId: unit.id,
          kind: "o2_clean",
          servicedOn,
          nextDueOn,
        }),
      ).toMatchObject({ ok: true });
    }
    // Read on the window's last day, as the counter reads every clock: the
    // lapsed tank is current on the 1st and not on the 3rd.
    const read = async (until: string) =>
      new Map(
        (
          await listAvailableGearUnits(db, shop.id, {
            from: "2026-09-01",
            until,
            todayLocal: TODAY,
            serviceAsOf: until,
          })
        ).map((unit) => [unit.id, unit.o2Clean]),
      );
    const first = await read("2026-09-01");
    expect([cleaned, lapsed, never, vest].map((unit) => first.get(unit.id))).toEqual([
      "current",
      "current",
      "never",
      null,
    ]);
    const third = await read("2026-09-03");
    expect(third.get(lapsed.id)).toBe("lapsed");
  });

  it("the picker offers only free, working units for the window", async () => {
    const { db, shop } = await gearShopContext(ctx);
    mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #20", size: "M" }),
    );
    const busy = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #21", size: "M" }),
    );
    const pulled = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #22" }),
    );
    await setGearItemStatus(db, {
      shopId: shop.id,
      gearItemId: pulled.id,
      status: "needs_service",
    });
    const maya = await shopBooking(db, shop.id, "Maya Reyes");
    await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: busy.id,
      bookingId: maya.bookingId,
      reservedFrom: "2026-09-01",
      reservedUntil: "2026-09-02",
      screen: SETUP_PICK,
    });

    const available = await listAvailableGearUnits(db, shop.id, {
      kind: "bcd",
      from: "2026-09-02",
      until: "2026-09-02",
      todayLocal: TODAY,
    });
    expect(available.map((unit) => unit.label)).toEqual(["BCD #20"]);

    const clearWindow = await listAvailableGearUnits(db, shop.id, {
      kind: "bcd",
      from: "2026-09-03",
      until: "2026-09-04",
      todayLocal: TODAY,
    });
    expect(clearWindow.map((unit) => unit.label)).toEqual(["BCD #20", "BCD #21"]);
  });

  it("never offers a unit that is physically out on a lapsed window, but a never-collected one stays on the wall", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const stillOut = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #25" }),
    );
    const neverCollected = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #26" }),
    );
    const maya = await shopBooking(db, shop.id, "Maya Reyes");
    const jonah = await shopBooking(db, shop.id, "Jonah Park");

    const out = await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: stillOut.id,
      bookingId: maya.bookingId,
      reservedFrom: "2026-08-10",
      reservedUntil: "2026-08-15",
      screen: SETUP_PICK,
    });
    if (!out.ok) throw new Error("reserve failed");
    await checkOutGearReservation(db, { shopId: shop.id, reservationId: out.reservation.id });
    await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: neverCollected.id,
      bookingId: jonah.bookingId,
      reservedFrom: "2026-08-10",
      reservedUntil: "2026-08-15",
      screen: SETUP_PICK,
    });

    // Next month's window overlaps neither lapsed reservation — but the
    // checked-out unit is not on the wall, and offering it packs a boat
    // around an empty peg. The never-collected one is right there.
    const nextMonth = await listAvailableGearUnits(db, shop.id, {
      kind: "bcd",
      from: "2026-09-10",
      until: "2026-09-11",
      todayLocal: TODAY,
    });
    expect(nextMonth.map((unit) => unit.label)).toEqual(["BCD #26"]);
  });

  it("carries each offered unit's most urgent service clock into the picker", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const lapsed = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "Reg #40" }),
    );
    mustCreate(await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "Reg #41" }));
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: lapsed.id,
      kind: "service",
      servicedOn: "2025-06-01",
      nextDueOn: "2026-06-01",
    });

    const offered = await listAvailableGearUnits(db, shop.id, {
      kind: "regulator",
      from: "2026-09-01",
      until: "2026-09-01",
      todayLocal: TODAY,
    });
    expect(offered.find((unit) => unit.label === "Reg #40")?.serviceState).toMatchObject({
      state: "overdue",
      kind: "service",
    });
    expect(offered.find((unit) => unit.label === "Reg #41")?.serviceState).toEqual({
      state: "no_clock",
    });
  });

  it("groups a departure's open assignments by booking and names who has what", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const bcd = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #30", size: "S" }),
    );
    const reg = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "Reg #30" }),
    );
    const maya = await shopBooking(db, shop.id, "Maya Reyes");
    for (const gearItemId of [bcd.id, reg.id]) {
      const outcome = await reserveGearUnit(db, {
        shopId: shop.id,
        gearItemId,
        bookingId: maya.bookingId,
        reservedFrom: "2026-09-01",
        reservedUntil: "2026-09-01",
        screen: SETUP_PICK,
      });
      if (!outcome.ok) throw new Error("reserve failed");
    }

    const assignments = await listTripGearAssignments(db, shop.id, maya.trip.id);
    expect(assignments.get(maya.bookingId)?.map((row) => row.label)).toEqual([
      "BCD #30",
      "Reg #30",
    ]);

    const page = await listGearItems(db, shop.id, { todayLocal: TODAY });
    const bcdRow = page.rows.find((row) => row.item.id === bcd.id);
    expect(bcdRow?.reservation).toMatchObject({
      personName: "Maya Reyes",
      reservedUntil: "2026-09-01",
    });
  });
});

/**
 * **A service concern stands until somebody services the unit** (dive-domain
 * review of the Gear tab's proposals). The return is a flag, not a service
 * record, so the picker reads it off the last return and the history after it.
 */
describe("a unit that came home with a service concern", () => {
  const window = { from: "2026-09-10", until: "2026-09-10", todayLocal: TODAY };

  async function returnedWith(
    outcome: "service_concern" | "all_good",
    kind: "regulator" | "wetsuit" | "tank" = "regulator",
  ) {
    const { db, shop } = await gearShopContext(ctx);
    const unit = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind, label: `${kind} #70` }),
    );
    const maya = await shopBooking(db, shop.id, "Maya Reyes");
    const reserved = await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: unit.id,
      bookingId: maya.bookingId,
      reservedFrom: "2026-09-01",
      reservedUntil: "2026-09-02",
      screen: SETUP_PICK,
    });
    if (!reserved.ok) throw new Error("reserve failed");
    await checkOutGearReservation(db, { shopId: shop.id, reservationId: reserved.reservation.id });
    const back = await returnGearReservation(db, {
      shopId: shop.id,
      reservationId: reserved.reservation.id,
      outcome,
      note: outcome === "service_concern" ? "Second stage free-flows" : undefined,
    });
    if (!back.ok) throw new Error("return failed");
    const flagged = async () =>
      (await listAvailableGearUnits(db, shop.id, window)).find((row) => row.id === unit.id)
        ?.serviceConcern;
    return { db, shop, unit, maya, flagged };
  }

  it("is flagged in the picker, and still offered there", async () => {
    const { flagged } = await returnedWith("service_concern");
    expect(await flagged()).toBe(true);
  });

  it("is not flagged after an ordinary return", async () => {
    const { flagged } = await returnedWith("all_good");
    expect(await flagged()).toBe(false);
  });

  it("stays flagged through a service dated before it came home, and clears on one after", async () => {
    const { db, shop, unit, flagged } = await returnedWith("service_concern");
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: unit.id,
      kind: "service",
      servicedOn: "2026-07-01",
    });
    expect(await flagged()).toBe(true);
    // A note is not a service for a regulator, whose form offers one.
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: unit.id,
      kind: "note",
      servicedOn: "2026-07-22",
      note: "Looked at it",
    });
    expect(await flagged()).toBe(true);
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: unit.id,
      kind: "service",
      servicedOn: "2026-07-22",
    });
    expect(await flagged()).toBe(false);
  });

  it("clears on a dated note for a kind that never gets a service", async () => {
    const { db, shop, unit, flagged } = await returnedWith("service_concern", "wetsuit");
    expect(await flagged()).toBe(true);
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: unit.id,
      kind: "note",
      servicedOn: "2026-07-22",
      note: "Zip replaced",
    });
    expect(await flagged()).toBe(false);
  });
  it("stays flagged through a later return that nobody said anything about", async () => {
    // The register's quick Return and the unit page's Return close a
    // reservation with no outcome. That says nothing about the unit, so it
    // must not stand in for the flagged return before it.
    const { db, shop, unit, maya, flagged } = await returnedWith("service_concern");
    const again = await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: unit.id,
      bookingId: maya.bookingId,
      reservedFrom: "2026-09-05",
      reservedUntil: "2026-09-06",
      screen: SETUP_PICK,
    });
    if (!again.ok) throw new Error("reserve failed");
    await checkOutGearReservation(db, { shopId: shop.id, reservationId: again.reservation.id });
    expect(
      await returnGearReservation(db, { shopId: shop.id, reservationId: again.reservation.id }),
    ).toEqual({ ok: true });
    // The frozen clock writes both returns at one instant; this one came later.
    await db
      .update(gearReservations)
      .set({ returnedAt: new Date(nowMs() + 60 * 60 * 1000) })
      .where(eq(gearReservations.id, again.reservation.id));
    expect(await flagged()).toBe(true);
  });

  it("stays flagged through a same-day service written before it came home", async () => {
    const { db, shop, unit, flagged } = await returnedWith("service_concern");
    const returnedOn = calendarDateInTimezone(nowDate(), shop.timezone);
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: unit.id,
      kind: "service",
      servicedOn: returnedOn,
    });
    // The morning's service, written two hours before the evening's return.
    await db
      .update(gearServiceEvents)
      .set({ createdAt: new Date(nowMs() - 2 * 60 * 60 * 1000) })
      .where(eq(gearServiceEvents.gearItemId, unit.id));
    expect(await flagged()).toBe(true);
    // The same day, written after it came home.
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: unit.id,
      kind: "service",
      servicedOn: returnedOn,
    });
    expect(await flagged()).toBe(false);
  });

  it("never clears a tank on a note, and clears it on one of its own checks", async () => {
    const { db, shop, unit, flagged } = await returnedWith("service_concern", "tank");
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: unit.id,
      kind: "note",
      servicedOn: "2026-07-22",
      note: "Looks fine",
    });
    expect(await flagged()).toBe(true);
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: unit.id,
      kind: "visual_inspection",
      servicedOn: "2026-07-22",
    });
    expect(await flagged()).toBe(false);
  });
});
