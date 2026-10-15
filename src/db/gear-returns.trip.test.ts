import { eq, inArray } from "drizzle-orm";
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
import { gearItems, gearReservations } from "./schema";

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
    ).toEqual({ ok: true, pulled: 0 });
    expect(
      await returnTripGearUnit(db, {
        shopId: shop.id,
        tripId: out.tripId,
        reservationId: reg,
        outcome: "service_concern",
        note: "Inflator sticks",
      }),
    ).toEqual({ ok: true, pulled: 0 });
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

  it("pulls the one unit to the bench with its problem, in the same act, only when ticked", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const out = await aSetOut(db, shop.id);
    const rows = await db
      .select({ id: gearReservations.id, gearItemId: gearReservations.gearItemId })
      .from(gearReservations)
      .where(inArray(gearReservations.id, out.reservationIds));
    const [first, second] = rows;
    if (!first || !second) throw new Error("set missing");
    const status = async (gearItemId: string) =>
      (
        await db
          .select({ status: gearItems.status, note: gearItems.serviceNote })
          .from(gearItems)
          .where(eq(gearItems.id, gearItemId))
      )[0];

    // A tick naming another unit of the set pulls nothing: only the unit this return closes.
    expect(
      await returnTripGearUnit(db, {
        shopId: shop.id,
        tripId: out.tripId,
        reservationId: first.id,
        outcome: "service_concern",
        note: "Inflator sticks",
        pullGearItemIds: [second.gearItemId],
      }),
    ).toEqual({ ok: true, pulled: 0 });
    expect(await status(second.gearItemId)).toMatchObject({ status: "in_service" });

    expect(
      await returnTripGearUnit(db, {
        shopId: shop.id,
        tripId: out.tripId,
        reservationId: second.id,
        outcome: "service_concern",
        note: "Free-flows at depth",
        pullGearItemIds: [second.gearItemId],
      }),
    ).toEqual({ ok: true, pulled: 1 });
    expect(await status(second.gearItemId)).toMatchObject({
      status: "needs_service",
      note: "Free-flows at depth",
    });
  });
});
