import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { AppDb } from "@/db/client";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { getTripRequirements, getTripSiteRequirement } from "./readiness";
import { people, trips } from "./schema";

/**
 * The demo shop has to be able to *show* the booking-time cert gate (ADR
 * 20260803-trip-admission-at-booking), and a `dive-domain-expert` review found
 * it could not: every seeded charter stated the same Open Water default, and
 * the two that demanded more demanded three things at once. `seed-cert-gates.ts`
 * adds four departures that each refuse for exactly one reason plus the course
 * session the gate must never fire on.
 *
 * These assertions are what keep that arrangement true. They are deliberately
 * about the *outcome a real booking gets* rather than the row shapes: a seeded
 * trip whose gate quietly stopped isolating one reason still has all its rows
 * and demonstrates nothing.
 */

async function tripByTitle(db: AppDb, shopId: string, title: string) {
  const [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.shopId, shopId), eq(trips.title, title)))
    .limit(1);
  if (!trip) throw new Error(`seeded trip "${title}" missing`);
  return trip;
}

async function personByName(db: AppDb, shopId: string, fullName: string) {
  const [person] = await db
    .select()
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.fullName, fullName)))
    .limit(1);
  if (!person) throw new Error(`seeded diver "${fullName}" missing`);
  return person;
}

describe("the seeded cert-gate departures", () => {
  it("refuses a verified Open Water diver on the Advanced-only charter, on the level alone", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await tripByTitle(db, shop.id, "Advanced Drift — French Reef Wall");
    const diego = await personByName(db, shop.id, "Diego Alvarez");

    expect(
      await createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        personId: diego.id,
      }),
    ).toEqual({
      ok: false,
      reason: "trip_prerequisite",
      // Nothing but the rung: no specialty, no nitrox, and the level the diver
      // actually holds — which is what lets the staff banner say "add a card"
      // only when there is one to add.
      refusal: {
        requiredLevel: "advanced_open_water",
        missingSpecialties: [],
        nitroxRequired: false,
        heldLevel: "open_water",
      },
    });
  });

  it("refuses an Instructor with no Deep card on the Duane, on the specialty alone", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await tripByTitle(db, shop.id, "Deep Adventure — USCGC Duane");
    const odile = await personByName(db, shop.id, "Odile Marchand");

    // The top of the ladder, still refused: only a specialty card can explain
    // this, which is the case no seeded diver could produce before.
    expect(
      await createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        personId: odile.id,
      }),
    ).toEqual({
      ok: false,
      reason: "trip_prerequisite",
      refusal: {
        requiredLevel: null,
        missingSpecialties: ["deep"],
        nitroxRequired: false,
        heldLevel: null,
      },
    });
  });

  it("keeps the Duane sailing free of a nitrox demand, so the Deep refusal stays about the Deep card", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await tripByTitle(db, shop.id, "Deep Adventure — USCGC Duane");
    const requirement = await getTripRequirements(db, shop.id, trip.id);
    expect(requirement?.requiresNitrox).toBe(false);
    // The site's own gate is what this trip leans on — it states no specialty
    // of its own.
    expect(requirement?.requiredSpecialties).toEqual([]);
    expect(await getTripSiteRequirement(db, shop.id, trip.id)).toMatchObject({
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
    });
  });

  it("refuses a carded diver with no enriched-air card on the nitrox charter, on nitrox alone", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await tripByTitle(db, shop.id, "Nitrox Two-Tank — Benwood Wreck");
    const diego = await personByName(db, shop.id, "Diego Alvarez");

    expect(
      await createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        personId: diego.id,
      }),
    ).toEqual({
      ok: false,
      reason: "trip_prerequisite",
      refusal: {
        requiredLevel: null,
        missingSpecialties: [],
        nitroxRequired: true,
        heldLevel: null,
      },
    });
  });

  it("seats an Open Water student on the AOW course session at a site that demands Advanced + Deep", async () => {
    // The carve-out itself (ADR 20260803, amended): continuing education is
    // taught at the sites it certifies people for, so the itinerary's gate must
    // not refuse the student the course exists to create. Before this session
    // was seeded there was no demo departure where that could even be tried.
    const { db, shop } = await seededShopContext();
    const trip = await tripByTitle(db, shop.id, "Advanced Open Water Diver — two-day course");
    const student = await personByName(db, shop.id, "Kwame Asante");

    expect(await getTripSiteRequirement(db, shop.id, trip.id)).toMatchObject({
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
    });
    expect(
      await createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        personId: student.id,
      }),
    ).toMatchObject({ ok: true });
  });
});
