import { inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createGearItem } from "./gear-items";
import { reserveGearUnit } from "./gear-reservations";
import { listTripUnitsToCheckIn, returnTripGearUnit } from "./gear-returns";
import {
  aSetOut,
  gearShopContext,
  mustCreate,
  SETUP_PICK,
  shopBooking,
} from "./gear-test-fixtures";
import { gearReservations } from "./schema";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/** Kit comes back by boat, not by date (fifth-loop ideas, item 5). */
describe("units back from the boat", () => {
  it("lists every unit that went out on the departure, and none still on the wall", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const out = await aSetOut(db, shop.id);
    // A unit reserved on the same departure but never handed over never went to sea.
    const fins = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "fins", label: "Fins #3", size: "M" }),
    );
    const reserved = await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: fins.id,
      bookingId: out.bookingId,
      reservedFrom: "2026-09-10",
      reservedUntil: "2026-09-11",
      screen: SETUP_PICK,
    });
    expect(reserved.ok).toBe(true);
    const units = await listTripUnitsToCheckIn(db, shop.id, out.tripId);
    expect(units.map((unit) => unit.reservationId).sort()).toEqual([...out.reservationIds].sort());
    expect(units[0]?.personName).toBe("Nadia Osei");
  });

  it("closes one unit with Back, and a problem only with words, as a service concern", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const out = await aSetOut(db, shop.id);
    const [bcd, reg] = out.reservationIds;
    if (!bcd || !reg) throw new Error("set missing");
    expect(
      await returnTripGearUnit(db, {
        shopId: shop.id,
        tripId: out.tripId,
        reservationId: reg,
        outcome: "service_concern",
        note: "  ",
      }),
    ).toEqual({ ok: false, reason: "concern_needs_words" });
    expect(
      await returnTripGearUnit(db, {
        shopId: shop.id,
        tripId: out.tripId,
        reservationId: bcd,
        outcome: "all_good",
      }),
    ).toEqual({ ok: true });
    expect(
      await returnTripGearUnit(db, {
        shopId: shop.id,
        tripId: out.tripId,
        reservationId: reg,
        outcome: "service_concern",
        note: "Inflator sticks",
      }),
    ).toEqual({ ok: true });
    const rows = await db
      .select({
        id: gearReservations.id,
        outcome: gearReservations.returnOutcome,
        note: gearReservations.returnNote,
        returnedAt: gearReservations.returnedAt,
      })
      .from(gearReservations)
      .where(inArray(gearReservations.id, out.reservationIds));
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(bcd)).toMatchObject({ outcome: "all_good", note: null });
    expect(byId.get(reg)).toMatchObject({ outcome: "service_concern", note: "Inflator sticks" });
    expect(await listTripUnitsToCheckIn(db, shop.id, out.tripId)).toEqual([]);
    // A second tap closes nothing.
    expect(
      await returnTripGearUnit(db, {
        shopId: shop.id,
        tripId: out.tripId,
        reservationId: bcd,
        outcome: "all_good",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a unit that is not out on this departure", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const out = await aSetOut(db, shop.id);
    const other = await shopBooking(db, shop.id, "Theo Park");
    const [bcd] = out.reservationIds;
    if (!bcd) throw new Error("set missing");
    expect(
      await returnTripGearUnit(db, {
        shopId: shop.id,
        tripId: other.trip.id,
        reservationId: bcd,
        outcome: "all_good",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await listTripUnitsToCheckIn(db, shop.id, other.trip.id)).toEqual([]);
  });
});
