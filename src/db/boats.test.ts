import { and, asc, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  countBoatsWithoutRadioIdentity,
  countDeparturesByBoat,
  createBoat,
  deleteBoat,
  departureVessels,
  getBoatById,
  getBoatForHistory,
  listBoats,
  replaceBoatPhoto,
  updateBoat,
  updateBoatWithinCertificate,
} from "./boats";
import { trips } from "./schema";
import { setShopDivingOptions } from "./shops";
import { createTrip } from "./trips-create";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

describe("boats database operations", () => {
  it("updates only its own live boat and refuses a stale photo replacement", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Photo boat", 10);
    const url = "https://diveday-media.s3.us-east-1.amazonaws.com/shop-heroes/boat.jpg";
    expect(await replaceBoatPhoto(db, shop.id, boat.id, null, url)).toBe(true);
    expect(await replaceBoatPhoto(db, shop.id, boat.id, null, null)).toBe(false);
    expect((await getBoatById(db, shop.id, boat.id))?.photoUrl).toBe(url);
    expect(
      await replaceBoatPhoto(db, "00000000-0000-0000-0000-000000000000", boat.id, url, null),
    ).toBe(false);
    expect(await replaceBoatPhoto(db, shop.id, boat.id, url, null)).toBe(true);
    expect((await getBoatById(db, shop.id, boat.id))?.photoUrl).toBeNull();
  });
  it("creates, retrieves, updates, and lists boats for a shop", async () => {
    const { db, shop } = ctx;

    const initialBoats = await listBoats(db, shop.id);
    expect(initialBoats.length).toBe(2);

    const boat = await createBoat(db, shop.id, "Sea Explorer", 18);
    expect(boat.name).toBe("Sea Explorer");
    expect(boat.capacity).toBe(18);
    expect(boat.shopId).toBe(shop.id);

    const retrieved = await getBoatById(db, shop.id, boat.id);
    expect(retrieved?.id).toBe(boat.id);
    expect(retrieved?.name).toBe("Sea Explorer");

    const updated = await updateBoat(db, shop.id, boat.id, "Sea Explorer II", 24);
    expect(updated?.name).toBe("Sea Explorer II");
    expect(updated?.capacity).toBe(24);

    const allBoats = await listBoats(db, shop.id);
    expect(allBoats.length).toBe(3);
    expect(allBoats.some((b) => b.name === "Sea Explorer II")).toBe(true);
  });

  /**
   * This used to assert the opposite — that the departure's `boat_id` went
   * `null` — because `deleteBoat` was a real delete and `trips.boat_id` is
   * `onDelete: "set null"`. That behaviour was the bug, not the contract: it
   * erased which vessel sailed on every past departure the hull had carried
   * (issue #680). The assertion is inverted deliberately.
   */
  it("deletes a boat and leaves the departures it carried naming it", async () => {
    const { db, shop } = ctx;

    const boat = await createBoat(db, shop.id, "Wave Runner", 12);

    const now = new Date("2026-08-17T09:00:00Z");
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Morning Reef Dive",
      startsAt: now,
      endsAt: new Date(now.getTime() + 4 * 3600 * 1000),
      capacity: 12,
      plannedDives: 2,
      priceCents: 10000,
      diveMode: "boat",
      boatId: boat.id,
    });
    expect(trip).not.toBeNull();
    if (!trip) throw new Error("trip creation failed");

    expect(trip.boatId).toBe(boat.id);
    expect(trip.diveMode).toBe("boat");

    const deleted = await deleteBoat(db, shop.id, boat.id);
    expect(deleted).toBe(true);

    const [refreshedTrip] = await db.select().from(trips).where(eq(trips.id, trip.id));
    expect(refreshedTrip.boatId).toBe(boat.id);
    // And the hull is off the fleet the shop has, which is what the staffer asked for.
    expect((await listBoats(db, shop.id)).some((b) => b.id === boat.id)).toBe(false);
  });

  it("updates shop diving options flags (shore and pool diving)", async () => {
    const { db, shop } = ctx;

    expect(shop.hasShoreDiving).toBe(true);
    expect(shop.hasPoolDiving).toBe(true);

    const updated = await setShopDivingOptions(db, shop.id, {
      hasBoatDiving: true,
      hasShoreDiving: false,
      hasPoolDiving: false,
    });

    expect(updated?.hasShoreDiving).toBe(false);
    expect(updated?.hasPoolDiving).toBe(false);
  });
});

/**
 * **Deleting a hull must not erase which vessel sailed** (issue #680).
 *
 * `deleteBoat` was a real `db.delete()`, and `trips.boat_id` is
 * `onDelete: "set null"` — so it did not fail loudly the way a foreign key
 * normally would. It quietly rewrote every past departure that used the boat to
 * say no vessel was ever recorded: this season's, last season's, and the one an
 * insurer or a coast-guard inquiry asks about first. Nothing warned, nothing
 * counted, nothing could undo it.
 *
 * This is the exact shape ADR 20260820-every-delete-is-soft rules out, and that
 * ADR is explicit the rule is a default for any table holding something a user
 * can delete — not a list of blessed tables.
 */
describe("deleting a boat", () => {
  it("stamps the hull instead of removing it", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Reef Runner", 6);

    expect(await deleteBoat(db, shop.id, boat.id)).toBe(true);

    // Gone from the fleet the shop has...
    expect((await listBoats(db, shop.id)).map((b) => b.id)).not.toContain(boat.id);
    expect(await getBoatById(db, shop.id, boat.id)).toBeNull();
    // ...and still on file, which is the whole point.
    const kept = await getBoatForHistory(db, shop.id, boat.id);
    expect(kept?.name).toBe("Reef Runner");
    expect(kept?.deletedAt).toBeInstanceOf(Date);
  });

  it("still names the vessel a past departure sailed on", async () => {
    // The failure this change exists for. Before, the trip's `boat_id` went
    // null and the manifest, the log and the close-out all read as though no
    // boat had ever been recorded.
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Blue Horizon", 12);
    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .limit(1);
    if (!trip) throw new Error("expected a seeded departure");
    await db.update(trips).set({ boatId: boat.id }).where(eq(trips.id, trip.id));

    await deleteBoat(db, shop.id, boat.id);

    const [after] = await db
      .select({ boatId: trips.boatId })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(after?.boatId).toBe(boat.id);
    expect((await getBoatForHistory(db, shop.id, boat.id))?.name).toBe("Blue Horizon");
  });

  it("counts the departures a delete would touch, so the confirm can say", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Sea Fox", 8);
    expect((await countDeparturesByBoat(db, shop.id)).get(boat.id) ?? 0).toBe(0);

    const rows = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), ne(trips.status, "cancelled")))
      .orderBy(asc(trips.startsAt), asc(trips.id))
      .limit(2);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      await db.update(trips).set({ boatId: boat.id }).where(eq(trips.id, row.id));
    }
    // One read for the whole fleet (code review 2026-10-13b, item 36): the
    // settings page used to count one hull at a time.
    const counts = await countDeparturesByBoat(db, shop.id);
    expect(counts.get(boat.id)).toBe(rows.length);
    expect([...counts.keys()]).not.toContain(null);
  });

  it("refuses to delete the same hull twice, keeping the date it was retired", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Second Wind", 6);
    expect(await deleteBoat(db, shop.id, boat.id)).toBe(true);
    const first = (await getBoatForHistory(db, shop.id, boat.id))?.deletedAt;

    // A second tap is not a second retirement — the stamp must keep saying when
    // the shop actually let the boat go.
    expect(await deleteBoat(db, shop.id, boat.id)).toBe(false);
    expect((await getBoatForHistory(db, shop.id, boat.id))?.deletedAt).toEqual(first);
  });

  it("will not rename a hull the shop has deleted", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Old Faithful", 6);
    await deleteBoat(db, shop.id, boat.id);

    expect(await updateBoat(db, shop.id, boat.id, "New Name", 10)).toBeNull();
    expect((await getBoatForHistory(db, shop.id, boat.id))?.name).toBe("Old Faithful");
  });
});

/**
 * **The certificate check and the save are one transaction** (H-107, #2324):
 * the fleet row's save decides against the departures it has locked, and
 * writes nothing when it refuses.
 */
describe("updateBoatWithinCertificate", () => {
  const NOW = new Date("2030-05-01T12:00:00.000Z");
  const papers = (
    certifiedPassengers: number | null,
    certifiedTotalPersons: number | null = null,
  ) => ({
    certifiedPassengers,
    certifiedTotalPersons,
    coiExpiresOn: null,
    inspectionDueOn: null,
    registrationExpiresOn: null,
    insuranceExpiresOn: null,
  });
  const save = (
    db: typeof ctx.db,
    shopId: string,
    boatId: string,
    capacity: number,
    certifiedPassengers: number | null,
  ) =>
    updateBoatWithinCertificate(db, {
      shopId,
      boatId,
      name: "Certified Hull",
      capacity,
      description: null,
      papers: papers(certifiedPassengers),
      timeZone: "America/New_York",
      now: NOW,
    });

  async function hullWithADeparture(db: typeof ctx.db, shopId: string, seats: number) {
    const boat = await createBoat(db, shopId, "Certified Hull", 6);
    const trip = await createTrip(db, {
      shopId,
      title: "On the hull",
      startsAt: new Date("2030-06-01T12:00:00.000Z"),
      endsAt: new Date("2030-06-01T16:00:00.000Z"),
      capacity: seats,
      boatId: boat.id,
    });
    if (!trip) throw new Error("trip not created");
    return boat;
  }

  // #2302: total persons, crew included, beside the passenger limit.
  it("saves a total-persons limit and the certificate's own expiry", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Persons Hull", 6);
    const saved = await updateBoatWithinCertificate(db, {
      shopId: shop.id,
      boatId: boat.id,
      name: "Persons Hull",
      capacity: 6,
      description: null,
      papers: { ...papers(10, 12), coiExpiresOn: "2031-02-28" },
      timeZone: "America/New_York",
      now: NOW,
    });
    expect(saved).toMatchObject({
      ok: true,
      boat: { certifiedPassengers: 10, certifiedTotalPersons: 12, coiExpiresOn: "2031-02-28" },
    });
  });

  it("refuses more passengers than persons and writes nothing", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Typo Hull", 6);
    const refused = await updateBoatWithinCertificate(db, {
      shopId: shop.id,
      boatId: boat.id,
      name: "Typo Hull",
      capacity: 6,
      description: null,
      papers: papers(14, 12),
      timeZone: "America/New_York",
      now: NOW,
    });
    expect(refused).toEqual({
      ok: false,
      reason: "certificate",
      refusal: { code: "passengers_above_total_persons", passengers: 14, limit: 12 },
    });
    expect(await getBoatById(db, shop.id, boat.id)).toMatchObject({
      certifiedPassengers: null,
      certifiedTotalPersons: null,
    });
  });

  // Dive-domain review D2: more seats than persons is a typo at save. The
  // sale is untouched (Aaron, 2026-10-13); only the boat row is refused.
  it("refuses saving more seats than total persons, and keeps the boat as it was", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Spanish Hull", 6);
    expect(
      await updateBoatWithinCertificate(db, {
        shopId: shop.id,
        boatId: boat.id,
        name: "Spanish Hull",
        capacity: 20,
        description: null,
        papers: papers(null, 12),
        timeZone: "America/New_York",
        now: NOW,
      }),
    ).toEqual({
      ok: false,
      reason: "certificate",
      refusal: { code: "capacity_above_total_persons", capacity: 20, limit: 12 },
    });
    expect(await getBoatById(db, shop.id, boat.id)).toMatchObject({
      capacity: 6,
      certifiedTotalPersons: null,
    });
  });

  // One refused statement per test: it aborts the test's transaction.
  it("is refused by the table itself when passengers pass persons", async () => {
    const { db, shop } = ctx;
    await expect(
      createBoat(db, shop.id, "Constraint Hull", 6, null, papers(14, 12)),
    ).rejects.toThrow();
  });

  it("is refused by the table itself for a total of nobody", async () => {
    const { db, shop } = ctx;
    await expect(createBoat(db, shop.id, "Zero Hull", 6, null, papers(null, 0))).rejects.toThrow();
  });

  it("refuses a certificate below a departure's seats and leaves the hull as it was", async () => {
    const { db, shop } = ctx;
    const boat = await hullWithADeparture(db, shop.id, 4);

    expect(await save(db, shop.id, boat.id, 2, 2)).toMatchObject({
      ok: false,
      reason: "certificate",
      refusal: { code: "departures_above_certificate", departures: 1, limit: 2 },
    });
    expect(await getBoatById(db, shop.id, boat.id)).toMatchObject({
      capacity: 6,
      certifiedPassengers: null,
    });
  });

  it("allows total occupant capacity above the passenger certificate", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Certified Hull", 6);
    expect(await save(db, shop.id, boat.id, 6, 4)).toMatchObject({
      ok: true,
      boat: { capacity: 6, certifiedPassengers: 4 },
    });
  });

  it("saves a certificate every departure fits under", async () => {
    const { db, shop } = ctx;
    const boat = await hullWithADeparture(db, shop.id, 4);
    expect(await save(db, shop.id, boat.id, 4, 4)).toMatchObject({
      ok: true,
      boat: { capacity: 4, certifiedPassengers: 4 },
    });
  });

  it("will not save a hull the shop has deleted", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Certified Hull", 6);
    await deleteBoat(db, shop.id, boat.id);
    expect(await save(db, shop.id, boat.id, 4, null)).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("the boat a departure sails on, for its emergency card (fourth review, item 11)", () => {
  async function departureOn(boatId: string | null) {
    const { db, shop } = ctx;
    const startsAt = new Date("2026-10-17T12:00:00Z");
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Two-Tank Reef",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 3600 * 1000),
      capacity: 10,
      plannedDives: 2,
      priceCents: 9500,
      diveMode: "boat",
      boatId,
    });
    if (!trip) throw new Error("trip creation failed");
    return trip;
  }

  it("names each departure's own hull with its call sign, MMSI and working channel", async () => {
    const { db, shop } = ctx;
    const one = await createBoat(db, shop.id, "Mantis I", 12, null, {
      certifiedPassengers: null,
      certifiedTotalPersons: null,
      coiExpiresOn: null,
      inspectionDueOn: null,
      registrationExpiresOn: null,
      insuranceExpiresOn: null,
      callSign: "WDM2201",
      mmsi: "338055502",
      workingChannel: "68",
    });
    const two = await createBoat(db, shop.id, "Mantis II", 14);
    const onOne = await departureOn(one.id);
    const onTwo = await departureOn(two.id);
    const onNone = await departureOn(null);

    const vessels = await departureVessels(db, shop.id, [onOne.id, onTwo.id, onNone.id]);
    expect(vessels.get(onOne.id)).toEqual({
      name: "Mantis I",
      callSign: "WDM2201",
      mmsi: "338055502",
      workingChannel: "68",
    });
    expect(vessels.get(onTwo.id)).toEqual({
      name: "Mantis II",
      callSign: null,
      mmsi: null,
      workingChannel: null,
    });
    // No boat: the card falls back to the shop's own vessel line.
    expect(vessels.has(onNone.id)).toBe(false);
  });

  it("still names a hull the shop has since deleted", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Old Hull", 8);
    const trip = await departureOn(boat.id);
    await deleteBoat(db, shop.id, boat.id);
    expect((await departureVessels(db, shop.id, [trip.id])).get(trip.id)?.name).toBe("Old Hull");
  });

  it("counts the live boats with neither a call sign nor an MMSI (review B1)", async () => {
    const { db, shop } = ctx;
    const before = await countBoatsWithoutRadioIdentity(db, shop.id);
    const papers = {
      certifiedPassengers: null,
      certifiedTotalPersons: null,
      coiExpiresOn: null,
      inspectionDueOn: null,
      registrationExpiresOn: null,
      insuranceExpiresOn: null,
    };
    await createBoat(db, shop.id, "Bare", 8);
    await createBoat(db, shop.id, "Call sign only", 8, null, { ...papers, callSign: "WDM9" });
    await createBoat(db, shop.id, "MMSI only", 8, null, { ...papers, mmsi: "338055509" });
    const gone = await createBoat(db, shop.id, "Deleted bare", 8);
    await deleteBoat(db, shop.id, gone.id);
    expect(await countBoatsWithoutRadioIdentity(db, shop.id)).toBe(before + 1);
    expect(await countBoatsWithoutRadioIdentity(db, "00000000-0000-4000-8000-000000000000")).toBe(
      0,
    );
  });

  it("answers nothing about another shop's departure", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Mantis I", 12);
    const trip = await departureOn(boat.id);
    const vessels = await departureVessels(db, "00000000-0000-4000-8000-000000000000", [trip.id]);
    expect(vessels.size).toBe(0);
  });

  it("refuses an MMSI that is not nine digits at the column", async () => {
    const { db, shop } = ctx;
    await expect(
      createBoat(db, shop.id, "Typo", 8, null, {
        certifiedPassengers: null,
        certifiedTotalPersons: null,
        coiExpiresOn: null,
        inspectionDueOn: null,
        registrationExpiresOn: null,
        insuranceExpiresOn: null,
        mmsi: "33805550",
      }),
    ).rejects.toThrow();
  });
});
