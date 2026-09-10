import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, HOUR_MS } from "@/lib/clock";
import { SIGHTING_WINDOW_DAYS } from "@/lib/sightings";
import { seededShopContext } from "@/test/db";
import { upsertExecutedDive } from "./executed-dives";
import { diveSites, people, personRoles, shops, tripSightings, trips } from "./schema";
import {
  deleteTripSighting,
  listTripSightings,
  recordTripSighting,
  siteSightingSummary,
  siteSightings,
} from "./trip-sightings";
import { createTrip } from "./trips";

const NOW = new Date("2026-09-10T15:00:00Z");

async function reefFixture() {
  const { db, shop } = await seededShopContext();
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  const sites = await db
    .select({ id: diveSites.id, name: diveSites.name })
    .from(diveSites)
    .where(eq(diveSites.shopId, shop.id))
    .orderBy(diveSites.name);
  const [site, otherSite] = sites;
  if (!owner || !site || !otherSite)
    throw new Error("the sightings fixture needs an owner and two sites");
  return { db, shop, owner, site, otherSite };
}

/** A departure that already sailed, `daysAgo` before the fixed now. */
async function departure(
  db: Awaited<ReturnType<typeof reefFixture>>["db"],
  shopId: string,
  title: string,
  daysAgo: number,
) {
  const startsAt = new Date(NOW.getTime() - daysAgo * DAY_MS);
  const trip = await createTrip(db, {
    shopId,
    title,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
    capacity: 6,
    plannedDives: 1,
  });
  if (!trip) throw new Error(`createTrip refused ${title}`);
  return trip;
}

describe("recordTripSighting", () => {
  it("writes the first tap at one and counts the second on the same row", async () => {
    const { db, shop, owner, site } = await reefFixture();
    const trip = await departure(db, shop.id, "Two-tank reef", 1);

    const first = await recordTripSighting(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveSiteId: site.id,
      speciesSlug: "green-sea-turtle",
      recordedByPersonId: owner.id,
      now: NOW,
    });
    expect(first).toMatchObject({ ok: true, sighting: { count: 1, diveSiteName: site.name } });

    const second = await recordTripSighting(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveSiteId: site.id,
      speciesSlug: "green-sea-turtle",
      recordedByPersonId: owner.id,
      now: NOW,
    });
    expect(second).toMatchObject({ ok: true, sighting: { count: 2 } });

    const listed = await listTripSightings(db, shop.id, trip.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ speciesSlug: "green-sea-turtle", count: 2 });
  });

  it("refuses a species the catalog does not carry", async () => {
    const { db, shop, owner, site } = await reefFixture();
    const trip = await departure(db, shop.id, "Two-tank reef", 1);
    // The whole safety property of the selection model: past this function
    // every stored slug is one the bundles are known to have words for, so
    // nothing downstream can render a slug at a diver.
    expect(
      await recordTripSighting(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveSiteId: site.id,
        speciesSlug: "loch-ness-monster",
        recordedByPersonId: owner.id,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "unknown_species" });
    expect(await listTripSightings(db, shop.id, trip.id)).toHaveLength(0);
  });

  it("refuses a site, a departure and a recorder this shop does not own", async () => {
    const { db, shop, owner, site } = await reefFixture();
    const trip = await departure(db, shop.id, "Two-tank reef", 1);
    const base = {
      shopId: shop.id,
      tripId: trip.id,
      diveSiteId: site.id,
      speciesSlug: "green-sea-turtle",
      recordedByPersonId: owner.id,
      now: NOW,
    };
    expect(await recordTripSighting(db, { ...base, diveSiteId: crypto.randomUUID() })).toEqual({
      ok: false,
      reason: "unknown_site",
    });
    expect(await recordTripSighting(db, { ...base, tripId: crypto.randomUUID() })).toEqual({
      ok: false,
      reason: "unknown_trip",
    });
    expect(
      await recordTripSighting(db, { ...base, recordedByPersonId: crypto.randomUUID() }),
    ).toEqual({ ok: false, reason: "unknown_recorder" });
  });

  it("refuses a tap on a departure that has not sailed", async () => {
    const { db, shop, owner, site } = await reefFixture();
    // Tomorrow's boat. The manifest does not offer the group before departure,
    // but a checkpoint is a query parameter and the surface is not the
    // boundary — a sighting here would publish "seen here" for a dive nobody
    // has done.
    const tomorrow = await departure(db, shop.id, "Tomorrow’s reef", -1);
    expect(
      await recordTripSighting(db, {
        shopId: shop.id,
        tripId: tomorrow.id,
        diveSiteId: site.id,
        speciesSlug: "green-sea-turtle",
        recordedByPersonId: owner.id,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "not_sailed" });
  });

  it("allows a tap once the buffered hour is past, and not before", async () => {
    const { db, shop, owner, site } = await reefFixture();
    // The same buffered hour every "has it gone?" question uses, so a departure
    // that slips for the tide does not change the answer.
    const justLeft = await departure(db, shop.id, "Casting off", 0);
    const tap = {
      shopId: shop.id,
      tripId: justLeft.id,
      diveSiteId: site.id,
      speciesSlug: "green-sea-turtle",
      recordedByPersonId: owner.id,
    };
    expect(
      await recordTripSighting(db, {
        ...tap,
        now: new Date(justLeft.startsAt.getTime() + 30 * 60_000),
      }),
    ).toEqual({ ok: false, reason: "not_sailed" });
    expect(
      await recordTripSighting(db, {
        ...tap,
        now: new Date(justLeft.startsAt.getTime() + 61 * 60_000),
      }),
    ).toMatchObject({ ok: true });
  });

  it("refuses a departure the shop deleted", async () => {
    const { db, shop, owner, site } = await reefFixture();
    const trip = await departure(db, shop.id, "Cancelled and taken off", 1);
    await db.update(trips).set({ deletedAt: NOW }).where(eq(trips.id, trip.id));
    expect(
      await recordTripSighting(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveSiteId: site.id,
        speciesSlug: "green-sea-turtle",
        recordedByPersonId: owner.id,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "unknown_trip" });
  });
});

describe("deleteTripSighting", () => {
  it("takes a mis-tap back and lets the next tap start over at one", async () => {
    const { db, shop, owner, site } = await reefFixture();
    const trip = await departure(db, shop.id, "Two-tank reef", 1);
    const tap = {
      shopId: shop.id,
      tripId: trip.id,
      diveSiteId: site.id,
      speciesSlug: "nurse-shark",
      recordedByPersonId: owner.id,
      now: NOW,
    };
    await recordTripSighting(db, tap);
    await recordTripSighting(db, tap);

    expect(await deleteTripSighting(db, { ...tap, deletedByPersonId: owner.id })).toBe(true);
    expect(await listTripSightings(db, shop.id, trip.id)).toHaveLength(0);
    // Soft: the row is still there, which is what keeps the shop's history.
    const rows = await db.select().from(tripSightings).where(eq(tripSightings.tripId, trip.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deletedAt).toBeInstanceOf(Date);

    const again = await recordTripSighting(db, tap);
    expect(again).toMatchObject({ ok: true, sighting: { count: 1 } });
    // A second live row is only possible because the unique index is partial;
    // if it were not, this insert would have collided with the deleted one.
    expect(await listTripSightings(db, shop.id, trip.id)).toHaveLength(1);
  });

  it("answers false for a tap that was never there", async () => {
    const { db, shop, owner, site } = await reefFixture();
    const trip = await departure(db, shop.id, "Two-tank reef", 1);
    expect(
      await deleteTripSighting(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveSiteId: site.id,
        speciesSlug: "green-sea-turtle",
        deletedByPersonId: owner.id,
        now: NOW,
      }),
    ).toBe(false);
  });
});

describe("siteSightings", () => {
  it("counts departures, not taps, and dates the last one", async () => {
    const { db, shop, owner, site } = await reefFixture();
    const first = await departure(db, shop.id, "Saturday", 6);
    const second = await departure(db, shop.id, "Sunday", 3);
    const quiet = await departure(db, shop.id, "Monday", 2);
    // Two departures saw a turtle; one of them saw two. The sentence is about
    // departures, so the tally is 2 of 3 rather than 3 of 3.
    for (const [trip, taps] of [
      [first, 1],
      [second, 2],
    ] as const) {
      for (let tap = 0; tap < taps; tap += 1) {
        await recordTripSighting(db, {
          shopId: shop.id,
          tripId: trip.id,
          diveSiteId: site.id,
          speciesSlug: "green-sea-turtle",
          recordedByPersonId: owner.id,
          now: new Date(trip.startsAt.getTime() + HOUR_MS),
        });
      }
    }
    // The quiet day dived the same site and logged nothing: it is still a dive
    // here, and it belongs in the denominator.
    await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: quiet.id,
      diveNumber: 1,
      actualSiteId: site.id,
      recordedByPersonId: owner.id,
    });

    const summary = await siteSightingSummary(db, shop.id, site.id, NOW);
    expect(summary?.dives).toBe(3);
    expect(summary?.species).toHaveLength(1);
    expect(summary?.species[0]).toMatchObject({
      speciesSlug: "green-sea-turtle",
      dives: 2,
      total: 3,
    });
    expect(summary?.species[0]?.lastSeenAt.getTime()).toBe(second.startsAt.getTime());
  });

  it("ranks by how many departures saw a thing and cuts the list to three", async () => {
    const { db, shop, owner, site } = await reefFixture();
    const trips3 = [
      await departure(db, shop.id, "One", 5),
      await departure(db, shop.id, "Two", 4),
      await departure(db, shop.id, "Three", 3),
    ];
    const seen = async (trip: (typeof trips3)[number], speciesSlug: string) => {
      await recordTripSighting(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveSiteId: site.id,
        speciesSlug,
        recordedByPersonId: owner.id,
        now: new Date(trip.startsAt.getTime() + HOUR_MS),
      });
    };
    for (const trip of trips3) await seen(trip, "green-sea-turtle");
    await seen(trips3[0], "nurse-shark");
    await seen(trips3[1], "nurse-shark");
    await seen(trips3[0], "spotted-eagle-ray");
    await seen(trips3[2], "queen-angelfish");

    const summary = await siteSightingSummary(db, shop.id, site.id, NOW);
    expect(summary?.species.map((row) => row.speciesSlug)).toEqual([
      "green-sea-turtle",
      "nurse-shark",
      // Two species tie at one departure each; the slug breaks it, so the order
      // is the same on every page load.
      "queen-angelfish",
    ]);
  });

  it("dates a tally to the dive, not to the morning somebody typed it", async () => {
    const { db, shop, owner, site } = await reefFixture();
    const saturday = await departure(db, shop.id, "Saturday", 4);
    // Logged at the next morning's close-out, which is an ordinary way for a
    // crew with no signal on the water to work. The date a diver reads has to
    // be the dive's, or "last seen" is a claim about a keyboard.
    await recordTripSighting(db, {
      shopId: shop.id,
      tripId: saturday.id,
      diveSiteId: site.id,
      speciesSlug: "green-sea-turtle",
      recordedByPersonId: owner.id,
      now: new Date(saturday.startsAt.getTime() + 20 * HOUR_MS),
    });
    const summary = await siteSightingSummary(db, shop.id, site.id, NOW);
    expect(summary?.species[0]?.lastSeenAt.getTime()).toBe(saturday.startsAt.getTime());
  });

  it("forgets a departure by when it sailed, not by when it was typed", async () => {
    const { db, shop, owner, site } = await reefFixture();
    // A dive outside the window, written up inside it. Anchoring on the tap
    // would drag last season's turtle into this month's tally.
    const old = await departure(db, shop.id, "Last season", SIGHTING_WINDOW_DAYS + 5);
    await recordTripSighting(db, {
      shopId: shop.id,
      tripId: old.id,
      diveSiteId: site.id,
      speciesSlug: "green-sea-turtle",
      recordedByPersonId: owner.id,
      now: new Date(NOW.getTime() - HOUR_MS),
    });
    expect(await siteSightingSummary(db, shop.id, site.id, NOW)).toBeNull();
  });

  it("forgets a departure that fell out of the window", async () => {
    const { db, shop, owner, site } = await reefFixture();
    const old = await departure(db, shop.id, "Last season", SIGHTING_WINDOW_DAYS + 5);
    await recordTripSighting(db, {
      shopId: shop.id,
      tripId: old.id,
      diveSiteId: site.id,
      speciesSlug: "green-sea-turtle",
      recordedByPersonId: owner.id,
      now: new Date(old.startsAt.getTime() + HOUR_MS),
    });
    expect(await siteSightingSummary(db, shop.id, site.id, NOW)).toBeNull();
  });

  it("keeps one site's log off another site's answer, and batches both", async () => {
    const { db, shop, owner, site, otherSite } = await reefFixture();
    const trip = await departure(db, shop.id, "Two sites in a day", 2);
    for (const [diveSiteId, speciesSlug] of [
      [site.id, "green-sea-turtle"],
      [otherSite.id, "nurse-shark"],
    ] as const) {
      await recordTripSighting(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveSiteId,
        speciesSlug,
        recordedByPersonId: owner.id,
        now: NOW,
      });
    }
    const answer = await siteSightings(db, shop.id, [site.id, otherSite.id], NOW);
    expect(answer.get(site.id)?.species.map((row) => row.speciesSlug)).toEqual([
      "green-sea-turtle",
    ]);
    expect(answer.get(otherSite.id)?.species.map((row) => row.speciesSlug)).toEqual([
      "nurse-shark",
    ]);
  });

  it("says nothing at all for a site nobody logged", async () => {
    const { db, shop, site } = await reefFixture();
    expect(await siteSightings(db, shop.id, [site.id], NOW).then((map) => map.size)).toBe(0);
    expect(await siteSightings(db, shop.id, [], NOW).then((map) => map.size)).toBe(0);
  });

  it("never lets one shop's reef speak for another's", async () => {
    const { db, shop, owner, site } = await reefFixture();
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-sightings", timezone: "UTC" })
      .returning();
    if (!other) throw new Error("second shop insert failed");
    const trip = await departure(db, shop.id, "Two-tank reef", 2);
    await recordTripSighting(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveSiteId: site.id,
      speciesSlug: "green-sea-turtle",
      recordedByPersonId: owner.id,
      now: NOW,
    });
    // Asked as the other shop, the same site id answers with nothing.
    expect(await siteSightingSummary(db, other.id, site.id, NOW)).toBeNull();
  });
});
