import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { AppDb } from "./client";
import { correctCounterTankFill, getCounterRentalTicket } from "./gear-counter-rentals";
import {
  heldBy,
  insertShop,
  lend,
  person,
  rentalShop,
  rented,
  staffer,
  unit,
} from "./gear-counter-rentals-test-fixtures";
import { recordGearService } from "./gear-service";
import { gearReservations, nitroxCertifications, shops } from "./schema";

/**
 * **An EANx tank that left without a current O2-clean record** (issue #3005).
 * The counter warns in the cart (#2719); this is the record the compressor
 * reads afterwards, on the rental's tank line. Set server side from the same
 * service clocks the counter reads, as of the rental's last day, and by the
 * same rule as the warning (`o2CleanWarnsForFill`). It informs: no fill is
 * ever refused for it.
 */

async function nitroxDiver(db: AppDb, shopId: string, name = "Nitrox Nia") {
  const diver = await person(db, shopId, name);
  await db.insert(nitroxCertifications).values({
    shopId,
    personId: diver.id,
    agency: "padi",
    identifier: `EAN-${diver.id.slice(0, 8)}`,
    status: "verified",
  });
  return diver;
}

async function o2Clean(
  db: AppDb,
  shopId: string,
  gearItemId: string,
  servicedOn: string,
  nextDueOn?: string,
) {
  expect(
    await recordGearService(db, { shopId, gearItemId, kind: "o2_clean", servicedOn, nextDueOn }),
  ).toMatchObject({ ok: true });
}

async function tankLine(db: AppDb, shopId: string, ticketId: string) {
  const ticket = await getCounterRentalTicket(db, shopId, ticketId);
  return ticket?.units.find((line) => line.kind === "tank");
}

describe("counter EANx without a current O2-clean record", () => {
  it("rents the tank and records that it was never cleaned", async () => {
    const { db, shop } = await rentalShop();
    const diver = await nitroxDiver(db, shop.id);
    const tank = await unit(db, shop.id, "Tank #1", "tank");
    const outcome = rented(
      await lend(db, shop.id, diver.id, [tank.id], { tankFills: { [tank.id]: 32 } }),
    );
    const line = await tankLine(db, shop.id, outcome.ticketId);
    expect(line?.fillO2Percent).toBe(32);
    expect(line?.fillO2CleanGap).toBe("never");
  });

  it("records a cleaning that had lapsed on the day of the fill", async () => {
    const { db, shop } = await rentalShop();
    const diver = await nitroxDiver(db, shop.id);
    const tank = await unit(db, shop.id, "Tank #1", "tank");
    // No due date written: the conventional twelve months, so it ran out on
    // 2026-10-07, the day before this fill.
    await o2Clean(db, shop.id, tank.id, "2025-10-07");
    const outcome = rented(
      await lend(db, shop.id, diver.id, [tank.id], { tankFills: { [tank.id]: 36 } }),
    );
    expect((await tankLine(db, shop.id, outcome.ticketId))?.fillO2CleanGap).toBe("lapsed");
  });

  it("judges the cleaning on the day of the fill, not the rental's last day (domain review 2026-11-02)", async () => {
    const { db, shop } = await rentalShop();
    const diver = await nitroxDiver(db, shop.id);
    const tank = await unit(db, shop.id, "Tank #1", "tank");
    // Runs out on 2026-10-09, the second day of a three-day rental filled on
    // the 8th: the gas went in a clean tank, so the ticket says nothing.
    await o2Clean(db, shop.id, tank.id, "2025-10-09");
    const outcome = rented(
      await lend(db, shop.id, diver.id, [tank.id], {
        tankFills: { [tank.id]: 36 },
        reservedUntil: "2026-10-10",
      }),
    );
    expect((await tankLine(db, shop.id, outcome.ticketId))?.fillO2CleanGap).toBeNull();
  });

  it("records nothing on a current cleaning, on air, or on a tank only another tank's record covers", async () => {
    const { db, shop } = await rentalShop();
    const diver = await nitroxDiver(db, shop.id);
    const cleaned = await unit(db, shop.id, "Tank #1", "tank");
    const aired = await unit(db, shop.id, "Tank #2", "tank");
    const other = await unit(db, shop.id, "Tank #3", "tank");
    const hydroOnly = await unit(db, shop.id, "Tank #4", "tank");
    await o2Clean(db, shop.id, cleaned.id, "2026-09-01", "2027-09-01");
    // A hydro test is not an oxygen cleaning.
    expect(
      await recordGearService(db, {
        shopId: shop.id,
        gearItemId: hydroOnly.id,
        kind: "hydro_test",
        servicedOn: "2026-09-01",
        nextDueOn: "2031-09-01",
      }),
    ).toMatchObject({ ok: true });
    const outcome = rented(
      await lend(db, shop.id, diver.id, [cleaned.id, aired.id, other.id, hydroOnly.id], {
        tankFills: { [cleaned.id]: 32, [aired.id]: 21, [other.id]: 32, [hydroOnly.id]: 32 },
      }),
    );
    const ticket = await getCounterRentalTicket(db, shop.id, outcome.ticketId);
    const gaps = new Map(ticket?.units.map((line) => [line.gearItemId, line.fillO2CleanGap]));
    expect(gaps.get(cleaned.id)).toBeNull();
    expect(gaps.get(aired.id)).toBeNull();
    expect(gaps.get(other.id)).toBe("never");
    expect(gaps.get(hydroOnly.id)).toBe("never");
  });

  it("follows the shop's fill method: a membrane or premix fill up to 40% records nothing", async () => {
    const { db, shop } = await rentalShop();
    await db
      .update(shops)
      .set({ nitroxFillMethod: "membrane_premix" })
      .where(eq(shops.id, shop.id));
    const diver = await nitroxDiver(db, shop.id);
    const tank = await unit(db, shop.id, "Tank #1", "tank");
    const outcome = rented(
      await lend(db, shop.id, diver.id, [tank.id], { tankFills: { [tank.id]: 40 } }),
    );
    expect((await tankLine(db, shop.id, outcome.ticketId))?.fillO2CleanGap).toBeNull();
  });

  it("never reads another shop's fill method or service record", async () => {
    const { db, shop } = await rentalShop();
    const diver = await nitroxDiver(db, shop.id);
    const tank = await unit(db, shop.id, "Tank #1", "tank");
    const otherShop = await insertShop(db, "o2-other");
    await db
      .update(shops)
      .set({ nitroxFillMethod: "membrane_premix" })
      .where(eq(shops.id, otherShop.id));
    const outcome = rented(
      await lend(db, shop.id, diver.id, [tank.id], { tankFills: { [tank.id]: 32 } }),
    );
    expect((await tankLine(db, shop.id, outcome.ticketId))?.fillO2CleanGap).toBe("never");
  });

  it("sets and clears the record when the gas is corrected", async () => {
    const { db, shop } = await rentalShop();
    const desk = await staffer(db, shop.id);
    const diver = await nitroxDiver(db, shop.id);
    const tank = await unit(db, shop.id, "Tank #1", "tank");
    const outcome = rented(
      await lend(db, shop.id, diver.id, [tank.id], { tankFills: { [tank.id]: 21 } }),
    );
    const line = await tankLine(db, shop.id, outcome.ticketId);
    expect(line?.fillO2CleanGap).toBeNull();
    const correct = (o2Percent: number) =>
      correctCounterTankFill(db, {
        shopId: shop.id,
        reservationId: line?.reservationId ?? "",
        o2Percent,
        byPersonId: desk.id,
      });
    expect(await correct(32)).toEqual({ ok: true });
    expect((await tankLine(db, shop.id, outcome.ticketId))?.fillO2CleanGap).toBe("never");
    expect(await correct(21)).toEqual({ ok: true });
    expect((await tankLine(db, shop.id, outcome.ticketId))?.fillO2CleanGap).toBeNull();
  });

  /** The rental's own stamp, put on the test's day: the fill day a correction judges by. */
  async function filledOn(db: AppDb, reservationId: string, instant: string) {
    await db
      .update(gearReservations)
      .set({ createdAt: new Date(instant) })
      .where(eq(gearReservations.id, reservationId));
  }

  it("keeps the record when the tank is cleaned after the fill and the gas then corrected (domain review 2026-11-02)", async () => {
    const { db, shop } = await rentalShop();
    const desk = await staffer(db, shop.id);
    const diver = await nitroxDiver(db, shop.id);
    const tank = await unit(db, shop.id, "Tank #1", "tank");
    const outcome = rented(
      await lend(db, shop.id, diver.id, [tank.id], { tankFills: { [tank.id]: 32 } }),
    );
    const line = await tankLine(db, shop.id, outcome.ticketId);
    expect(line?.fillO2CleanGap).toBe("never");
    // Filled on the 8th (shop time, New York); the bench cleans it on the 9th.
    await filledOn(db, line?.reservationId ?? "", "2026-10-08T15:00:00Z");
    await o2Clean(db, shop.id, tank.id, "2026-10-09", "2027-10-09");
    expect(
      await correctCounterTankFill(db, {
        shopId: shop.id,
        reservationId: line?.reservationId ?? "",
        o2Percent: 36,
        byPersonId: desk.id,
      }),
    ).toEqual({ ok: true });
    const after = await tankLine(db, shop.id, outcome.ticketId);
    expect(after?.fillO2Percent).toBe(36);
    expect(after?.fillO2CleanGap).toBe("never");
  });

  it("reads the fill day in the shop's timezone, and counts a cleaning done that day", async () => {
    const { db, shop } = await rentalShop();
    const desk = await staffer(db, shop.id);
    const diver = await nitroxDiver(db, shop.id);
    const tank = await unit(db, shop.id, "Tank #1", "tank");
    const outcome = rented(
      await lend(db, shop.id, diver.id, [tank.id], { tankFills: { [tank.id]: 21 } }),
    );
    const line = await tankLine(db, shop.id, outcome.ticketId);
    // 02:00 UTC on the 9th is still the evening of the 8th in New York.
    await filledOn(db, line?.reservationId ?? "", "2026-10-09T02:00:00Z");
    await o2Clean(db, shop.id, tank.id, "2026-10-08", "2027-10-08");
    const correct = () =>
      correctCounterTankFill(db, {
        shopId: shop.id,
        reservationId: line?.reservationId ?? "",
        o2Percent: 32,
        byPersonId: desk.id,
      });
    expect(await correct()).toEqual({ ok: true });
    expect((await tankLine(db, shop.id, outcome.ticketId))?.fillO2CleanGap).toBeNull();
    // A day earlier in shop time, the same cleaning had not happened yet.
    await filledOn(db, line?.reservationId ?? "", "2026-10-08T02:00:00Z");
    expect(await correct()).toEqual({ ok: true });
    expect((await tankLine(db, shop.id, outcome.ticketId))?.fillO2CleanGap).toBe("never");
  });

  it("refuses the record on air, and on a row with no gas", async () => {
    const { db, shop } = await rentalShop();
    const diver = await nitroxDiver(db, shop.id);
    const tank = await unit(db, shop.id, "Tank #1", "tank");
    const fins = await unit(db, shop.id, "Fins #1", "fins");
    rented(await lend(db, shop.id, diver.id, [tank.id, fins.id], { tankFills: { [tank.id]: 21 } }));
    const rows = await heldBy(db, diver.id);
    for (const row of rows) {
      await expect(
        db
          .update(gearReservations)
          .set({ fillO2CleanGap: "never" })
          .where(eq(gearReservations.id, row.id)),
      ).rejects.toThrow();
    }
  });
});
