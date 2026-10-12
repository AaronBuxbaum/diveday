import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate, nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { createGearItem, deleteGearItem } from "./gear-items";
import { listGearItems } from "./gear-register";
import {
  checkOutGearReservation,
  reserveGearUnit,
  returnGearReservation,
} from "./gear-reservations";
import {
  fitAdjustedReturnTeaching,
  listFitAdjustedReturns,
  listGearDueBack,
  listOverdueGearReservations,
} from "./gear-returns";
import {
  aSetOut,
  gearShopContext,
  mustCreate,
  rivalShop,
  SETUP_PICK,
  shopBooking,
  TODAY,
} from "./gear-test-fixtures";
import { saveRentalFit } from "./rental-fit";
import { bookings, gearReservations } from "./schema";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

describe("gear register readers: due back and overdue", () => {
  it("due-back and overdue read the shop's calendar and never another tenant's rows", async () => {
    const { db, shop } = await gearShopContext(ctx);
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
      screen: SETUP_PICK,
    });
    await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: overdue.id,
      bookingId: maya.bookingId,
      reservedFrom: "2026-08-10",
      reservedUntil: "2026-08-15",
      screen: SETUP_PICK,
    });
    await reserveGearUnit(db, {
      shopId: rival.id,
      gearItemId: rivalUnit.id,
      bookingId: rivalBooking.bookingId,
      reservedFrom: "2026-08-19",
      reservedUntil: TODAY,
      screen: SETUP_PICK,
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

/**
 * **The evening's rental-fit question** (issue #1174, D14). A `fit_adjusted`
 * return is the desk saying at the counter that the unit which went out was
 * not the one the fit named, so nothing new has to be flagged for the
 * evening to know a swap happened.
 */
describe("listFitAdjustedReturns", () => {
  // `returnGearReservation` stamps the clock, so the window this reader is
  // asked about is the one holding *now* — the shop-local day, in the caller.
  const DAY = 24 * 60 * 60 * 1000;
  const wholeDay = () => ({
    from: new Date(nowMs() - DAY),
    to: new Date(nowMs() + DAY),
  });

  it("finds only a fit-adjusted return whose size differs from the recorded fit", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const { bookingId, reservationIds } = await aSetOut(db, shop.id);
    const [bcdReservation, regReservation] = reservationIds;
    if (!bcdReservation || !regReservation) throw new Error("expected two reservations");
    const [booking] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    if (!booking) throw new Error("booking missing");
    await saveRentalFit(db, {
      shopId: shop.id,
      personId: booking.personId,
      rentsBcd: true,
      rentsRegulator: true,
      rentsWetsuit: false,
      rentsMaskFins: false,
      rentsWeights: false,
      rentsDiveComputer: false,
      rentsGopro: false,
      rentsDrysuit: false,
      rentsHood: false,
      rentsGloves: false,
      rentsTorch: false,
      rentsSmb: false,
      bcdSize: "S",
    });

    // The regulator came home fine, and a regulator has no size to learn
    // from anyway; the BCD came home fit-adjusted, at M against a recorded S.
    await returnGearReservation(db, {
      shopId: shop.id,
      reservationId: regReservation,
      outcome: "all_good",
    });
    await returnGearReservation(db, {
      shopId: shop.id,
      reservationId: bcdReservation,
      outcome: "fit_adjusted",
    });

    const rows = await listFitAdjustedReturns(db, shop.id, wholeDay());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reservationId: bcdReservation,
      kind: "bcd",
      size: "M",
      recordedSize: "S",
      personName: "Nadia Osei",
    });
  });

  it("says nothing when the fit already records the size that went out", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const { bookingId, reservationIds } = await aSetOut(db, shop.id);
    const [bcdReservation] = reservationIds;
    if (!bcdReservation) throw new Error("expected a reservation");
    const [booking] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    if (!booking) throw new Error("booking missing");
    await saveRentalFit(db, {
      shopId: shop.id,
      personId: booking.personId,
      rentsBcd: true,
      rentsRegulator: false,
      rentsWetsuit: false,
      rentsMaskFins: false,
      rentsWeights: false,
      rentsDiveComputer: false,
      rentsGopro: false,
      rentsDrysuit: false,
      rentsHood: false,
      rentsGloves: false,
      rentsTorch: false,
      rentsSmb: false,
      bcdSize: "M",
    });
    await returnGearReservation(db, {
      shopId: shop.id,
      reservationId: bcdReservation,
      outcome: "fit_adjusted",
    });

    expect(await listFitAdjustedReturns(db, shop.id, wholeDay())).toEqual([]);
  });

  it("stays inside the day it is asked about, and inside its own shop", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const { reservationIds } = await aSetOut(db, shop.id);
    const [bcdReservation] = reservationIds;
    if (!bcdReservation) throw new Error("expected a reservation");
    await returnGearReservation(db, {
      shopId: shop.id,
      reservationId: bcdReservation,
      outcome: "fit_adjusted",
    });

    // Yesterday's window sees nothing: the question expires with the shop's
    // day, so a row nobody answered never comes back every evening.
    const yesterday = { from: new Date(nowMs() - 2 * DAY), to: new Date(nowMs() - DAY) };
    expect(await listFitAdjustedReturns(db, shop.id, yesterday)).toEqual([]);

    const rival = await rivalShop(db);
    expect(await listFitAdjustedReturns(db, rival.id, wholeDay())).toEqual([]);
  });

  it("goes quiet once the unit is deleted", async () => {
    // Gear is opt-in by presence (ADR 20260815-minimal-gear-register): a
    // fleet the shop no longer has asks the shop nothing.
    const { db, shop } = await gearShopContext(ctx);
    const { reservationIds } = await aSetOut(db, shop.id);
    const [bcdReservation] = reservationIds;
    if (!bcdReservation) throw new Error("expected a reservation");
    await returnGearReservation(db, {
      shopId: shop.id,
      reservationId: bcdReservation,
      outcome: "fit_adjusted",
    });
    const [reservation] = await db
      .select({ gearItemId: gearReservations.gearItemId })
      .from(gearReservations)
      .where(eq(gearReservations.id, bcdReservation));
    if (!reservation) throw new Error("reservation missing");

    expect(await listFitAdjustedReturns(db, shop.id, wholeDay())).toHaveLength(1);
    await deleteGearItem(db, {
      shopId: shop.id,
      gearItemId: reservation.gearItemId,
      todayLocal: calendarDateInTimezone(nowDate(), shop.timezone),
    });
    expect(await listFitAdjustedReturns(db, shop.id, wholeDay())).toEqual([]);
  });

  /**
   * **A drysuit teaches the evening exactly as a BCD does** (issue #1724).
   *
   * The drysuit became a sized fit kind with `drysuit_size` and a scale of
   * its own (issue #1414), and `sizedRentalKindOfGearKind` kept returning
   * null for the register's `drysuit` units for a while after — so a suit
   * that came home a size up asked the shop nothing.
   *
   * The scale question that held it out is answered by `gear_items.size`
   * being free text for every kind: the register carries no per-kind
   * vocabulary, and this reader compares the two by trimmed string equality,
   * so a drysuit unit meets its column as loosely as a BCD unit already did.
   */
  async function aDrysuitOut(db: AppDb, shopId: string, unitSize: string) {
    const unit = mustCreate(
      await createGearItem(db, { shopId, kind: "drysuit", label: "Drysuit #3", size: unitSize }),
    );
    const diver = await shopBooking(db, shopId, "Keiko Tanaka");
    const reserved = await reserveGearUnit(db, {
      shopId,
      gearItemId: unit.id,
      bookingId: diver.bookingId,
      reservedFrom: "2026-09-10",
      reservedUntil: "2026-09-11",
      screen: SETUP_PICK,
    });
    if (!reserved.ok) throw new Error("reserve failed");
    await checkOutGearReservation(db, { shopId, reservationId: reserved.reservation.id });
    return { reservationId: reserved.reservation.id, personId: diver.personId };
  }

  async function aDrysuitFit(
    db: AppDb,
    shopId: string,
    personId: string,
    drysuitSize: string | undefined,
  ) {
    await saveRentalFit(db, {
      shopId,
      personId,
      rentsBcd: false,
      rentsRegulator: false,
      rentsWetsuit: false,
      rentsMaskFins: false,
      rentsWeights: false,
      rentsDiveComputer: false,
      rentsGopro: false,
      rentsDrysuit: true,
      rentsHood: false,
      rentsGloves: false,
      rentsTorch: false,
      rentsSmb: false,
      drysuitSize,
    });
  }

  it("asks about a drysuit that came back a size up", async () => {
    const { db, shop } = await gearShopContext(ctx);
    // The drysuit scale: a letter for girth and a trailing `T` for the tall
    // cut, which is how a rental wall is stocked. `ML` against a recorded `M`
    // is the swap a counter makes when the suit is a size up.
    const { reservationId, personId } = await aDrysuitOut(db, shop.id, "ML");
    await aDrysuitFit(db, shop.id, personId, "M");
    await returnGearReservation(db, {
      shopId: shop.id,
      reservationId,
      outcome: "fit_adjusted",
    });

    const rows = await listFitAdjustedReturns(db, shop.id, wholeDay());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reservationId,
      kind: "drysuit",
      unitLabel: "Drysuit #3",
      size: "ML",
      recordedSize: "M",
      personName: "Keiko Tanaka",
    });
  });

  it("says nothing when the drysuit fit already records the size that went out", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const { reservationId, personId } = await aDrysuitOut(db, shop.id, "MT");
    await aDrysuitFit(db, shop.id, personId, "MT");
    await returnGearReservation(db, {
      shopId: shop.id,
      reservationId,
      outcome: "fit_adjusted",
    });

    expect(await listFitAdjustedReturns(db, shop.id, wholeDay())).toEqual([]);
  });

  it("asks when the drysuit fit holds no size at all", async () => {
    // The first drysuit a diver takes has nothing on file, and the evening is
    // where that gets filled in rather than at the counter with wet hands.
    const { db, shop } = await gearShopContext(ctx);
    const { reservationId, personId } = await aDrysuitOut(db, shop.id, "L");
    await aDrysuitFit(db, shop.id, personId, undefined);
    await returnGearReservation(db, {
      shopId: shop.id,
      reservationId,
      outcome: "fit_adjusted",
    });

    expect(await listFitAdjustedReturns(db, shop.id, wholeDay())).toMatchObject([
      { kind: "drysuit", size: "L", recordedSize: null },
    ]);
  });

  it("carries an off-grid drysuit size through verbatim", async () => {
    // `drysuit_size` is the one size field whose free text is load-bearing
    // beyond the size itself: a neoprene-sock fleet records the rock-boot
    // size in it, and both fit forms hold such a value (issue #1728). A
    // reader that tidied it to a clean letter here would lose the boot.
    const { db, shop } = await gearShopContext(ctx);
    const { reservationId, personId } = await aDrysuitOut(db, shop.id, "ML, rock boot 9");
    await aDrysuitFit(db, shop.id, personId, "M");
    await returnGearReservation(db, {
      shopId: shop.id,
      reservationId,
      outcome: "fit_adjusted",
    });

    expect(await listFitAdjustedReturns(db, shop.id, wholeDay())).toMatchObject([
      { kind: "drysuit", size: "ML, rock boot 9", recordedSize: "M" },
    ]);
  });

  it("re-proves the drysuit teaching from the reservation the evening tap names", async () => {
    // The tap writes through `fitAdjustedReturnTeaching`, not through the
    // list, so the mapping has to hold on both doors or the question renders
    // and then writes nothing.
    const { db, shop } = await gearShopContext(ctx);
    const { reservationId, personId } = await aDrysuitOut(db, shop.id, "ML");
    await aDrysuitFit(db, shop.id, personId, "M");
    await returnGearReservation(db, {
      shopId: shop.id,
      reservationId,
      outcome: "fit_adjusted",
    });

    expect(await fitAdjustedReturnTeaching(db, { shopId: shop.id, reservationId })).toEqual({
      personId,
      kind: "drysuit",
      size: "ML",
    });
  });
});

/**
 * **What the evening's one tap is allowed to write** (`security-reviewer`,
 * issue #1453). `keepRentalFitAction` is open to every staff role because it
 * writes down what the desk already decided; this lookup is the whole of
 * that claim, so a reservation it does not own, or one nobody recorded a
 * `fit_adjusted` return against, has to come back as nothing to write.
 */
describe("fitAdjustedReturnTeaching", () => {
  async function aFitAdjustedReturn(db: AppDb, shopId: string) {
    const { bookingId, personId, reservationIds } = await aSetOut(db, shopId);
    const [bcdReservation] = reservationIds;
    if (!bcdReservation) throw new Error("expected a reservation");
    return { bookingId, personId, bcdReservation };
  }

  it("hands back the size the unit actually went out in", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const { personId, bcdReservation } = await aFitAdjustedReturn(db, shop.id);
    await returnGearReservation(db, {
      shopId: shop.id,
      reservationId: bcdReservation,
      outcome: "fit_adjusted",
    });

    // The size comes from the unit, never from the caller: `aSetOut` put out
    // BCD #21 at M.
    expect(
      await fitAdjustedReturnTeaching(db, { shopId: shop.id, reservationId: bcdReservation }),
    ).toEqual({ personId, kind: "bcd", size: "M" });
  });

  it("says nothing about another shop's reservation", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const { bcdReservation } = await aFitAdjustedReturn(db, shop.id);
    await returnGearReservation(db, {
      shopId: shop.id,
      reservationId: bcdReservation,
      outcome: "fit_adjusted",
    });

    const rival = await rivalShop(db);
    expect(
      await fitAdjustedReturnTeaching(db, { shopId: rival.id, reservationId: bcdReservation }),
    ).toBeNull();
  });

  it("says nothing when the desk recorded a different outcome", async () => {
    // "All good" is the counter saying the unit that went out was the right
    // one. There is no swap to learn from, so there is no size to write.
    const { db, shop } = await gearShopContext(ctx);
    const { bcdReservation } = await aFitAdjustedReturn(db, shop.id);
    await returnGearReservation(db, {
      shopId: shop.id,
      reservationId: bcdReservation,
      outcome: "all_good",
    });

    expect(
      await fitAdjustedReturnTeaching(db, { shopId: shop.id, reservationId: bcdReservation }),
    ).toBeNull();
  });

  it("says nothing about a reservation nobody returned, or an id nobody issued", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const { bcdReservation } = await aFitAdjustedReturn(db, shop.id);

    expect(
      await fitAdjustedReturnTeaching(db, { shopId: shop.id, reservationId: bcdReservation }),
    ).toBeNull();
    expect(
      await fitAdjustedReturnTeaching(db, {
        shopId: shop.id,
        reservationId: "00000000-0000-4000-8000-000000000000",
      }),
    ).toBeNull();
  });
});
