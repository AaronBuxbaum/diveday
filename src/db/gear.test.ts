import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { cancelBooking, createBooking } from "./bookings";
import type { AppDb } from "./client";
import {
  checkOutGearReservation,
  countGearItems,
  countGearItemsByKind,
  createGearItem,
  deleteGearItem,
  getGearItemDetail,
  latestServiceClocks,
  listAvailableGearUnits,
  listGearDueBack,
  listGearItems,
  listGearServiceDue,
  listOverdueGearReservations,
  listTripGearAssignments,
  recordGearService,
  releaseGearReservation,
  reserveGearUnit,
  returnGearReservation,
  setGearItemStatus,
  updateGearItem,
} from "./gear";
import { shops } from "./schema";
import { createTrip } from "./trips-create";

const TODAY = "2026-08-20";

async function shopBooking(db: AppDb, shopId: string, name: string) {
  const startsAt = new Date("2026-09-01T12:00:00Z");
  const trip = await createTrip(db, {
    shopId,
    title: `Gear test departure — ${name}`,
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
  return { trip, bookingId: booking.bookingId };
}

async function rivalShop(db: AppDb) {
  const [rival] = await db
    .insert(shops)
    .values({ name: "Rival Reef", slug: "rival-reef-gear", timezone: "America/New_York" })
    .returning();
  if (!rival) throw new Error("rival shop insert failed");
  return rival;
}

/**
 * A shop of this suite's own. The seeded blue-mantis demo now ships with a
 * whole fleet (src/db/seed-gear.ts), so asserting counts and list contents
 * against it would pin the demo's inventory; a fresh shop keeps every
 * assertion about exactly the rows each test wrote — and doubles as proof
 * the readers are shop-scoped.
 */
async function gearShopContext() {
  const { db } = await seededShopContext();
  const [shop] = await db
    .insert(shops)
    .values({ name: "Gear Test Divers", slug: "gear-test", timezone: "America/New_York" })
    .returning();
  if (!shop) throw new Error("gear test shop insert failed");
  return { db, shop };
}

function mustCreate(outcome: Awaited<ReturnType<typeof createGearItem>>) {
  if (!outcome.ok) throw new Error(`create refused: ${outcome.reason}`);
  return outcome.item;
}

describe("gear items", () => {
  it("adds, edits, lists, and counts units — the register is presence, not a setting", async () => {
    const { db, shop } = await gearShopContext();
    expect(await countGearItems(db, shop.id)).toBe(0);

    const bcd = mustCreate(
      await createGearItem(db, {
        shopId: shop.id,
        kind: "bcd",
        label: "BCD #1",
        size: "M",
        brandModel: "Cressi Start",
      }),
    );
    mustCreate(await createGearItem(db, { shopId: shop.id, kind: "tank", label: "AL80-01" }));

    expect(await countGearItems(db, shop.id)).toBe(2);
    const byKind = await countGearItemsByKind(db, shop.id);
    expect(byKind.get("bcd")).toBe(1);
    expect(byKind.get("tank")).toBe(1);

    const page = await listGearItems(db, shop.id, { todayLocal: TODAY });
    expect(page.total).toBe(2);
    // Kind order matches the prep list: bcd before tank.
    expect(page.rows.map((row) => row.item.label)).toEqual(["BCD #1", "AL80-01"]);
    expect(page.rows[0]?.serviceState).toEqual({ state: "no_clock" });
    expect(page.rows[0]?.reservation).toBeNull();

    const updated = await updateGearItem(db, {
      shopId: shop.id,
      gearItemId: bcd.id,
      kind: "bcd",
      label: "BCD #1",
      size: "L",
      serialNumber: "C-991",
    });
    expect(updated).toMatchObject({ ok: true, item: { size: "L", serialNumber: "C-991" } });
  });

  it("refuses a duplicate tag and an empty one — the tag is how a wet hand finds the row", async () => {
    const { db, shop } = await gearShopContext();
    mustCreate(await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "Reg #4" }));

    expect(
      await createGearItem(db, { shopId: shop.id, kind: "regulator", label: " Reg #4 " }),
    ).toEqual({ ok: false, reason: "duplicate_label" });
    expect(await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "   " })).toEqual({
      ok: false,
      reason: "empty_label",
    });

    // The same tag at another shop is fine — uniqueness is per shop.
    const rival = await rivalShop(db);
    expect(
      (await createGearItem(db, { shopId: rival.id, kind: "regulator", label: "Reg #4" })).ok,
    ).toBe(true);
  });

  it("moves a unit through needs-service and back, clearing the complaint on the way in", async () => {
    const { db, shop } = await gearShopContext();
    const item = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #2" }),
    );

    const pulled = await setGearItemStatus(db, {
      shopId: shop.id,
      gearItemId: item.id,
      status: "needs_service",
      serviceNote: "inflator sticks",
    });
    expect(pulled).toMatchObject({
      ok: true,
      item: { status: "needs_service", serviceNote: "inflator sticks" },
    });

    const back = await setGearItemStatus(db, {
      shopId: shop.id,
      gearItemId: item.id,
      status: "in_service",
      serviceNote: "stale words that must not survive",
    });
    expect(back).toMatchObject({ ok: true, item: { status: "in_service", serviceNote: null } });
  });

  it("deletes a unit and hands the row back for undo; other tenants cannot reach it", async () => {
    const { db, shop } = await gearShopContext();
    const rival = await rivalShop(db);
    const item = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "gopro", label: "GoPro A" }),
    );

    expect(await deleteGearItem(db, { shopId: rival.id, gearItemId: item.id })).toEqual({
      ok: false,
      reason: "not_found",
    });
    const deleted = await deleteGearItem(db, { shopId: shop.id, gearItemId: item.id });
    expect(deleted).toMatchObject({ ok: true, deleted: { label: "GoPro A" } });
    expect(await countGearItems(db, shop.id)).toBe(0);
  });
});

describe("gear service history", () => {
  it("appends events, and the newest event of a kind is that clock", async () => {
    const { db, shop } = await gearShopContext();
    const tank = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "tank", label: "AL80-07" }),
    );

    expect(
      await recordGearService(db, {
        shopId: shop.id,
        gearItemId: tank.id,
        kind: "visual_inspection",
        servicedOn: "2025-06-01",
        nextDueOn: "2026-06-01",
      }),
    ).toEqual({ ok: true });
    expect(
      await recordGearService(db, {
        shopId: shop.id,
        gearItemId: tank.id,
        kind: "visual_inspection",
        servicedOn: "2026-06-02",
        nextDueOn: "2027-06-02",
      }),
    ).toEqual({ ok: true });
    expect(
      await recordGearService(db, {
        shopId: shop.id,
        gearItemId: tank.id,
        kind: "hydro_test",
        servicedOn: "2024-03-10",
        nextDueOn: "2029-03-10",
      }),
    ).toEqual({ ok: true });

    const clocks = await latestServiceClocks(db, shop.id, [tank.id]);
    expect(clocks.get(tank.id)).toEqual(
      expect.arrayContaining([
        { kind: "visual_inspection", servicedOn: "2026-06-02", nextDueOn: "2027-06-02" },
        { kind: "hydro_test", servicedOn: "2024-03-10", nextDueOn: "2029-03-10" },
      ]),
    );

    const detail = await getGearItemDetail(db, shop.id, tank.id);
    expect(detail?.history.map((event) => event.servicedOn)).toEqual([
      "2026-06-02",
      "2025-06-01",
      "2024-03-10",
    ]);
  });

  it("refuses a deadline on or before the work, junk dates, and another tenant's unit", async () => {
    const { db, shop } = await gearShopContext();
    const rival = await rivalShop(db);
    const reg = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "Reg #1" }),
    );

    expect(
      await recordGearService(db, {
        shopId: shop.id,
        gearItemId: reg.id,
        kind: "service",
        servicedOn: "2026-08-01",
        nextDueOn: "2026-08-01",
      }),
    ).toEqual({ ok: false, reason: "due_not_after_service" });
    expect(
      await recordGearService(db, {
        shopId: shop.id,
        gearItemId: reg.id,
        kind: "service",
        servicedOn: "2026-02-31",
      }),
    ).toEqual({ ok: false, reason: "invalid_date" });
    expect(
      await recordGearService(db, {
        shopId: rival.id,
        gearItemId: reg.id,
        kind: "service",
        servicedOn: "2026-08-01",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("logging the bench work can return a pulled unit to service in the same stroke", async () => {
    const { db, shop } = await gearShopContext();
    const reg = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "Reg #2" }),
    );
    await setGearItemStatus(db, {
      shopId: shop.id,
      gearItemId: reg.id,
      status: "needs_service",
      serviceNote: "free-flows at depth",
    });

    expect(
      await recordGearService(db, {
        shopId: shop.id,
        gearItemId: reg.id,
        kind: "service",
        servicedOn: "2026-08-19",
        nextDueOn: "2027-08-19",
        returnToService: true,
      }),
    ).toEqual({ ok: true });

    const detail = await getGearItemDetail(db, shop.id, reg.id);
    expect(detail?.item).toMatchObject({ status: "in_service", serviceNote: null });
  });

  it("surfaces due and overdue clocks, most urgent first, and lets retired units rest", async () => {
    const { db, shop } = await gearShopContext();
    const overdueTank = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "tank", label: "AL80-02" }),
    );
    const dueSoonReg = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "Reg #3" }),
    );
    const healthyBcd = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #3" }),
    );
    const retired = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "tank", label: "AL80-99" }),
    );

    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: overdueTank.id,
      kind: "visual_inspection",
      servicedOn: "2025-08-01",
      nextDueOn: "2026-08-01",
    });
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: dueSoonReg.id,
      kind: "service",
      servicedOn: "2025-08-25",
      nextDueOn: "2026-08-25",
    });
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: healthyBcd.id,
      kind: "service",
      servicedOn: "2026-08-01",
      nextDueOn: "2027-08-01",
    });
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: retired.id,
      kind: "visual_inspection",
      servicedOn: "2024-01-01",
      nextDueOn: "2025-01-01",
    });
    await setGearItemStatus(db, { shopId: shop.id, gearItemId: retired.id, status: "retired" });

    const due = await listGearServiceDue(db, shop.id, TODAY, 7);
    expect(due.map((row) => row.label)).toEqual(["AL80-02", "Reg #3"]);
    expect(due[0]?.state).toMatchObject({ state: "overdue", kind: "visual_inspection" });
    expect(due[1]?.state).toMatchObject({ state: "due_soon" });

    // A wider window pulls nothing extra in — the healthy BCD is a year out.
    const wide = await listGearServiceDue(db, shop.id, TODAY, 30);
    expect(wide.map((row) => row.label)).toEqual(["AL80-02", "Reg #3"]);
  });
});

describe("gear reservations", () => {
  it("assigns a unit, and the database — not the app — refuses the double-booking", async () => {
    const { db, shop } = await gearShopContext();
    const bcd = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #10", size: "M" }),
    );
    const maya = await shopBooking(db, shop.id, "Maya Reyes");
    const jonah = await shopBooking(db, shop.id, "Jonah Park");

    const first = await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: bcd.id,
      bookingId: maya.bookingId,
      reservedFrom: "2026-09-01",
      reservedUntil: "2026-09-02",
    });
    expect(first.ok).toBe(true);

    // Overlapping window on the same unit: refused by the exclusion constraint.
    expect(
      await reserveGearUnit(db, {
        shopId: shop.id,
        gearItemId: bcd.id,
        bookingId: jonah.bookingId,
        reservedFrom: "2026-09-02",
        reservedUntil: "2026-09-03",
      }),
    ).toEqual({ ok: false, reason: "unit_unavailable" });

    // Adjacent, non-overlapping window: fine.
    expect(
      (
        await reserveGearUnit(db, {
          shopId: shop.id,
          gearItemId: bcd.id,
          bookingId: jonah.bookingId,
          reservedFrom: "2026-09-03",
          reservedUntil: "2026-09-04",
        })
      ).ok,
    ).toBe(true);
  });

  it("a return closes the window and frees the unit for the same dates", async () => {
    const { db, shop } = await gearShopContext();
    const wetsuit = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "wetsuit", label: "3mm #5", size: "L" }),
    );
    const maya = await shopBooking(db, shop.id, "Maya Reyes");
    const jonah = await shopBooking(db, shop.id, "Jonah Park");

    const first = await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: wetsuit.id,
      bookingId: maya.bookingId,
      reservedFrom: "2026-09-01",
      reservedUntil: "2026-09-05",
    });
    if (!first.ok) throw new Error("reserve failed");

    expect(
      await returnGearReservation(db, { shopId: shop.id, reservationId: first.reservation.id }),
    ).toEqual({ ok: true });
    expect(
      await returnGearReservation(db, { shopId: shop.id, reservationId: first.reservation.id }),
    ).toEqual({ ok: false, reason: "already_returned" });

    expect(
      (
        await reserveGearUnit(db, {
          shopId: shop.id,
          gearItemId: wetsuit.id,
          bookingId: jonah.bookingId,
          reservedFrom: "2026-09-01",
          reservedUntil: "2026-09-05",
        })
      ).ok,
    ).toBe(true);
  });

  it("refuses a pulled or retired unit, a foreign booking, and an inverted window", async () => {
    const { db, shop } = await gearShopContext();
    const rival = await rivalShop(db);
    const reg = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "Reg #9" }),
    );
    const maya = await shopBooking(db, shop.id, "Maya Reyes");
    const rivalBooking = await shopBooking(db, rival.id, "Rival Diver");

    await setGearItemStatus(db, { shopId: shop.id, gearItemId: reg.id, status: "needs_service" });
    expect(
      await reserveGearUnit(db, {
        shopId: shop.id,
        gearItemId: reg.id,
        bookingId: maya.bookingId,
        reservedFrom: "2026-09-01",
        reservedUntil: "2026-09-01",
      }),
    ).toEqual({ ok: false, reason: "unit_out_of_service" });

    await setGearItemStatus(db, { shopId: shop.id, gearItemId: reg.id, status: "in_service" });
    expect(
      await reserveGearUnit(db, {
        shopId: shop.id,
        gearItemId: reg.id,
        bookingId: rivalBooking.bookingId,
        reservedFrom: "2026-09-01",
        reservedUntil: "2026-09-01",
      }),
    ).toEqual({ ok: false, reason: "booking_not_found" });
    expect(
      await reserveGearUnit(db, {
        shopId: rival.id,
        gearItemId: reg.id,
        bookingId: rivalBooking.bookingId,
        reservedFrom: "2026-09-01",
        reservedUntil: "2026-09-01",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      await reserveGearUnit(db, {
        shopId: shop.id,
        gearItemId: reg.id,
        bookingId: maya.bookingId,
        reservedFrom: "2026-09-02",
        reservedUntil: "2026-09-01",
      }),
    ).toEqual({ ok: false, reason: "invalid_window" });
    // A booking paired with the wrong trip reads as no booking at all: the
    // prep action derives the window from the trip it posts, so a stale tab
    // must not bind another departure's booking to it.
    const otherTrip = await shopBooking(db, shop.id, "Lena Brooks");
    expect(
      await reserveGearUnit(db, {
        shopId: shop.id,
        gearItemId: reg.id,
        bookingId: otherTrip.bookingId,
        tripId: maya.trip.id,
        reservedFrom: "2026-09-01",
        reservedUntil: "2026-09-01",
      }),
    ).toEqual({ ok: false, reason: "booking_not_found" });
  });

  it("a cancelled booking lets go of the units it never collected, and keeps the one out the door", async () => {
    const { db, shop } = await gearShopContext();
    const collected = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #40" }),
    );
    const unclaimed = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "wetsuit", label: "3mm #40", size: "M" }),
    );
    const maya = await shopBooking(db, shop.id, "Maya Reyes");
    const outOutcome = await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: collected.id,
      bookingId: maya.bookingId,
      reservedFrom: "2026-09-01",
      reservedUntil: "2026-09-02",
    });
    if (!outOutcome.ok) throw new Error("reserve failed");
    await checkOutGearReservation(db, {
      shopId: shop.id,
      reservationId: outOutcome.reservation.id,
    });
    await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: unclaimed.id,
      bookingId: maya.bookingId,
      reservedFrom: "2026-09-01",
      reservedUntil: "2026-09-02",
    });

    await cancelBooking(db, shop.id, maya.bookingId);

    const assignments = await listTripGearAssignments(db, shop.id, maya.trip.id);
    const remaining = assignments.get(maya.bookingId) ?? [];
    // The wetsuit went back on the wall with the seat; the checked-out BCD is
    // physically with someone, and the overdue chase is its honest way home.
    expect(remaining.map((row) => row.label)).toEqual(["BCD #40"]);
  });

  it("walks reserve → check out → return, and release only while still on the counter", async () => {
    const { db, shop } = await gearShopContext();
    const bcd = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #11" }),
    );
    const maya = await shopBooking(db, shop.id, "Maya Reyes");

    const reserved = await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: bcd.id,
      bookingId: maya.bookingId,
      reservedFrom: "2026-09-01",
      reservedUntil: "2026-09-02",
    });
    if (!reserved.ok) throw new Error("reserve failed");
    const reservationId = reserved.reservation.id;

    expect(await checkOutGearReservation(db, { shopId: shop.id, reservationId })).toEqual({
      ok: true,
    });
    // A double-tapped Check out must not rewrite the handover stamp — that
    // timestamp is the record of when the unit actually left.
    expect(await checkOutGearReservation(db, { shopId: shop.id, reservationId })).toEqual({
      ok: false,
      reason: "already_checked_out",
    });
    // Out the door: releasing would erase the only record of who has it.
    expect(await releaseGearReservation(db, { shopId: shop.id, reservationId })).toEqual({
      ok: false,
      reason: "already_checked_out",
    });
    expect(
      await returnGearReservation(db, { shopId: shop.id, reservationId, note: "torn strap" }),
    ).toEqual({ ok: true });

    // A second reservation can be released while merely reserved.
    const again = await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: bcd.id,
      bookingId: maya.bookingId,
      reservedFrom: "2026-09-03",
      reservedUntil: "2026-09-04",
    });
    if (!again.ok) throw new Error("re-reserve failed");
    expect(
      await releaseGearReservation(db, { shopId: shop.id, reservationId: again.reservation.id }),
    ).toEqual({ ok: true });
    expect(
      await releaseGearReservation(db, { shopId: shop.id, reservationId: again.reservation.id }),
    ).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("gear register readers", () => {
  it("the picker offers only free, working units for the window", async () => {
    const { db, shop } = await gearShopContext();
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
    const { db, shop } = await gearShopContext();
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
    });
    if (!out.ok) throw new Error("reserve failed");
    await checkOutGearReservation(db, { shopId: shop.id, reservationId: out.reservation.id });
    await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: neverCollected.id,
      bookingId: jonah.bookingId,
      reservedFrom: "2026-08-10",
      reservedUntil: "2026-08-15",
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
    const { db, shop } = await gearShopContext();
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
    const { db, shop } = await gearShopContext();
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

  it("due-back and overdue read the shop's calendar and never another tenant's rows", async () => {
    const { db, shop } = await gearShopContext();
    const rival = await rivalShop(db);
    const dueToday = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "wetsuit", label: "5mm #1" }),
    );
    const overdue = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "tank", label: "AL80-40" }),
    );
    const rivalUnit = mustCreate(
      await createGearItem(db, { shopId: rival.id, kind: "wetsuit", label: "5mm #1" }),
    );
    const maya = await shopBooking(db, shop.id, "Maya Reyes");
    const rivalBooking = await shopBooking(db, rival.id, "Rival Diver");

    await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: dueToday.id,
      bookingId: maya.bookingId,
      reservedFrom: "2026-08-19",
      reservedUntil: TODAY,
    });
    await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: overdue.id,
      bookingId: maya.bookingId,
      reservedFrom: "2026-08-10",
      reservedUntil: "2026-08-15",
    });
    await reserveGearUnit(db, {
      shopId: rival.id,
      gearItemId: rivalUnit.id,
      bookingId: rivalBooking.bookingId,
      reservedFrom: "2026-08-19",
      reservedUntil: TODAY,
    });

    const dueBack = await listGearDueBack(db, shop.id, TODAY);
    expect(dueBack.map((row) => row.label)).toEqual(["5mm #1"]);
    expect(dueBack[0]?.personName).toBe("Maya Reyes");

    const late = await listOverdueGearReservations(db, shop.id, TODAY);
    expect(late.map((row) => row.label)).toEqual(["AL80-40"]);

    // The register row for the overdue unit talks about the overdue window.
    const page = await listGearItems(db, shop.id, { todayLocal: TODAY });
    const overdueRow = page.rows.find((row) => row.item.id === overdue.id);
    expect(overdueRow?.reservation?.reservedUntil).toBe("2026-08-15");
  });
});
