import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { utcToWallTime } from "@/lib/zoned";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext, unseededTestDb } from "@/test/db";
import { getDayCloseout } from "./closeout";
import { getTripManifest } from "./manifests";
import { listTripReadiness } from "./readiness";
import {
  boats,
  buddyPairMembers,
  people,
  rollCallCrewEvents,
  rollCallEvents,
  shops,
  tripAssignments,
  tripDives,
  tripLenses,
  tripStageEvents,
  trips,
} from "./schema";
import { seedDemo } from "./seed";
import {
  AT_SEA_ABOARD,
  AT_SEA_CREW,
  AT_SEA_DAY_TITLE,
  AT_SEA_DUSK_TITLE,
  AT_SEA_STILL_DOWN,
} from "./seed-boat-at-sea";
import { OWNER_NAME } from "./seed-cast";
import { getShopBySlug } from "./shops";
import { crewClashes } from "./trips-crew";

/**
 * **The demo has a boat at sea, halfway through her roll call** (market sheet
 * 2026-10-22, item 1): at the frozen 9:30 AM clock she sailed at 6:30, dive 1
 * is counted, and dive 2's count reads nine of eleven back aboard with one
 * buddy pair still down. Every word of the record is behind the clock.
 */
describe("the boat at sea", () => {
  const context = fileScopedShopContext({ history: true });

  async function boatAtSea() {
    const { db, shop } = context;
    const [trip] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.title, AT_SEA_DAY_TITLE)));
    if (!trip) throw new Error("expected the boat at sea");
    return { db, shop, trip };
  }

  it("is underway, on a hull, with her owner skippering", async () => {
    const { db, trip } = await boatAtSea();
    const [stage] = await db
      .select({ stage: tripStageEvents.stage, by: tripStageEvents.recordedByPersonId })
      .from(tripStageEvents)
      .where(eq(tripStageEvents.tripId, trip.id))
      .orderBy(desc(tripStageEvents.recordedAt))
      .limit(1);
    expect(stage?.stage).toBe("underway");
    expect(trip.startsAt.getTime()).toBeLessThan(nowDate().getTime());
    expect(trip.endsAt.getTime()).toBeGreaterThan(nowDate().getTime());
    const [hull] = await db
      .select({ name: boats.name })
      .from(boats)
      .where(eq(boats.id, trip.boatId ?? ""));
    expect(hull?.name).toBe("Mantis I");
    const [skipper] = await db
      .select({ fullName: people.fullName, id: people.id })
      .from(tripAssignments)
      .innerJoin(people, eq(people.id, tripAssignments.personId))
      .where(and(eq(tripAssignments.tripId, trip.id), eq(tripAssignments.tripRole, "captain")));
    expect(skipper?.fullName).toBe(OWNER_NAME);
    expect(stage?.by).toBe(skipper?.id);
    const [lens] = await db
      .select({ name: tripLenses.name })
      .from(tripLenses)
      .where(eq(tripLenses.id, trip.lensId ?? ""));
    expect(lens?.name).toBe("Easygoing reef");
  });

  it("carries only divers the boarding gate clears", async () => {
    const { db, shop, trip } = await boatAtSea();
    const readiness = await listTripReadiness(db, shop.id, trip.id);
    expect(readiness).toHaveLength(AT_SEA_ABOARD);
    expect(readiness.every((row) => row.readiness.status === "ready")).toBe(true);
  });

  it("has dive 1 counted and dive 2 open: nine of eleven back aboard, one buddy pair down", async () => {
    const { db, shop, trip } = await boatAtSea();
    const afterDiveOne = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
    expect(afterDiveOne?.summary.boarded).toBe(AT_SEA_ABOARD);
    expect(afterDiveOne?.summary.awaiting).toBe(0);
    const afterDiveTwo = await getTripManifest(db, shop.id, trip.id, "after_dive_2");
    expect(afterDiveTwo?.summary.totalDivers).toBe(AT_SEA_ABOARD);
    expect(afterDiveTwo?.summary.boarded).toBe(AT_SEA_ABOARD - AT_SEA_STILL_DOWN);
    expect(afterDiveTwo?.summary.awaiting).toBe(AT_SEA_STILL_DOWN);
    // Nobody is reported missing: two names are still to call, that is all.
    expect(afterDiveTwo?.summary.notBackAboard).toBe(0);

    const counted = await db
      .select({ bookingId: rollCallEvents.bookingId })
      .from(rollCallEvents)
      .where(
        and(eq(rollCallEvents.tripId, trip.id), eq(rollCallEvents.checkpoint, "after_dive_2")),
      );
    const roster = readinessIds(await listTripReadiness(db, shop.id, trip.id));
    const down = roster.filter((id) => !counted.some((row) => row.bookingId === id));
    expect(down).toHaveLength(AT_SEA_STILL_DOWN);
    const teams = await db
      .select({ pairId: buddyPairMembers.pairId })
      .from(buddyPairMembers)
      .where(inArray(buddyPairMembers.bookingId, down));
    expect(new Set(teams.map((row) => row.pairId)).size).toBe(1);
  });

  it("keeps a guide down with the last pair, her own count still open", async () => {
    const { db, trip } = await boatAtSea();
    const counted = await db
      .select({ personId: rollCallCrewEvents.personId })
      .from(rollCallCrewEvents)
      .where(
        and(
          eq(rollCallCrewEvents.tripId, trip.id),
          eq(rollCallCrewEvents.checkpoint, "after_dive_2"),
        ),
      );
    const guides = await db
      .select({ personId: tripAssignments.personId })
      .from(tripAssignments)
      .where(and(eq(tripAssignments.tripId, trip.id), eq(tripAssignments.tripRole, "divemaster")));
    const stillDown = guides.filter(
      (guide) => !counted.some((row) => row.personId === guide.personId),
    );
    expect(stillDown).toHaveLength(1);
  });

  /**
   * **Deepest dive first, and a guide never reads as leading nine** (dive-domain
   * review of the demo reseed, item 5): Molasses at 12 m before Pickles at
   * 8 m, and the first guide surfaces with the last of her six divers, the
   * shop's six to one, not after the trio that is the second guide's group.
   */
  it("dives the deeper reef first", async () => {
    const { db, trip } = await boatAtSea();
    const plan = await db
      .select({ title: tripDives.title })
      .from(tripDives)
      .where(eq(tripDives.tripId, trip.id))
      .orderBy(asc(tripDives.diveNumber));
    expect(plan.map((dive) => dive.title)).toEqual(["Molasses Reef", "Pickles Reef"]);
  });

  it("brings the first guide up with her six, before the second guide's trio", async () => {
    const { db, trip } = await boatAtSea();
    const guides = await db
      .select({ personId: tripAssignments.personId })
      .from(tripAssignments)
      .where(and(eq(tripAssignments.tripId, trip.id), eq(tripAssignments.tripRole, "divemaster")));
    const [guideBack] = await db
      .select({ at: rollCallCrewEvents.occurredAt })
      .from(rollCallCrewEvents)
      .where(
        and(
          eq(rollCallCrewEvents.tripId, trip.id),
          eq(rollCallCrewEvents.checkpoint, "after_dive_2"),
          inArray(
            rollCallCrewEvents.personId,
            guides.map((guide) => guide.personId),
          ),
        ),
      );
    if (!guideBack) throw new Error("expected the first guide counted back");
    const divers = await db
      .select({ at: rollCallEvents.occurredAt })
      .from(rollCallEvents)
      .where(
        and(eq(rollCallEvents.tripId, trip.id), eq(rollCallEvents.checkpoint, "after_dive_2")),
      );
    const upWithOrBefore = divers.filter((row) => row.at.getTime() <= guideBack.at.getTime());
    expect(upWithOrBefore).toHaveLength(6);
  });

  it("writes no word ahead of the clock", async () => {
    const { db, trip } = await boatAtSea();
    const now = nowDate().getTime();
    const divers = await db
      .select({ at: rollCallEvents.occurredAt })
      .from(rollCallEvents)
      .where(eq(rollCallEvents.tripId, trip.id));
    const crew = await db
      .select({ at: rollCallCrewEvents.occurredAt })
      .from(rollCallCrewEvents)
      .where(eq(rollCallCrewEvents.tripId, trip.id));
    for (const row of [...divers, ...crew]) expect(row.at.getTime()).toBeLessThanOrEqual(now);
  });

  it("puts nobody on two hulls at once", async () => {
    const { db, shop, trip } = await boatAtSea();
    expect(await crewClashes(db, shop.id, trip.id, nowDate())).toEqual([]);
  });
  /**
   * The close-out plumbing for a count still being taken (dive-domain review
   * of 56ba7c1): the station reads still out at dive 2's open count, so its
   * Open roll call link goes to after_dive_2, and the same boat read as a past
   * day's record never softens.
   */
  it("reads still out at her open dive 2 count today, and loud on the record", async () => {
    const { db, shop, trip } = await boatAtSea();
    const today = await getDayCloseout(db, shop.id, shop.timezone, nowDate());
    expect(today.departures.find((d) => d.tripId === trip.id)).toMatchObject({
      status: "still_out",
      gapReason: null,
      diveNumber: 2,
      uncounted: AT_SEA_STILL_DOWN,
    });
    const record = await getDayCloseout(
      db,
      shop.id,
      shop.timezone,
      nowDate(),
      undefined,
      today.shopDay,
    );
    expect(record.departures.find((d) => d.tripId === trip.id)).toMatchObject({
      status: "unreconciled",
      gapReason: "after_dive_uncounted",
      diveNumber: 2,
    });
  });

  it("shows the finished prior-evening dusk roll call before the dawn boat at 5 AM", async () => {
    const fiveAmOffset = -4.5 * 60 * 60 * 1000; // Fixture clock is 9:30 AM shop time.
    advanceClock(fiveAmOffset);
    const db = await unseededTestDb();
    await seedDemo(db, { history: true });
    const shop = await getShopBySlug(db, "blue-mantis");
    if (!shop) throw new Error('expected the seeded "blue-mantis" demo shop');
    const now = new Date(nowDate().getTime());

    const state = await getDayCloseout(db, shop.id, shop.timezone, now);
    const dawn = state.departures.find((departure) => {
      const wall = utcToWallTime(departure.startsAt, shop.timezone);
      return wall.hour === 5 && wall.minute === 30;
    });

    expect(state.carryover).toMatchObject({
      title: AT_SEA_DUSK_TITLE,
      status: "all_home",
      sailed: AT_SEA_ABOARD,
      back: AT_SEA_ABOARD,
      crewSailed: AT_SEA_CREW.length,
      crewBack: AT_SEA_CREW.length,
      uncounted: 0,
    });
    expect(state.carryover?.startsAt.getTime()).toBeLessThan(now.getTime());
    expect(state.carryover?.endsAt.getTime()).toBeLessThan(now.getTime());
    expect(dawn).toBeDefined();
    expect(state.carryover?.endsAt.getTime()).toBeLessThan(dawn?.startsAt.getTime() ?? 0);

    await db.update(shops).set({ timezone: "Pacific/Honolulu" }).where(eq(shops.id, shop.id));
    const afterTimezoneEdit = await getDayCloseout(db, shop.id, "Pacific/Honolulu", now);
    expect(afterTimezoneEdit.carryover?.tripId).toBe(state.carryover?.tripId);
    expect(afterTimezoneEdit.carryover?.startsAt.getTime()).toBe(
      state.carryover?.startsAt.getTime(),
    );

    await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
    expect((await getDayCloseout(db, shop.id, "Pacific/Honolulu", now)).carryover).toBeUndefined();
  });
});

function readinessIds(rows: { booking: { id: string } }[]): string[] {
  return rows.map((row) => row.booking.id);
}
