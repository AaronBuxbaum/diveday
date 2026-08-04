import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { getTripManifest } from "./manifests";
import { tripRequirements, trips as tripsTable } from "./schema";
import { resetDemoSchedule } from "./seed";

/**
 * The demo is a teaching surface: whatever it shows, a shop learns is normal.
 * These history trips used to be inserted with no `trip_requirements` row at
 * all, so every one of their bookings read `requirements_not_configured` —
 * blocked — while the seed wrote a `boarded` roll call for them by direct
 * insert. The result was a green "Boarded" pill beside a red "Requirements not
 * configured" on the same manifest line: a pairing `recordRollCall` refuses to
 * create, because readiness gates boarding at departure. The demo was teaching
 * exactly what the boarding gate exists to prevent.
 */
describe("seeded history manifests", () => {
  const HISTORY_DESCRIPTION = "Sailed. Kept in the log for the shop's monthly numbers.";

  it("never shows a boarded diver beside a blocked readiness result", async () => {
    const { db, shop } = await seededShopContext();
    await resetDemoSchedule(db, shop.id, { history: true });

    const history = await db
      .select({ id: tripsTable.id, title: tripsTable.title })
      .from(tripsTable)
      .where(and(eq(tripsTable.shopId, shop.id), eq(tripsTable.description, HISTORY_DESCRIPTION)));
    expect(history.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const trip of history) {
      const [requirement] = await db
        .select({ tripId: tripRequirements.tripId })
        .from(tripRequirements)
        .where(eq(tripRequirements.tripId, trip.id));
      expect(requirement, `${trip.title} has no requirements row`).toBeDefined();

      const manifest = await getTripManifest(db, shop.id, trip.id);
      if (!manifest) throw new Error(`no manifest for ${trip.title}`);
      for (const diver of manifest.divers) {
        if (diver.rollCall?.state === "boarded" && diver.readiness.status !== "ready") {
          offenders.push(`${trip.title} · ${diver.fullName}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("carries a no-show's absence forward through every after-dive checkpoint", async () => {
    // "Off the boat stays off the boat": the seed records one explicit
    // `not_boarded` at departure for a no-show and nothing after it, so the
    // carried-forward default is what every later checkpoint shows. It is the
    // only place in the demo (and therefore in the visual fleet) where that
    // state is exercised at all.
    const { db, shop } = await seededShopContext();
    await resetDemoSchedule(db, shop.id, { history: true });

    const history = await db
      .select({ id: tripsTable.id })
      .from(tripsTable)
      .where(and(eq(tripsTable.shopId, shop.id), eq(tripsTable.description, HISTORY_DESCRIPTION)));

    let carried = 0;
    for (const trip of history) {
      const afterDive = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
      if (!afterDive) continue;
      carried += afterDive.divers.filter(
        (diver) => diver.rollCall?.state === "not_boarded" && diver.rollCall.implied === true,
      ).length;
    }
    expect(carried).toBeGreaterThan(0);
  });
});
