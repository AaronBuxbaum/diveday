import { describe, expect, it } from "vitest";
import type { AppDb } from "./client";
import { getCounterRentalTicket } from "./gear-counter-rentals";
import {
  heldBy,
  insertShop,
  lend,
  person,
  rentalShop,
  rented,
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

  it("leaves a fill nobody recorded blank", async () => {
    const { db, shop } = await rentalShop();
    const diver = await person(db, shop.id, "Blank Bo");
    const tank = await unit(db, shop.id, "Tank #1", "tank");
    const outcome = rented(await lend(db, shop.id, diver.id, [tank.id]));
    const ticket = await getCounterRentalTicket(db, shop.id, outcome.ticketId);
    expect(ticket?.units.map((u) => u.fillO2Percent)).toEqual([null]);
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
