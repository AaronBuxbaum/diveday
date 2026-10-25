import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { weekdaySetFrom } from "@/lib/recurrence";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { listDiveSites } from "./dive-sites";
import { tripChangeEvents } from "./schema";
import { applyDetailsToFutureSeries, createTripSeries, updateTrip } from "./trips";

const ctx = fileScopedShopContext();
const WED = 3;
const at = (iso: string) => new Date(iso);

/**
 * **A run's apply-to-every-date ledgers each moved date** (issue #3060,
 * decided 2026-10-25). Each later date whose run of sites moves tells its own
 * divers once, naming who applied it; a date already running those sites
 * gains nothing.
 */
describe("applyDetailsToFutureSeries and the site-change ledger", () => {
  it("writes one entry on each date whose sites moved, none on one already there", async () => {
    const { db, shop } = ctx;
    const actor = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const result = await createTripSeries(db, {
      shopId: shop.id,
      title: "Wednesday Reef",
      capacity: 12,
      plannedDives: 2,
      frequency: "weekly",
      intervalWeeks: 1,
      weekdays: weekdaySetFrom([WED]),
      anchorDate: "2030-09-04",
      endsOn: "2030-09-18",
      timeZone: "America/New_York",
      template: {
        startsAt: at("2030-09-04T11:00:00.000Z"),
        endsAt: at("2030-09-04T15:00:00.000Z"),
      },
    });
    if (!result) throw new Error("series not created");
    const [source, alreadyThere, stillElsewhere] = result.trips;
    if (!source || !alreadyThere || !stillElsewhere) throw new Error("expected three instances");
    const [siteOne, siteTwo] = await listDiveSites(db, shop.id);
    if (!siteOne || !siteTwo) throw new Error("seeded shop needs two dive sites");
    const plan = {
      capacity: source.capacity,
      plannedDives: source.plannedDives,
      dives: [{ diveSiteId: siteOne.id }, { diveSiteId: siteTwo.id }],
    };
    for (const trip of [source, alreadyThere]) {
      await updateTrip(db, shop.id, trip.id, {
        title: trip.title,
        startsAt: trip.startsAt,
        endsAt: trip.endsAt,
        ...plan,
      });
    }

    const applied = await applyDetailsToFutureSeries(
      db,
      shop.id,
      result.series.id,
      source.id,
      at("2030-08-15T00:00:00.000Z"),
      actor,
    );
    expect(applied).toEqual({ updated: 2, skipped: 0 });

    const siteEntries = (tripId: string) =>
      db
        .select()
        .from(tripChangeEvents)
        .where(and(eq(tripChangeEvents.tripId, tripId), eq(tripChangeEvents.kind, "site_change")));
    const moved = await siteEntries(stillElsewhere.id);
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({
      actorPersonId: actor,
      source: "shop",
      beforeValue: { siteNames: null },
      afterValue: { siteNames: [siteOne.name, siteTwo.name].join("\n") },
    });
    // Its own edit wrote one; the apply wrote none.
    expect(await siteEntries(alreadyThere.id)).toHaveLength(1);
  });
});
