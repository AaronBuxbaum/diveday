import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  getBookingReadiness,
  getTripMaxDepthMeters,
  listTripReadiness,
  listTripsReadiness,
} from "./readiness";
import { readinessFixturesFor } from "./readiness-test-fixtures";
import type { DiveSpecialty } from "./schema";
import { diveSites, nitroxCertifications, shops, tripDives } from "./schema";
import { getTripRoster } from "./trips";

/** One PGlite for the file, a rolled-back transaction per test (issue #1244). */
const ctx = fileScopedShopContext();
const { withSecondSiteRequirement, verifiedOpenWaterCard } = readinessFixturesFor(ctx);

describe("site cert gate across a trip's dive rows (DOM-C1)", () => {
  /**
   * **Adversarial: the gate is on the LAST of several sites.** `trip_dives` is
   * the only place a planned site lives, so the cert gate must read every dive,
   * never the first (the retired pointer) and never the first chosen. Here dive
   * one has no site at all, dive two a gentle one, and only dive three's site
   * asks for Advanced, Deep and enriched air.
   */
  async function threeDiveDay(gate: {
    minimumCertificationLevel?: "advanced_open_water";
    requiredSpecialties?: DiveSpecialty[];
    requiresNitrox?: boolean;
  }) {
    const { db, shop, reef, rosterEntry } = await withSecondSiteRequirement({});
    const [gentle, gated] = await db
      .insert(diveSites)
      .values([
        { shopId: shop.id, name: "Gate Test Gentle", slug: "gate-test-gentle" },
        { shopId: shop.id, name: "Gate Test Last Tank", slug: "gate-test-last-tank", ...gate },
      ])
      .returning();
    if (!gentle || !gated) throw new Error("sites not created");
    await db.delete(tripDives).where(eq(tripDives.tripId, reef.id));
    await db.insert(tripDives).values([
      { tripId: reef.id, diveNumber: 1, diveSiteId: null },
      { tripId: reef.id, diveNumber: 2, diveSiteId: gentle.id },
      { tripId: reef.id, diveNumber: 3, diveSiteId: gated.id },
    ]);
    return { db, shop, reef, rosterEntry };
  }

  it("blocks an Open Water diver when only the last of three dives' site needs Advanced", async () => {
    const { db, shop, reef, rosterEntry } = await threeDiveDay({
      minimumCertificationLevel: "advanced_open_water",
    });
    await verifiedOpenWaterCard(db, shop.id, rosterEntry.person.id);

    expect(
      (await getBookingReadiness(db, shop.id, rosterEntry.booking.id))?.blockers,
    ).toContainEqual(expect.objectContaining({ code: "certification_insufficient" }));
    const [batch] = (await listTripsReadiness(db, shop.id, [reef.id])).filter(
      (row) => row.booking.id === rosterEntry.booking.id,
    );
    expect(batch?.readiness.blockers).toContainEqual(
      expect.objectContaining({ code: "certification_insufficient" }),
    );
  });

  it("demands the specialty of the last of three dives' site, on both read paths", async () => {
    const { db, shop, reef, rosterEntry } = await threeDiveDay({ requiredSpecialties: ["deep"] });

    expect(
      (await getBookingReadiness(db, shop.id, rosterEntry.booking.id))?.blockers,
    ).toContainEqual(
      expect.objectContaining({ code: "specialty_missing", params: { specialty: "deep" } }),
    );
    const [batch] = (await listTripsReadiness(db, shop.id, [reef.id])).filter(
      (row) => row.booking.id === rosterEntry.booking.id,
    );
    expect(batch?.readiness.blockers).toContainEqual(
      expect.objectContaining({ code: "specialty_missing", params: { specialty: "deep" } }),
    );
  });

  it("requires the certification of EVERY site a trip's dives span, each from its own dive", async () => {
    const { db, shop, reef, rosterEntry } = await threeDiveDay({ requiredSpecialties: ["deep"] });
    // Dive two's site now asks for a different specialty than dive three's.
    const [two] = await db
      .select({ id: tripDives.diveSiteId })
      .from(tripDives)
      .where(and(eq(tripDives.tripId, reef.id), eq(tripDives.diveNumber, 2)));
    if (!two?.id) throw new Error("dive two should have a site");
    await db
      .update(diveSites)
      .set({ requiredSpecialties: ["wreck"] })
      .where(and(eq(diveSites.shopId, shop.id), eq(diveSites.id, two.id)));

    const expected = [
      expect.objectContaining({ code: "specialty_missing", params: { specialty: "wreck" } }),
      expect.objectContaining({ code: "specialty_missing", params: { specialty: "deep" } }),
    ];
    expect((await getBookingReadiness(db, shop.id, rosterEntry.booking.id))?.blockers).toEqual(
      expect.arrayContaining(expected),
    );
    const [batch] = (await listTripsReadiness(db, shop.id, [reef.id])).filter(
      (row) => row.booking.id === rosterEntry.booking.id,
    );
    expect(batch?.readiness.blockers).toEqual(expect.arrayContaining(expected));
  });

  it("asks nothing of a diver once no dive names a site with a gate", async () => {
    const { db, shop, reef, rosterEntry } = await threeDiveDay({
      minimumCertificationLevel: "advanced_open_water",
    });
    await db.update(tripDives).set({ diveSiteId: null }).where(eq(tripDives.tripId, reef.id));
    await verifiedOpenWaterCard(db, shop.id, rosterEntry.person.id);

    expect(
      (await getBookingReadiness(db, shop.id, rosterEntry.booking.id))?.blockers,
    ).not.toContainEqual(expect.objectContaining({ code: "certification_insufficient" }));
  });

  it("requires nitrox when only the last of three dives' site asks for enriched air", async () => {
    const { db, shop, reef } = await threeDiveDay({ requiresNitrox: true });
    const nitroxHolders = new Set(
      (
        await db
          .select({ personId: nitroxCertifications.personId })
          .from(nitroxCertifications)
          .where(
            and(eq(nitroxCertifications.shopId, shop.id), isNull(nitroxCertifications.deletedAt)),
          )
      ).map((r) => r.personId),
    );
    const entry = (await getTripRoster(db, shop.id, reef.id)).find(
      (r) => !nitroxHolders.has(r.person.id),
    );
    if (!entry) throw new Error("expected a booked diver without a nitrox card");

    expect((await getBookingReadiness(db, shop.id, entry.booking.id))?.blockers).toContainEqual(
      expect.objectContaining({ code: "nitrox_missing" }),
    );
    const [batch] = (await listTripsReadiness(db, shop.id, [reef.id])).filter(
      (row) => row.booking.id === entry.booking.id,
    );
    expect(batch?.readiness.blockers).toContainEqual(
      expect.objectContaining({ code: "nitrox_missing" }),
    );
  });

  it("measures the depth of the last of three dives' site, not the shallower ones", async () => {
    const { db, shop, reef, rosterEntry } = await threeDiveDay({});
    await db.update(shops).set({ depthUnit: "meters" }).where(eq(shops.id, shop.id));
    await db
      .update(diveSites)
      .set({ maxDepthMeters: 10, depthMinMeters: null })
      .where(eq(diveSites.shopId, shop.id));
    await db
      .update(diveSites)
      .set({ maxDepthMeters: 35 })
      .where(and(eq(diveSites.shopId, shop.id), eq(diveSites.slug, "gate-test-last-tank")));
    await verifiedOpenWaterCard(db, shop.id, rosterEntry.person.id);

    expect(await getTripMaxDepthMeters(db, shop.id, reef.id)).toBe(35);
    const diver = (await listTripReadiness(db, shop.id, reef.id)).find(
      (row) => row.booking.id === rosterEntry.booking.id,
    );
    expect(diver?.depthAdvisory).toMatchObject({ status: "exceeds", siteDepth: 35 });
    // An advisory, never a gate (H-08).
    expect(diver?.readiness.blockers.some((blocker) => blocker.code.includes("depth"))).toBe(false);
  });

  it("asks nothing and does not crash for a trip with zero trip_dives rows", async () => {
    const { db, shop, reef, rosterEntry } = await threeDiveDay({
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      requiresNitrox: true,
    });
    await db.delete(tripDives).where(eq(tripDives.tripId, reef.id));
    await verifiedOpenWaterCard(db, shop.id, rosterEntry.person.id);

    const codes = (await getBookingReadiness(db, shop.id, rosterEntry.booking.id))?.blockers.map(
      (blocker) => blocker.code,
    );
    expect(codes).toBeDefined();
    expect(codes).not.toContain("certification_insufficient");
    expect(codes).not.toContain("specialty_missing");
    expect(codes).not.toContain("nitrox_missing");
    const [batch] = (await listTripsReadiness(db, shop.id, [reef.id])).filter(
      (row) => row.booking.id === rosterEntry.booking.id,
    );
    expect(batch).toBeDefined();
    expect(await getTripMaxDepthMeters(db, shop.id, reef.id)).toBeNull();
  });
});
