import { describe, expect, it } from "vitest";
import { gearServiceState, tripReservationWindow } from "@/lib/gear";
import { fileScopedShopContext } from "@/test/db";
import { createGearItem, setGearItemStatus } from "./gear-items";
import { getGearItemDetail } from "./gear-register";
import { reserveGearUnit, returnGearReservation } from "./gear-reservations";
import { latestServiceClocks, recordGearService } from "./gear-service";
import {
  gearShopContext,
  mustCreate,
  rivalShop,
  SETUP_PICK,
  shopBooking,
  TODAY,
} from "./gear-test-fixtures";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

describe("gear service history", () => {
  it("appends events, and the newest event of a kind is that clock", async () => {
    const { db, shop } = await gearShopContext(ctx);
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
        // `nextDueDives` null on both: this shop clocks its tanks by the
        // calendar only, which is the ordinary case.
        {
          kind: "visual_inspection",
          servicedOn: "2026-06-02",
          nextDueOn: "2027-06-02",
          nextDueDives: null,
        },
        {
          kind: "hydro_test",
          servicedOn: "2024-03-10",
          nextDueOn: "2029-03-10",
          nextDueDives: null,
        },
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
    const { db, shop } = await gearShopContext(ctx);
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
    const { db, shop } = await gearShopContext(ctx);
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
});

describe("the dive clock counts the rentals the shop wrote down", () => {
  it("reads a unit overdue on dives while its date is still years away", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const reg = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "REG #9" }),
    );
    // Serviced in June, next due in 2028 — nowhere near, by the calendar. The
    // shop's own interval is three dives, which the two departures below pass.
    expect(
      await recordGearService(db, {
        shopId: shop.id,
        gearItemId: reg.id,
        kind: "service",
        servicedOn: "2026-06-01",
        nextDueOn: "2028-06-01",
        nextDueDives: 3,
      }),
    ).toEqual({ ok: true });

    for (const name of ["Maya Reyes", "Jonah Pike"]) {
      const booking = await shopBooking(db, shop.id, name);
      const window = tripReservationWindow(booking.trip, shop.timezone);
      const reserved = await reserveGearUnit(db, {
        shopId: shop.id,
        gearItemId: reg.id,
        bookingId: booking.bookingId,
        reservedFrom: window.from,
        reservedUntil: window.until,
        screen: SETUP_PICK,
      });
      if (!reserved.ok) throw new Error("reserve refused");
      // Only a *returned* rental counts: a unit still out has not finished its
      // dives, which is why the count is a floor rather than a claim.
      expect(
        await returnGearReservation(db, {
          shopId: shop.id,
          reservationId: reserved.reservation.id,
        }),
      ).toEqual({ ok: true });
    }

    const clocks = (await latestServiceClocks(db, shop.id, [reg.id])).get(reg.id) ?? [];
    // Two departures of two planned dives each — `shopBooking` builds them that
    // way — so four against an interval of three.
    expect(clocks[0]).toMatchObject({ nextDueDives: 3, divesSince: 4 });
    expect(gearServiceState(clocks, TODAY)).toMatchObject({
      state: "overdue",
      dives: { since: 4, due: 3 },
    });
  });

  it("refuses a dive interval with no date beside it — half a clock cannot be compared", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const reg = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "REG #10" }),
    );
    expect(
      await recordGearService(db, {
        shopId: shop.id,
        gearItemId: reg.id,
        kind: "service",
        servicedOn: "2026-06-01",
        nextDueDives: 100,
      }),
    ).toEqual({ ok: false, reason: "dives_need_a_date" });
    expect(
      await recordGearService(db, {
        shopId: shop.id,
        gearItemId: reg.id,
        kind: "service",
        servicedOn: "2026-06-01",
        nextDueOn: "2028-06-01",
        nextDueDives: 0,
      }),
    ).toEqual({ ok: false, reason: "invalid_dives" });
  });
});
