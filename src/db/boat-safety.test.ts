import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { departureBoatSafety, departureBoatSafetyFor, todayBoatSafety } from "./boat-safety";
import { createBoat, deleteBoat, getBoatById, updateBoat } from "./boats";
import type { AppDb } from "./client";
import {
  createGearItem,
  deleteGearItem,
  recordGearService,
  setGearItemStatus,
  updateGearItem,
} from "./gear";
import { shops, trips } from "./schema";

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

const BOOKED = (booked: number) => ({ booked, boarded: 0 });

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
      passengers: BOOKED(13),
      onDate: TODAY,
    });
    expect(safety?.boatName).toBe("Check Hull");
    expect(safety?.notices).toEqual([
      { code: "over_certificate", passengers: 13, limit: 12, counted: false },
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

  it("says the O2 kit is missing when it was pulled, deleted or moved to the other hull", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Bare Hull", 14);
    const other = await createBoat(db, shop.id, "Other Bare Hull", 14);
    const o2 = await kit(db, shop.id, { kind: "o2_kit", label: "O2 bare", aboardBoatId: boat.id });
    const read = async () =>
      (
        await departureBoatSafety(db, shop.id, {
          boatId: boat.id,
          passengers: BOOKED(2),
          onDate: TODAY,
        })
      )?.notices.filter((notice) => notice.code === "kit_missing");

    expect(await read()).toEqual([]);

    // Flagged for service: the register cannot say it is still aboard.
    await setGearItemStatus(db, { shopId: shop.id, gearItemId: o2.id, status: "needs_service" });
    expect(await read()).toEqual([{ code: "kit_missing", kind: "o2_kit" }]);
    await setGearItemStatus(db, { shopId: shop.id, gearItemId: o2.id, status: "in_service" });

    // Moved to the other hull.
    await updateGearItem(db, {
      shopId: shop.id,
      gearItemId: o2.id,
      kind: "o2_kit",
      label: "O2 bare",
      aboardBoatId: other.id,
    });
    expect(await read()).toEqual([{ code: "kit_missing", kind: "o2_kit" }]);

    // Deleted, with another O2 kit still on the shelf: the shop keeps one, so
    // this hull is still short.
    await kit(db, shop.id, { kind: "o2_kit", label: "O2 shelf" });
    await deleteGearItem(db, { shopId: shop.id, gearItemId: o2.id, todayLocal: TODAY });
    expect(await read()).toEqual([{ code: "kit_missing", kind: "o2_kit" }]);
  });

  it("asks for no AED from a shop that has never registered one", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Plain Hull", 14);
    const safety = await departureBoatSafety(db, shop.id, {
      boatId: boat.id,
      passengers: BOOKED(2),
      onDate: TODAY,
    });
    expect(safety?.notices.some((notice) => notice.code === "kit_missing")).toBe(false);
  });

  it("names kit flagged for service", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Bench Hull", 14);
    const o2 = await kit(db, shop.id, { kind: "o2_kit", label: "O2 bench", aboardBoatId: boat.id });
    await setGearItemStatus(db, { shopId: shop.id, gearItemId: o2.id, status: "needs_service" });
    const safety = await departureBoatSafety(db, shop.id, {
      boatId: boat.id,
      passengers: BOOKED(2),
      onDate: TODAY,
    });
    expect(safety?.notices).toEqual([
      { code: "kit_missing", kind: "o2_kit" },
      { code: "kit_off_service", gearItemId: o2.id, label: "O2 bench", kind: "o2_kit" },
    ]);
  });

  it("has nothing to say about a departure with no boat, or another shop's boat", async () => {
    const { db, shop } = ctx;
    expect(
      await departureBoatSafety(db, shop.id, {
        boatId: null,
        passengers: BOOKED(4),
        onDate: TODAY,
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
        passengers: BOOKED(4),
        onDate: TODAY,
      }),
    ).toBeNull();
  });
});

describe("todayBoatSafety", () => {
  it("raises a departure's missing and lapsing life-safety kit, and leaves the rest as errands", async () => {
    const { db, shop } = ctx;
    const sailing = await createBoat(db, shop.id, "Sailing Hull", 14, null, {
      ...PAPERS_CLEAR,
      registrationExpiresOn: "2026-10-01",
      inspectionDueOn: "2026-12-20",
    });
    const moored = await createBoat(db, shop.id, "Moored Hull", 14);
    const flares = await kit(db, shop.id, {
      kind: "flares",
      label: "Flares sailing",
      aboardBoatId: sailing.id,
    });
    await clock(db, shop.id, flares.id, "expiry", "2026-10-06");
    // A first-aid kit aboard is the owner's errand, not the departure's row.
    const firstAid = await kit(db, shop.id, {
      kind: "first_aid_kit",
      label: "First aid sailing",
      aboardBoatId: sailing.id,
    });
    await clock(db, shop.id, firstAid.id, "expiry", "2026-10-08");
    // The AED is on the boat that is not sailing today: the sailing one lacks it.
    const aed = await kit(db, shop.id, {
      kind: "aed",
      label: "AED moored",
      aboardBoatId: moored.id,
    });
    await clock(db, shop.id, aed.id, "aed_pads", "2026-10-01");

    const { departures, errands } = await todayBoatSafety(db, shop.id, {
      todayLocal: TODAY,
      departures: [{ tripId: "trip-today", boatId: sailing.id }],
    });
    expect(departures).toEqual([
      {
        tripId: "trip-today",
        boatId: sailing.id,
        boatName: "Sailing Hull",
        notices: [
          { code: "kit_missing", kind: "aed" },
          expect.objectContaining({ code: "kit_clock", label: "Flares sailing", expired: true }),
        ],
      },
    ]);
    // The papers: a lapsed registration escalates, and the inspection 72 days
    // out is inside its 90-day window.
    expect(errands).toContainEqual({
      subject: "boat",
      boatId: sailing.id,
      name: "Sailing Hull",
      expired: true,
      notices: [
        expect.objectContaining({ paper: "registration", expired: true }),
        expect.objectContaining({ paper: "inspection", expired: false, days: 72 }),
      ],
    });
    const kitErrands = errands.flatMap((row) => (row.subject === "kit" ? [row.label] : []));
    // The flares are on the departure row; the first-aid kit and the AED on
    // the boat staying home are the owner's.
    expect(kitErrands.sort()).toEqual(["AED moored", "First aid sailing"]);
  });

  it("raises a paper that is only due as an errand that has not lapsed", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Due Hull", 14, null, {
      ...PAPERS_CLEAR,
      insuranceExpiresOn: "2026-11-30",
    });
    const { errands } = await todayBoatSafety(db, shop.id, { todayLocal: TODAY, departures: [] });
    expect(errands).toContainEqual(
      expect.objectContaining({ subject: "boat", boatId: boat.id, expired: false }),
    );
  });

  it("forgets a boat the shop deleted", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Sold Hull", 14, null, {
      ...PAPERS_CLEAR,
      insuranceExpiresOn: "2026-09-01",
    });
    await deleteBoat(db, shop.id, boat.id);
    const { departures, errands } = await todayBoatSafety(db, shop.id, {
      todayLocal: TODAY,
      departures: [{ tripId: "trip-sold", boatId: boat.id }],
    });
    expect(departures).toEqual([]);
    expect(errands.some((row) => row.subject === "boat" && row.boatId === boat.id)).toBe(false);
  });
});

describe("departureBoatSafetyFor", () => {
  const ZONE = "America/New_York";
  const NOW = new Date("2026-10-09T13:30:00Z");

  async function departure(db: AppDb, shopId: string, boatId: string, startsAt: string) {
    const [trip] = await db
      .insert(trips)
      .values({
        shopId,
        boatId,
        title: `Hull check ${startsAt}`,
        startsAt: new Date(startsAt),
        endsAt: new Date(new Date(startsAt).getTime() + 4 * 3_600_000),
        capacity: 10,
      })
      .returning();
    if (!trip) throw new Error("trip insert failed");
    return trip;
  }

  it("judges next week's boat by next week's date, and says nothing for one that has sailed", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Dated Hull", 14);
    const aed = await kit(db, shop.id, { kind: "aed", label: "AED dated", aboardBoatId: boat.id });
    // In date today, lapsed by the 20th.
    await clock(db, shop.id, aed.id, "aed_pads", "2026-10-15");
    const read = async (startsAt: string) => {
      const trip = await departure(db, shop.id, boat.id, startsAt);
      return departureBoatSafetyFor(db, shop.id, {
        tripId: trip.id,
        startsAt: trip.startsAt,
        timeZone: ZONE,
        now: NOW,
        passengers: { booked: 2, boarded: 0 },
      });
    };

    expect((await read("2026-10-09T18:00:00Z"))?.notices).toEqual([
      expect.objectContaining({ code: "kit_clock", expired: false, days: 6 }),
    ]);
    expect((await read("2026-10-20T12:00:00Z"))?.notices).toEqual([
      expect.objectContaining({ code: "kit_clock", expired: true, days: 5 }),
    ]);
    expect(await read("2026-10-08T12:00:00Z")).toBeNull();
  });
});
