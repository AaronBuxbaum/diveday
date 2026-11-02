import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { tripReservationWindow } from "@/lib/gear";
import { fileScopedShopContext, seededShopContext } from "@/test/db";
import { cancelBooking } from "./bookings";
import type { AppDb } from "./client";
import { listAvailableGearUnits, listTripGearAssignments } from "./gear-availability";
import { createGearItem, setGearItemStatus } from "./gear-items";
import { getGearItemDetail } from "./gear-register";
import {
  checkOutGearReservation,
  releaseGearReservation,
  reserveGearUnit,
  returnGearReservation,
} from "./gear-reservations";
import { recordGearService } from "./gear-service";
import {
  deskStaffer,
  gearShopContext,
  mustCreate,
  rivalShop,
  SETUP_PICK,
  shopBooking,
  storedReservation,
} from "./gear-test-fixtures";
import { bookings, gearReservations, trips } from "./schema";
import { moveTrip, setTripStatus } from "./trips";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

describe("reserveGearUnit's screen, held under the booking's lock (issue #2215)", () => {
  const WINDOW = { reservedFrom: "2026-09-01", reservedUntil: "2026-09-01" } as const;
  const screen = (proposed: boolean) => ({ proposed });

  it("gives one diver one BCD when two tablets assign different BCDs at the same instant", async () => {
    // A database of its own: the two assignments must race as two
    // transactions, and inside the file's shared one they would run as one
    // (src/test/db.ts, "When NOT to use this").
    const { db, shop } = await gearShopContext(await seededShopContext());
    const bcd3 = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #3", size: "M" }),
    );
    const bcd4 = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #4", size: "M" }),
    );
    const carmen = await shopBooking(db, shop.id, "Carmen Ortiz");

    const outcomes = await Promise.all(
      [bcd3, bcd4].map((unit) =>
        reserveGearUnit(db, {
          shopId: shop.id,
          gearItemId: unit.id,
          bookingId: carmen.bookingId,
          tripId: carmen.trip.id,
          ...WINDOW,
          screen: screen(false),
        }),
      ),
    );

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([
      { ok: false, reason: "already_holds_kind" },
    ]);
    const held = await db
      .select({ id: gearReservations.id })
      .from(gearReservations)
      .where(eq(gearReservations.bookingId, carmen.bookingId));
    expect(held).toHaveLength(1);
  });

  it("still lets the diver hold one unit of each kind, and a returned unit holds nothing", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const bcd = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #5", size: "M" }),
    );
    const reg = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "Reg #5" }),
    );
    const spare = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #6", size: "M" }),
    );
    const carmen = await shopBooking(db, shop.id, "Carmen Ortiz");
    const reserve = (gearItemId: string) =>
      reserveGearUnit(db, {
        shopId: shop.id,
        gearItemId,
        bookingId: carmen.bookingId,
        ...WINDOW,
        screen: screen(false),
      });

    const first = await reserve(bcd.id);
    if (!first.ok) throw new Error(`reserve refused: ${first.reason}`);
    expect((await reserve(reg.id)).ok).toBe(true);
    expect(await reserve(spare.id)).toEqual({ ok: false, reason: "already_holds_kind" });

    await returnGearReservation(db, { shopId: shop.id, reservationId: first.reservation.id });
    expect((await reserve(spare.id)).ok).toBe(true);
  });

  it("refuses a proposed unit that gained an open service concern, and lets a hand pick choose it", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const reg = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "Reg #7" }),
    );
    const earlier = await shopBooking(db, shop.id, "Ben Okafor");
    const carmen = await shopBooking(db, shop.id, "Carmen Ortiz");
    // The unit's last return, landing between the tab's screen and the write.
    const before = await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: reg.id,
      bookingId: earlier.bookingId,
      reservedFrom: "2026-08-10",
      reservedUntil: "2026-08-11",
      screen: screen(false),
    });
    if (!before.ok) throw new Error(`reserve refused: ${before.reason}`);
    await returnGearReservation(db, {
      shopId: shop.id,
      reservationId: before.reservation.id,
      outcome: "service_concern",
      note: "Second stage free-flows",
    });

    const pick = (proposed: boolean, assignAnyway?: boolean) =>
      reserveGearUnit(db, {
        shopId: shop.id,
        gearItemId: reg.id,
        bookingId: carmen.bookingId,
        ...WINDOW,
        screen: { proposed, assignAnyway },
      });
    expect(await pick(true)).toEqual({ ok: false, reason: "needs_care" });
    expect(await openReservationsOf(db, carmen.bookingId)).toBe(0);
    // A hand pick of a regulator is life support: the staffer is asked, in
    // words, before it is assigned (dive-domain review). Saying "Assign
    // anyway" is the dock deciding (H-20260724-initial-gear-policy-sizing).
    expect(await pick(false)).toEqual({ ok: false, reason: "needs_care_confirm" });
    expect(await openReservationsOf(db, carmen.bookingId)).toBe(0);
    expect((await pick(false, true)).ok).toBe(true);
  });

  it("refuses a proposed unit whose service clock has lapsed", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const tank = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "tank", label: "AL80-31" }),
    );
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: tank.id,
      kind: "visual_inspection",
      servicedOn: "2025-08-01",
      nextDueOn: "2026-08-01",
    });
    const carmen = await shopBooking(db, shop.id, "Carmen Ortiz");
    expect(
      await reserveGearUnit(db, {
        shopId: shop.id,
        gearItemId: tank.id,
        bookingId: carmen.bookingId,
        ...WINDOW,
        screen: screen(true),
      }),
    ).toEqual({ ok: false, reason: "needs_care" });
  });

  it("lets one diver take two tanks: only the kinds the fit sizes are one per diver", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const first = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "tank", label: "AL80-41" }),
    );
    const second = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "tank", label: "AL80-42" }),
    );
    const carmen = await shopBooking(db, shop.id, "Carmen Ortiz");
    for (const unit of [first, second]) {
      const outcome = await reserveGearUnit(db, {
        shopId: shop.id,
        gearItemId: unit.id,
        bookingId: carmen.bookingId,
        ...WINDOW,
        screen: screen(false),
      });
      expect(outcome.ok).toBe(true);
    }
  });

  it("assigns a hand-picked wetsuit with a lapsed clock without asking: only life support asks", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const suit = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "wetsuit", label: "Suit #4", size: "M" }),
    );
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: suit.id,
      kind: "visual_inspection",
      servicedOn: "2025-08-01",
      nextDueOn: "2026-08-01",
    });
    const carmen = await shopBooking(db, shop.id, "Carmen Ortiz");
    const outcome = await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: suit.id,
      bookingId: carmen.bookingId,
      ...WINDOW,
      screen: screen(false),
    });
    expect(outcome.ok).toBe(true);
  });

  /**
   * **Care is read on the window's last day, not today** (dive-domain
   * review). A regulator due on 31 August is fine on the 20th and lapsed on
   * the 1 September dive it would be packed for.
   */
  it("reads a clock against the window's last day", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const reg = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "Reg #12" }),
    );
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: reg.id,
      kind: "service",
      servicedOn: "2025-08-31",
      nextDueOn: "2026-08-31",
    });
    const carmen = await shopBooking(db, shop.id, "Carmen Ortiz");
    expect(
      await reserveGearUnit(db, {
        shopId: shop.id,
        gearItemId: reg.id,
        bookingId: carmen.bookingId,
        ...WINDOW,
        screen: screen(true),
      }),
    ).toEqual({ ok: false, reason: "needs_care" });
  });

  it("assigns nothing to a held seat until the desk confirms who it is", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const bcd = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #14", size: "M" }),
    );
    const carmen = await shopBooking(db, shop.id, "Carmen Ortiz");
    await db
      .update(bookings)
      .set({
        identityUnconfirmedAt: new Date("2026-08-19T12:00:00Z"),
        identityBookedAs: "C. Ortiz",
      })
      .where(eq(bookings.id, carmen.bookingId));
    for (const proposed of [true, false]) {
      expect(
        await reserveGearUnit(db, {
          shopId: shop.id,
          gearItemId: bcd.id,
          bookingId: carmen.bookingId,
          ...WINDOW,
          screen: screen(proposed),
        }),
      ).toEqual({ ok: false, reason: "identity_held" });
    }
    expect(await openReservationsOf(db, carmen.bookingId)).toBe(0);
  });
});

async function openReservationsOf(db: AppDb, bookingId: string): Promise<number> {
  const rows = await db
    .select({ id: gearReservations.id })
    .from(gearReservations)
    .where(eq(gearReservations.bookingId, bookingId));
  return rows.length;
}

describe("gear reservations", () => {
  it("assigns a unit, and the database — not the app — refuses the double-booking", async () => {
    const { db, shop } = await gearShopContext(ctx);
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
      screen: SETUP_PICK,
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
        screen: SETUP_PICK,
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
          screen: SETUP_PICK,
        })
      ).ok,
    ).toBe(true);
  });

  it("a return closes the window and frees the unit for the same dates", async () => {
    const { db, shop } = await gearShopContext(ctx);
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
      screen: SETUP_PICK,
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
          screen: SETUP_PICK,
        })
      ).ok,
    ).toBe(true);
  });

  it("refuses a pulled unit, a foreign booking, and an inverted window", async () => {
    const { db, shop } = await gearShopContext(ctx);
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
        screen: SETUP_PICK,
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
        screen: SETUP_PICK,
      }),
    ).toEqual({ ok: false, reason: "booking_not_found" });
    expect(
      await reserveGearUnit(db, {
        shopId: rival.id,
        gearItemId: reg.id,
        bookingId: rivalBooking.bookingId,
        reservedFrom: "2026-09-01",
        reservedUntil: "2026-09-01",
        screen: SETUP_PICK,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      await reserveGearUnit(db, {
        shopId: shop.id,
        gearItemId: reg.id,
        bookingId: maya.bookingId,
        reservedFrom: "2026-09-02",
        reservedUntil: "2026-09-01",
        screen: SETUP_PICK,
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
        screen: SETUP_PICK,
      }),
    ).toEqual({ ok: false, reason: "booking_not_found" });
  });

  it("a canceled booking lets go of the units it never collected, and keeps the one out the door", async () => {
    const { db, shop } = await gearShopContext(ctx);
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
      screen: SETUP_PICK,
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
      screen: SETUP_PICK,
    });

    await cancelBooking(db, shop.id, maya.bookingId);

    const assignments = await listTripGearAssignments(db, shop.id, maya.trip.id);
    const remaining = assignments.get(maya.bookingId) ?? [];
    // The wetsuit went back on the wall with the seat; the checked-out BCD is
    // physically with someone, and the overdue chase is its honest way home.
    expect(remaining.map((row) => row.label)).toEqual(["BCD #40"]);
    // Let go with a stamp, not a delete, and by nobody: the system did it.
    const kept = await db
      .select()
      .from(gearReservations)
      .where(eq(gearReservations.gearItemId, unclaimed.id));
    expect(kept).toHaveLength(1);
    expect(kept[0]?.releasedAt).toBeInstanceOf(Date);
    expect(kept[0]?.releasedByPersonId).toBeNull();
  });

  it("a canceled departure frees its counter pile, keeps what's out, and touches no other trip", async () => {
    // Trip-level cancellations (per-date cancel, blow-out, the minimum sweep,
    // series narrowing) keep their bookings, so the booking cascade never
    // runs — without the release in setTripStatus these units would sit
    // blocked in the picker for as long as anyone remembered to look.
    const { db, shop } = await gearShopContext(ctx);
    const collected = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #50" }),
    );
    const unclaimed = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "wetsuit", label: "3mm #50", size: "L" }),
    );
    const elsewhere = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "Reg #50" }),
    );
    const maya = await shopBooking(db, shop.id, "Maya Reyes");
    const lena = await shopBooking(db, shop.id, "Lena Brooks");
    const out = await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: collected.id,
      bookingId: maya.bookingId,
      reservedFrom: "2026-09-01",
      reservedUntil: "2026-09-02",
      screen: SETUP_PICK,
    });
    if (!out.ok) throw new Error("reserve failed");
    await checkOutGearReservation(db, { shopId: shop.id, reservationId: out.reservation.id });
    await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: unclaimed.id,
      bookingId: maya.bookingId,
      reservedFrom: "2026-09-01",
      reservedUntil: "2026-09-02",
      screen: SETUP_PICK,
    });
    await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: elsewhere.id,
      bookingId: lena.bookingId,
      reservedFrom: "2026-09-01",
      reservedUntil: "2026-09-02",
      screen: SETUP_PICK,
    });

    await setTripStatus(db, shop.id, maya.trip.id, "cancelled");

    const cancelledTrip = await listTripGearAssignments(db, shop.id, maya.trip.id);
    // The un-collected wetsuit went back on the wall; the checked-out BCD is
    // with a diver and stays until it is returned.
    expect((cancelledTrip.get(maya.bookingId) ?? []).map((row) => row.label)).toEqual(["BCD #50"]);
    // The other departure's reservation is not this cancellation's to touch.
    const otherTrip = await listTripGearAssignments(db, shop.id, lena.trip.id);
    expect((otherTrip.get(lena.bookingId) ?? []).map((row) => row.label)).toEqual(["Reg #50"]);
  });

  it("walks reserve → check out → return, and release only while still on the counter", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const releasedByPersonId = await deskStaffer(db, shop.id);
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
      screen: SETUP_PICK,
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
    expect(
      await releaseGearReservation(db, { shopId: shop.id, reservationId, releasedByPersonId }),
    ).toEqual({
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
      screen: SETUP_PICK,
    });
    if (!again.ok) throw new Error("re-reserve failed");
    const releaseAgain = {
      shopId: shop.id,
      reservationId: again.reservation.id,
      releasedByPersonId,
    };
    expect(await releaseGearReservation(db, releaseAgain)).toEqual({ ok: true });
    expect(await releaseGearReservation(db, releaseAgain)).toEqual({
      ok: false,
      reason: "not_found",
    });

    // A unit marked returned without ever being checked out (the counter
    // correcting a row) refuses a release by naming that state — not the
    // check-out that never happened.
    const returnedOnly = await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: bcd.id,
      bookingId: maya.bookingId,
      reservedFrom: "2026-09-05",
      reservedUntil: "2026-09-06",
      screen: SETUP_PICK,
    });
    if (!returnedOnly.ok) throw new Error("re-reserve failed");
    expect(
      await returnGearReservation(db, {
        shopId: shop.id,
        reservationId: returnedOnly.reservation.id,
      }),
    ).toEqual({ ok: true });
    expect(
      await releaseGearReservation(db, {
        shopId: shop.id,
        reservationId: returnedOnly.reservation.id,
        releasedByPersonId,
      }),
    ).toEqual({ ok: false, reason: "already_returned" });
  });

  it("releases a hold with a stamp, keeps the row, and never lets it block a new hold (issue #2258)", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const releasedByPersonId = await deskStaffer(db, shop.id);
    const bcd = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #12", size: "M" }),
    );
    const maya = await shopBooking(db, shop.id, "Maya Reyes");
    const lena = await shopBooking(db, shop.id, "Lena Ortiz");
    const window = { reservedFrom: "2026-09-01", reservedUntil: "2026-09-02" } as const;
    const held = await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: bcd.id,
      bookingId: maya.bookingId,
      ...window,
      screen: SETUP_PICK,
    });
    if (!held.ok) throw new Error("reserve failed");
    const reservationId = held.reservation.id;

    expect(
      await releaseGearReservation(db, { shopId: shop.id, reservationId, releasedByPersonId }),
    ).toEqual({ ok: true });

    // The record that the unit was held for Maya survives the release.
    const stored = await storedReservation(db, reservationId);
    expect(stored).toMatchObject({ bookingId: maya.bookingId, releasedByPersonId });
    expect(stored?.releasedAt).toBeInstanceOf(Date);
    expect(stored?.checkedOutAt).toBeNull();
    expect(stored?.returnedAt).toBeNull();

    // …and is gone to every open-reservation reader.
    expect((await listTripGearAssignments(db, shop.id, maya.trip.id)).get(maya.bookingId)).toBe(
      undefined,
    );
    expect(
      (
        await listAvailableGearUnits(db, shop.id, {
          from: window.reservedFrom,
          until: window.reservedUntil,
          todayLocal: window.reservedFrom,
        })
      ).map((unit) => unit.id),
    ).toContain(bcd.id);
    expect((await getGearItemDetail(db, shop.id, bcd.id))?.reservations).toEqual([]);

    // A released hold is not an open one: no act reaches it again.
    const sameRow = { shopId: shop.id, reservationId };
    expect(await checkOutGearReservation(db, sameRow)).toEqual({ ok: false, reason: "not_found" });
    expect(await returnGearReservation(db, sameRow)).toEqual({ ok: false, reason: "not_found" });

    // The exclusion constraint ignores it: the same unit, the same window, a
    // different diver, and then the same diver again.
    const lenaHold = await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: bcd.id,
      bookingId: lena.bookingId,
      ...window,
      screen: SETUP_PICK,
    });
    expect(lenaHold.ok).toBe(true);
    // …while an open overlap is still refused, so the rule is intact.
    expect(
      await reserveGearUnit(db, {
        shopId: shop.id,
        gearItemId: bcd.id,
        bookingId: maya.bookingId,
        ...window,
        screen: SETUP_PICK,
      }),
    ).toEqual({ ok: false, reason: "unit_unavailable" });
  });

  it("refuses at the database a release stamp on a unit that left the counter (issue #2258)", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const bcd = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #13" }),
    );
    const maya = await shopBooking(db, shop.id, "Maya Reyes");
    const held = await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: bcd.id,
      bookingId: maya.bookingId,
      reservedFrom: "2026-09-01",
      reservedUntil: "2026-09-02",
      screen: SETUP_PICK,
    });
    if (!held.ok) throw new Error("reserve failed");
    await checkOutGearReservation(db, { shopId: shop.id, reservationId: held.reservation.id });
    // A raw write past the writer's own guard: the check still holds the line,
    // because a released out unit would erase the only record of who has it.
    await expect(
      db
        .update(gearReservations)
        .set({ releasedAt: nowDate() })
        .where(eq(gearReservations.id, held.reservation.id)),
    ).rejects.toThrow();
  });
});

describe("a departure that moves takes its gear with it", () => {
  /**
   * The window is derived from the trip at assign time and never re-read, so
   * before `rewindowTripGearReservations` the boat left on the new day with kit
   * the register still believed was out on the old one — free to be
   * double-assigned, and overdue on the wrong date.
   */
  it("slides unclaimed reservations onto the new dates", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const maya = await shopBooking(db, shop.id, "Maya Reyes");
    const bcd = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #7", size: "M" }),
    );
    const window = tripReservationWindow(maya.trip, shop.timezone);
    expect(
      await reserveGearUnit(db, {
        shopId: shop.id,
        gearItemId: bcd.id,
        bookingId: maya.bookingId,
        reservedFrom: window.from,
        reservedUntil: window.until,
        screen: SETUP_PICK,
      }),
    ).toMatchObject({ ok: true });

    const moved = await moveTrip(db, shop.id, maya.trip.id, new Date("2026-09-08T12:00:00Z"));
    expect(moved).toMatchObject({ ok: true, gearReleased: 0 });

    const [row] = await db
      .select()
      .from(gearReservations)
      .where(eq(gearReservations.gearItemId, bcd.id));
    expect(row?.reservedFrom).toBe("2026-09-08");
    expect(row?.reservedUntil).toBe("2026-09-08");
  });

  it("leaves a checked-out unit's window alone — that handover already happened", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const maya = await shopBooking(db, shop.id, "Maya Reyes");
    const reg = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "REG #3" }),
    );
    const window = tripReservationWindow(maya.trip, shop.timezone);
    const reserved = await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: reg.id,
      bookingId: maya.bookingId,
      reservedFrom: window.from,
      reservedUntil: window.until,
      screen: SETUP_PICK,
    });
    if (!reserved.ok) throw new Error("reserve refused");
    expect(
      await checkOutGearReservation(db, {
        shopId: shop.id,
        reservationId: reserved.reservation.id,
      }),
    ).toEqual({ ok: true });

    expect(
      await moveTrip(db, shop.id, maya.trip.id, new Date("2026-09-08T12:00:00Z")),
    ).toMatchObject({ ok: true, gearReleased: 0 });

    const [row] = await db
      .select()
      .from(gearReservations)
      .where(eq(gearReservations.id, reserved.reservation.id));
    expect(row?.reservedFrom).toBe(window.from);
  });

  it("releases a reservation the new dates collide with, and counts it", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const maya = await shopBooking(db, shop.id, "Maya Reyes");
    const jonah = await shopBooking(db, shop.id, "Jonah Pike");
    const tank = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "tank", label: "AL80-77" }),
    );

    // Maya's departure holds the unit on Sep 1. Jonah's booking holds the same
    // unit on Sep 8 — the day Maya's departure is about to move onto.
    const mayaWindow = tripReservationWindow(maya.trip, shop.timezone);
    const mayaReservation = await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: tank.id,
      bookingId: maya.bookingId,
      reservedFrom: mayaWindow.from,
      reservedUntil: mayaWindow.until,
      screen: SETUP_PICK,
    });
    if (!mayaReservation.ok) throw new Error("reserve refused");
    expect(
      await reserveGearUnit(db, {
        shopId: shop.id,
        gearItemId: tank.id,
        bookingId: jonah.bookingId,
        reservedFrom: "2026-09-08",
        reservedUntil: "2026-09-08",
        screen: SETUP_PICK,
      }),
    ).toMatchObject({ ok: true });

    const moved = await moveTrip(db, shop.id, maya.trip.id, new Date("2026-09-08T12:00:00Z"));
    expect(moved).toMatchObject({ ok: true, gearReleased: 1 });

    // Maya's is let go, on its old dates and by nobody (the move did it);
    // Jonah's — which was there first and is not moving — is untouched. The
    // count is what the board turns into a sentence, and the reason the
    // release is not silent.
    const rows = await db
      .select()
      .from(gearReservations)
      .where(eq(gearReservations.gearItemId, tank.id));
    const open = rows.filter((row) => row.releasedAt === null);
    expect(open.map((row) => row.bookingId)).toEqual([jonah.bookingId]);
    const released = rows.filter((row) => row.releasedAt !== null);
    expect(released.map((row) => row.bookingId)).toEqual([maya.bookingId]);
    expect(released[0]?.releasedByPersonId).toBeNull();

    // The move itself still happened — one gear collision must not veto a
    // schedule edit the crew has already agreed with a customer.
    const [trip] = await db.select().from(trips).where(eq(trips.id, maya.trip.id));
    expect(trip?.startsAt.toISOString()).toBe("2026-09-08T12:00:00.000Z");
  });
});
