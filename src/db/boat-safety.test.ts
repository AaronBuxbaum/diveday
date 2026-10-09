import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { departureBoatSafety, listExpiredBoatSafety } from "./boat-safety";
import { createBoat, deleteBoat, getBoatById, updateBoat } from "./boats";
import type { AppDb } from "./client";
import {
  createGearItem,
  deleteGearItem,
  recordGearService,
  setGearItemStatus,
  updateGearItem,
} from "./gear";
import { shops } from "./schema";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

const TODAY = "2026-10-09";
const PAPERS_CLEAR = {
  certifiedPassengers: null,
  inspectionDueOn: null,
  registrationExpiresOn: null,
  insuranceExpiresOn: null,
};

async function kit(
  db: AppDb,
  shopId: string,
  input: {
    kind: "aed" | "flares" | "o2_kit" | "first_aid_kit" | "bcd";
    label: string;
    aboardBoatId?: string | null;
  },
) {
  const outcome = await createGearItem(db, { shopId, ...input });
  if (!outcome.ok) throw new Error(`createGearItem: ${outcome.reason}`);
  return outcome.item;
}

async function clock(
  db: AppDb,
  shopId: string,
  gearItemId: string,
  kind: "aed_pads" | "aed_battery" | "expiry" | "service",
  nextDueOn: string,
) {
  const outcome = await recordGearService(db, {
    shopId,
    gearItemId,
    kind,
    servicedOn: "2024-01-01",
    nextDueOn,
  });
  if (!outcome.ok) throw new Error(`recordGearService: ${outcome.reason}`);
}

async function otherShop(db: AppDb) {
  const [other] = await db
    .insert(shops)
    .values({ name: "Other Reef", slug: "other-reef-boat-safety", timezone: "America/New_York" })
    .returning();
  if (!other) throw new Error("other shop insert failed");
  return other;
}

describe("boat papers", () => {
  it("round-trips the certificate and the three paper dates", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Paper Hull", 12, null, {
      certifiedPassengers: 14,
      inspectionDueOn: "2027-03-01",
      registrationExpiresOn: "2027-01-31",
      insuranceExpiresOn: null,
    });
    expect(boat).toMatchObject({ certifiedPassengers: 14, inspectionDueOn: "2027-03-01" });

    await updateBoat(db, shop.id, boat.id, "Paper Hull", 12, null, {
      ...PAPERS_CLEAR,
      insuranceExpiresOn: "2026-12-31",
    });
    expect(await getBoatById(db, shop.id, boat.id)).toMatchObject({
      certifiedPassengers: null,
      inspectionDueOn: null,
      insuranceExpiresOn: "2026-12-31",
    });
  });

  it("leaves the papers alone when an edit does not carry them", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Kept Papers", 12, null, {
      ...PAPERS_CLEAR,
      certifiedPassengers: 10,
    });
    await updateBoat(db, shop.id, boat.id, "Kept Papers II", 12);
    expect((await getBoatById(db, shop.id, boat.id))?.certifiedPassengers).toBe(10);
  });

  it("refuses a certificate that allows nobody aboard", async () => {
    const { db, shop } = ctx;
    await expect(
      createBoat(db, shop.id, "Zero Hull", 6, null, { ...PAPERS_CLEAR, certifiedPassengers: 0 }),
    ).rejects.toThrow();
  });
});

describe("aboard a boat", () => {
  it("hangs safety kit on one of this shop's live boats", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Kit Hull", 12);
    const aed = await kit(db, shop.id, {
      kind: "aed",
      label: "AED kit hull",
      aboardBoatId: boat.id,
    });
    expect(aed.aboardBoatId).toBe(boat.id);
  });

  it("refuses another shop's boat, and a deleted one", async () => {
    const { db, shop } = ctx;
    const other = await otherShop(db);
    const theirs = await createBoat(db, other.id, "Their Hull", 12);
    const gone = await createBoat(db, shop.id, "Gone Hull", 12);
    await deleteBoat(db, shop.id, gone.id);
    for (const boatId of [theirs.id, gone.id]) {
      expect(
        await createGearItem(db, {
          shopId: shop.id,
          kind: "aed",
          label: `AED ${boatId}`,
          aboardBoatId: boatId,
        }),
      ).toEqual({ ok: false, reason: "invalid_boat" });
    }
  });

  it("never puts rental gear aboard, and clears a unit that stops being safety kit", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Rental Hull", 12);
    const bcd = await kit(db, shop.id, {
      kind: "bcd",
      label: "BCD aboard?",
      aboardBoatId: boat.id,
    });
    expect(bcd.aboardBoatId).toBeNull();

    const o2 = await kit(db, shop.id, {
      kind: "o2_kit",
      label: "O2 relabelled",
      aboardBoatId: boat.id,
    });
    const edited = await updateGearItem(db, {
      shopId: shop.id,
      gearItemId: o2.id,
      kind: "other",
      label: "O2 relabelled",
      aboardBoatId: boat.id,
    });
    expect(edited.ok && edited.item.aboardBoatId).toBeNull();
  });

  it("keeps the hull when an edit does not say", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Steady Hull", 12);
    const aed = await kit(db, shop.id, { kind: "aed", label: "AED steady", aboardBoatId: boat.id });
    const edited = await updateGearItem(db, {
      shopId: shop.id,
      gearItemId: aed.id,
      kind: "aed",
      label: "AED steady (bow)",
    });
    expect(edited.ok && edited.item.aboardBoatId).toBe(boat.id);

    const ashore = await updateGearItem(db, {
      shopId: shop.id,
      gearItemId: aed.id,
      kind: "aed",
      label: "AED steady (bow)",
      aboardBoatId: null,
    });
    expect(ashore.ok && ashore.item.aboardBoatId).toBeNull();
  });
});

describe("departureBoatSafety", () => {
  it("speaks for this hull's kit and papers, and nobody else's", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Check Hull", 14, null, {
      ...PAPERS_CLEAR,
      certifiedPassengers: 12,
      insuranceExpiresOn: "2026-10-30",
    });
    const elsewhere = await createBoat(db, shop.id, "Other Hull", 14);
    const aed = await kit(db, shop.id, { kind: "aed", label: "AED check", aboardBoatId: boat.id });
    await clock(db, shop.id, aed.id, "aed_pads", "2026-10-21");
    const flares = await kit(db, shop.id, {
      kind: "flares",
      label: "Flares check",
      aboardBoatId: boat.id,
    });
    await clock(db, shop.id, flares.id, "expiry", "2026-10-06");
    // The same dead pads, on another hull and on the shelf: neither is this boat's.
    for (const aboardBoatId of [elsewhere.id, null]) {
      const stray = await kit(db, shop.id, {
        kind: "aed",
        label: `AED stray ${aboardBoatId}`,
        aboardBoatId,
      });
      await clock(db, shop.id, stray.id, "aed_pads", "2026-10-01");
    }
    // A deleted unit stops speaking.
    const binned = await kit(db, shop.id, {
      kind: "flares",
      label: "Flares binned",
      aboardBoatId: boat.id,
    });
    await clock(db, shop.id, binned.id, "expiry", "2026-10-01");
    const deleted = await deleteGearItem(db, {
      shopId: shop.id,
      gearItemId: binned.id,
      todayLocal: TODAY,
    });
    expect(deleted.ok).toBe(true);

    const safety = await departureBoatSafety(db, shop.id, {
      boatId: boat.id,
      passengersAboard: 13,
      todayLocal: TODAY,
    });
    expect(safety?.boatName).toBe("Check Hull");
    expect(safety?.notices).toEqual([
      { code: "over_certificate", aboard: 13, limit: 12 },
      expect.objectContaining({ code: "kit_clock", label: "Flares check", expired: true, days: 3 }),
      expect.objectContaining({
        code: "kit_clock",
        label: "AED check",
        clock: "aed_pads",
        days: 12,
      }),
      expect.objectContaining({ code: "paper", paper: "insurance", expired: false, days: 21 }),
    ]);
  });

  it("names kit pulled to the bench", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Bench Hull", 14);
    const o2 = await kit(db, shop.id, { kind: "o2_kit", label: "O2 bench", aboardBoatId: boat.id });
    await setGearItemStatus(db, { shopId: shop.id, gearItemId: o2.id, status: "needs_service" });
    const safety = await departureBoatSafety(db, shop.id, {
      boatId: boat.id,
      passengersAboard: 2,
      todayLocal: TODAY,
    });
    expect(safety?.notices).toEqual([
      { code: "kit_off_service", gearItemId: o2.id, label: "O2 bench" },
    ]);
  });

  it("has nothing to say about a departure with no boat, or another shop's boat", async () => {
    const { db, shop } = ctx;
    expect(
      await departureBoatSafety(db, shop.id, {
        boatId: null,
        passengersAboard: 4,
        todayLocal: TODAY,
      }),
    ).toBeNull();
    const other = await otherShop(db);
    const theirs = await createBoat(db, other.id, "Their Check Hull", 6, null, {
      ...PAPERS_CLEAR,
      certifiedPassengers: 1,
    });
    expect(
      await departureBoatSafety(db, shop.id, {
        boatId: theirs.id,
        passengersAboard: 4,
        todayLocal: TODAY,
      }),
    ).toBeNull();
  });
});

describe("listExpiredBoatSafety", () => {
  it("lists what has run out, aboard or ashore, and not what is merely due", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Expired Hull", 14, null, {
      ...PAPERS_CLEAR,
      registrationExpiresOn: "2026-10-01",
      inspectionDueOn: "2026-10-20",
    });
    const shelf = await kit(db, shop.id, { kind: "first_aid_kit", label: "First aid shelf" });
    await clock(db, shop.id, shelf.id, "expiry", "2026-10-08");
    const soon = await kit(db, shop.id, { kind: "aed", label: "AED soon", aboardBoatId: boat.id });
    await clock(db, shop.id, soon.id, "aed_pads", "2026-10-21");

    const rows = await listExpiredBoatSafety(db, shop.id, TODAY);
    expect(rows).toContainEqual({
      subject: "boat",
      boatId: boat.id,
      name: "Expired Hull",
      notices: [
        { code: "paper", paper: "registration", dueOn: "2026-10-01", expired: true, days: 8 },
      ],
    });
    expect(rows).toContainEqual(
      expect.objectContaining({ subject: "kit", gearItemId: shelf.id, label: "First aid shelf" }),
    );
    expect(rows.some((row) => row.subject === "kit" && row.gearItemId === soon.id)).toBe(false);
  });

  it("forgets a boat the shop deleted", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Sold Hull", 14, null, {
      ...PAPERS_CLEAR,
      insuranceExpiresOn: "2026-09-01",
    });
    await deleteBoat(db, shop.id, boat.id);
    const rows = await listExpiredBoatSafety(db, shop.id, TODAY);
    expect(rows.some((row) => row.subject === "boat" && row.boatId === boat.id)).toBe(false);
  });
});
