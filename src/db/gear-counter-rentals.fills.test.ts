import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { AppDb } from "./client";
import {
  checkOutCounterRental,
  correctCounterTankFill,
  counterRentalHasNitroxFillCard,
  getCounterRentalTicket,
  returnCounterRental,
} from "./gear-counter-rentals";
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
import { nitroxCertifications } from "./schema";

/**
 * **The gas in a counter-rented tank** (issue #2257, Aaron 2026-10-13).
 * Safety-critical: EANx goes across the counter only to a person whose nitrox
 * card authorizes a fill (`authorizesNitroxFill`), and every refusal writes
 * nothing.
 */

async function nitroxCard(
  db: AppDb,
  shopId: string,
  personId: string,
  overrides: Partial<typeof nitroxCertifications.$inferInsert> = {},
) {
  await db.insert(nitroxCertifications).values({
    shopId,
    personId,
    agency: "padi",
    identifier: `EAN-${personId.slice(0, 8)}`,
    status: "verified",
    ...overrides,
  });
}

describe("counter tank fills", () => {
  it("refuses EANx without writes when the card is revoked after the picker was loaded", async () => {
    const { db, shop } = await rentalShop();
    const diver = await person(db, shop.id, "Revoked Rowan");
    await nitroxCard(db, shop.id, diver.id);
    expect(await counterRentalHasNitroxFillCard(db, shop.id, diver.id)).toBe(true);
    await db
      .update(nitroxCertifications)
      .set({ deletedAt: new Date("2026-10-02T00:00:00Z") })
      .where(eq(nitroxCertifications.personId, diver.id));
    const tank = await unit(db, shop.id, "Tank #1", "tank");
    expect(await lend(db, shop.id, diver.id, [tank.id], { tankFills: { [tank.id]: 32 } })).toEqual({
      ok: false,
      reason: "no_nitrox_card",
    });
    expect(await heldBy(db, diver.id)).toEqual([]);
  });
  it("reads the selected person's fill-authorizing card within the shop", async () => {
    const { db, shop } = await rentalShop();
    const diver = await person(db, shop.id, "Picker Pat");
    const other = await person(db, shop.id, "Other Olly");
    const otherShop = await insertShop(db, "picker-other-shop");
    expect(await counterRentalHasNitroxFillCard(db, shop.id, diver.id)).toBe(false);
    await nitroxCard(db, shop.id, diver.id, { status: "pending" });
    expect(await counterRentalHasNitroxFillCard(db, shop.id, diver.id)).toBe(false);
    await nitroxCard(db, shop.id, diver.id, {
      identifier: "imported",
      importedAt: new Date("2026-10-01T00:00:00Z"),
    });
    expect(await counterRentalHasNitroxFillCard(db, shop.id, diver.id)).toBe(false);
    await nitroxCard(db, shop.id, diver.id, {
      identifier: "deleted",
      deletedAt: new Date("2026-10-02T00:00:00Z"),
    });
    expect(await counterRentalHasNitroxFillCard(db, shop.id, diver.id)).toBe(false);
    await nitroxCard(db, shop.id, diver.id, {
      identifier: "confirmed",
      importedAt: new Date("2026-10-01T00:00:00Z"),
      reviewedAt: new Date("2026-10-02T00:00:00Z"),
    });
    expect(await counterRentalHasNitroxFillCard(db, shop.id, diver.id)).toBe(true);
    expect(await counterRentalHasNitroxFillCard(db, shop.id, other.id)).toBe(false);
    expect(await counterRentalHasNitroxFillCard(db, otherShop.id, diver.id)).toBe(false);
  });
  it("records air on a tank for anyone the card rule already lets have one", async () => {
    const { db, shop } = await rentalShop();
    const diver = await person(db, shop.id, "Air Ana");
    const tank = await unit(db, shop.id, "Tank #1", "tank");
    const outcome = rented(
      await lend(db, shop.id, diver.id, [tank.id], { tankFills: { [tank.id]: 21 } }),
    );
    const ticket = await getCounterRentalTicket(db, shop.id, outcome.ticketId);
    expect(ticket?.units.map((u) => u.fillO2Percent)).toEqual([21]);
  });

  it("refuses a tank with no gas recorded, and writes nothing (domain review F1)", async () => {
    // A blank gas used to rent the tank with nothing recorded, which is the
    // door an EANx fill walks through without meeting the card check.
    const { db, shop } = await rentalShop();
    const diver = await person(db, shop.id, "Blank Bo");
    const tank = await unit(db, shop.id, "Tank #1", "tank");
    const fins = await unit(db, shop.id, "Fins #1", "fins");
    expect(await lend(db, shop.id, diver.id, [tank.id, fins.id])).toEqual({
      ok: false,
      reason: "fill_missing",
    });
    expect(await heldBy(db, diver.id)).toEqual([]);
  });

  it("says who recorded the gas and when (domain review A3)", async () => {
    const { db, shop } = await rentalShop();
    const desk = await staffer(db, shop.id);
    const diver = await person(db, shop.id, "Recorded Rae");
    const tank = await unit(db, shop.id, "Tank #1", "tank");
    const outcome = rented(
      await lend(db, shop.id, diver.id, [tank.id], {
        tankFills: { [tank.id]: 21 },
        fillRecordedByPersonId: desk.id,
      }),
    );
    const [tankLine] = (await getCounterRentalTicket(db, shop.id, outcome.ticketId))?.units ?? [];
    expect(tankLine?.fillRecordedByName).toBe("Dana Desk");
    expect(tankLine?.fillRecordedAt).toBeInstanceOf(Date);
  });

  it("records EANx for a person with a verified nitrox card", async () => {
    const { db, shop } = await rentalShop();
    const diver = await person(db, shop.id, "Nitrox Nia");
    await nitroxCard(db, shop.id, diver.id);
    const tank = await unit(db, shop.id, "Tank #1", "tank");
    const outcome = rented(
      await lend(db, shop.id, diver.id, [tank.id], { tankFills: { [tank.id]: 32 } }),
    );
    const ticket = await getCounterRentalTicket(db, shop.id, outcome.ticketId);
    expect(ticket?.units.map((u) => u.fillO2Percent)).toEqual([32]);
  });

  it("refuses EANx with no nitrox card, and writes nothing", async () => {
    const { db, shop } = await rentalShop();
    const diver = await person(db, shop.id, "No Card Ned");
    const tank = await unit(db, shop.id, "Tank #1", "tank");
    const reg = await unit(db, shop.id, "Reg #1", "regulator");
    expect(
      await lend(db, shop.id, diver.id, [tank.id, reg.id], { tankFills: { [tank.id]: 32 } }),
    ).toEqual({ ok: false, reason: "no_nitrox_card" });
    expect(await heldBy(db, diver.id)).toEqual([]);
  });

  it.each([
    ["pending", { status: "pending" as const }],
    ["deleted", { deletedAt: new Date("2026-10-01T00:00:00Z") }],
    ["an unconfirmed import", { importedAt: new Date("2026-10-01T00:00:00Z") }],
  ])("refuses EANx when the only nitrox card is %s", async (_label, overrides) => {
    const { db, shop } = await rentalShop();
    const diver = await person(db, shop.id, "Weak Card Wes");
    await nitroxCard(db, shop.id, diver.id, overrides);
    const tank = await unit(db, shop.id, "Tank #1", "tank");
    expect(await lend(db, shop.id, diver.id, [tank.id], { tankFills: { [tank.id]: 22 } })).toEqual({
      ok: false,
      reason: "no_nitrox_card",
    });
    expect(await heldBy(db, diver.id)).toEqual([]);
  });

  it("accepts a confirmed import, as the trip gate does", async () => {
    const { db, shop } = await rentalShop();
    const diver = await person(db, shop.id, "Confirmed Cy");
    await nitroxCard(db, shop.id, diver.id, {
      importedAt: new Date("2026-10-01T00:00:00Z"),
      reviewedAt: new Date("2026-10-02T00:00:00Z"),
    });
    const tank = await unit(db, shop.id, "Tank #1", "tank");
    rented(await lend(db, shop.id, diver.id, [tank.id], { tankFills: { [tank.id]: 36 } }));
  });

  it("refuses another shop's nitrox card", async () => {
    const { db, shop } = await rentalShop();
    const other = await insertShop(db, "other-counter");
    const diver = await person(db, shop.id, "Elsewhere Eli");
    await nitroxCard(db, other.id, diver.id);
    const tank = await unit(db, shop.id, "Tank #1", "tank");
    expect(await lend(db, shop.id, diver.id, [tank.id], { tankFills: { [tank.id]: 32 } })).toEqual({
      ok: false,
      reason: "no_nitrox_card",
    });
  });

  it("refuses a fill on anything but a tank, and one for a unit not on the rental", async () => {
    const { db, shop } = await rentalShop();
    const diver = await person(db, shop.id, "Shape Sam");
    const tank = await unit(db, shop.id, "Tank #1", "tank");
    const reg = await unit(db, shop.id, "Reg #1", "regulator");
    const stray = await unit(db, shop.id, "Tank #2", "tank");
    expect(
      await lend(db, shop.id, diver.id, [tank.id, reg.id], { tankFills: { [reg.id]: 21 } }),
    ).toEqual({ ok: false, reason: "fill_not_tank" });
    expect(await lend(db, shop.id, diver.id, [tank.id], { tankFills: { [stray.id]: 21 } })).toEqual(
      { ok: false, reason: "fill_invalid" },
    );
    expect(await heldBy(db, diver.id)).toEqual([]);
  });

  it.each([20, 41, 100, 0, -21, 32.5, Number.NaN])(
    "refuses an out-of-range fill of %s even with a card",
    async (o2) => {
      const { db, shop } = await rentalShop();
      const diver = await person(db, shop.id, "Range Rae");
      await nitroxCard(db, shop.id, diver.id);
      const tank = await unit(db, shop.id, "Tank #1", "tank");
      expect(
        await lend(db, shop.id, diver.id, [tank.id], { tankFills: { [tank.id]: o2 } }),
      ).toEqual({ ok: false, reason: "fill_invalid" });
      expect(await heldBy(db, diver.id)).toEqual([]);
    },
  );
});

/**
 * **Correcting the gas** (domain reviews A3/F6, security review X5): a staffer
 * who wrote the wrong gas puts the right one on the ticket, through the same
 * card gate, recorded as theirs. Never once the tank is home.
 */
describe("correcting a counter tank's gas", () => {
  async function airTank() {
    const { db, shop } = await rentalShop();
    const desk = await staffer(db, shop.id);
    const diver = await person(db, shop.id, "Fix Finn");
    const tank = await unit(db, shop.id, "Tank #1", "tank");
    const fins = await unit(db, shop.id, "Fins #1", "fins");
    const outcome = rented(
      await lend(db, shop.id, diver.id, [tank.id, fins.id], { tankFills: { [tank.id]: 21 } }),
    );
    const ticket = await getCounterRentalTicket(db, shop.id, outcome.ticketId);
    const tankRow = ticket?.units.find((u) => u.kind === "tank");
    const finsRow = ticket?.units.find((u) => u.kind === "fins");
    if (!tankRow || !finsRow) throw new Error("rental rows missing");
    return { db, shop, desk, diver, outcome, tankRow, finsRow };
  }

  it("refuses EANx with no nitrox card, and leaves the air standing", async () => {
    const { db, shop, desk, outcome, tankRow } = await airTank();
    expect(
      await correctCounterTankFill(db, {
        shopId: shop.id,
        reservationId: tankRow.reservationId,
        o2Percent: 32,
        byPersonId: desk.id,
      }),
    ).toEqual({ ok: false, reason: "no_nitrox_card" });
    const after = await getCounterRentalTicket(db, shop.id, outcome.ticketId);
    expect(after?.units.find((u) => u.kind === "tank")?.fillO2Percent).toBe(21);
  });

  it("puts EANx on the ticket for a carded diver, as the corrector's record", async () => {
    const { db, shop, desk, diver, outcome, tankRow } = await airTank();
    await nitroxCard(db, shop.id, diver.id);
    expect(
      await correctCounterTankFill(db, {
        shopId: shop.id,
        reservationId: tankRow.reservationId,
        o2Percent: 32,
        byPersonId: desk.id,
      }),
    ).toEqual({ ok: true });
    const after = await getCounterRentalTicket(db, shop.id, outcome.ticketId);
    const line = after?.units.find((u) => u.kind === "tank");
    expect(line?.fillO2Percent).toBe(32);
    expect(line?.fillRecordedByName).toBe("Dana Desk");
  });

  it("refuses an out-of-range gas, a non-tank, another shop, and a tank already home", async () => {
    const { db, shop, desk, outcome, tankRow, finsRow } = await airTank();
    const correct = (reservationId: string, o2Percent: number, shopId = shop.id) =>
      correctCounterTankFill(db, { shopId, reservationId, o2Percent, byPersonId: desk.id });
    expect(await correct(tankRow.reservationId, 41)).toEqual({ ok: false, reason: "fill_invalid" });
    expect(await correct(finsRow.reservationId, 21)).toEqual({
      ok: false,
      reason: "fill_not_tank",
    });
    const other = await insertShop(db, "other-fix");
    expect(await correct(tankRow.reservationId, 21, other.id)).toEqual({
      ok: false,
      reason: "not_found",
    });
    await checkOutCounterRental(db, { shopId: shop.id, ticketId: outcome.ticketId });
    await returnCounterRental(db, {
      shopId: shop.id,
      ticketId: outcome.ticketId,
      outcome: "all_good",
    });
    expect(await correct(tankRow.reservationId, 22)).toEqual({ ok: false, reason: "not_found" });
  });
});
