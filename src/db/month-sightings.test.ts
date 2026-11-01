import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import { MIN_MONTH_TRIPS } from "@/lib/month-sightings";
import { fileScopedShopContext } from "@/test/db";
import { upsertExecutedDive } from "./executed-dives";
import { monthSightings } from "./month-sightings";
import {
  diveSites,
  executedDives,
  people,
  personRoles,
  shops,
  tripSightings,
  trips,
} from "./schema";
import { createTrip } from "./trips";

/**
 * **"What you might see in March"** (batch 4, K4), read against a real
 * database: past Marches only, the shop's own clock, an honest denominator,
 * and silence below the evidence threshold.
 */

const ctx = fileScopedShopContext();

/** Mid-March on the shop's clock, in a year after every fixture below. */
const NOW = new Date("2031-03-15T15:00:00Z");

async function fixture() {
  const { db, shop } = ctx;
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  const [site] = await db
    .select({ id: diveSites.id, name: diveSites.name })
    .from(diveSites)
    .where(eq(diveSites.shopId, shop.id))
    .limit(1);
  if (!owner || !site) throw new Error("fixture needs an owner and a site");
  // The seed logs a month of its own; these tests count from an empty log.
  await db.delete(tripSightings).where(eq(tripSightings.shopId, shop.id));
  await db.delete(executedDives).where(eq(executedDives.shopId, shop.id));
  return { db, shop, owner, site };
}

/** A departure on `startsAt` whose crew logged `species` (none: it logged nothing). */
async function marchDeparture(
  f: Awaited<ReturnType<typeof fixture>>,
  startsAt: Date,
  species: string[],
  options: { rehearsal?: boolean; private?: boolean } = {},
) {
  const trip = await createTrip(f.db, {
    shopId: f.shop.id,
    title: "March reef",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
    capacity: 6,
    dives: [{ diveSiteId: f.site.id }],
    isRehearsal: options.rehearsal,
    isPrivate: options.private,
  });
  if (!trip) throw new Error("trip not created");
  for (const slug of species) {
    await f.db.insert(tripSightings).values({
      shopId: f.shop.id,
      tripId: trip.id,
      diveSiteId: f.site.id,
      diveSiteName: f.site.name,
      speciesSlug: slug,
      count: 1,
      recordedByPersonId: f.owner.id,
    });
  }
  return trip;
}

/** Noon UTC on the given March day of `year`: March on any shop clock. */
function march(year: number, day: number) {
  return new Date(Date.UTC(year, 2, day, 12));
}

describe("monthSightings", () => {
  it("stays silent with fewer recorded March departures than the threshold", async () => {
    const f = await fixture();
    for (let index = 0; index < MIN_MONTH_TRIPS - 1; index += 1) {
      await marchDeparture(f, march(2029, index + 1), ["green-sea-turtle"]);
    }
    expect(await monthSightings(f.db, f.shop.id, "America/New_York", NOW)).toBeNull();
  });

  it("counts March departures across seasons, as a frequency over recorded departures", async () => {
    const f = await fixture();
    // Five Marches in 2029 and four in 2030: nine recorded March departures.
    for (let index = 0; index < 5; index += 1) {
      await marchDeparture(
        f,
        march(2029, index + 1),
        index < 3 ? ["green-sea-turtle"] : ["southern-stingray"],
      );
    }
    for (let index = 0; index < 4; index += 1) {
      await marchDeparture(f, march(2030, index + 1), ["green-sea-turtle"]);
    }
    const answer = await monthSightings(f.db, f.shop.id, "America/New_York", NOW);
    expect(answer).toEqual({
      month: 3,
      trips: 9,
      species: [
        { speciesSlug: "green-sea-turtle", trips: 7 },
        { speciesSlug: "southern-stingray", trips: 2 },
      ],
    });
  });

  it("leaves out other months, departures that have not left, rehearsals and charters", async () => {
    const f = await fixture();
    for (let index = 0; index < MIN_MONTH_TRIPS; index += 1) {
      await marchDeparture(f, march(2029, index + 1), ["green-sea-turtle"]);
    }
    // An April departure, a March departure still to come, and a rehearsal.
    await marchDeparture(f, new Date(Date.UTC(2029, 3, 10, 12)), ["whale-shark"]);
    await marchDeparture(f, new Date(Date.UTC(2029, 3, 11, 12)), ["whale-shark"]);
    await marchDeparture(f, march(2031, 28), ["whale-shark"]);
    await marchDeparture(f, march(2031, 29), ["whale-shark"]);
    await marchDeparture(f, march(2030, 2), ["whale-shark"], { rehearsal: true });
    await marchDeparture(f, march(2030, 3), ["whale-shark"], { rehearsal: true });
    // A private charter is the client's day, not the storefront's.
    await marchDeparture(f, march(2030, 4), ["whale-shark"], { private: true });
    await marchDeparture(f, march(2030, 5), ["whale-shark"], { private: true });
    const answer = await monthSightings(f.db, f.shop.id, "America/New_York", NOW);
    expect(answer?.trips).toBe(MIN_MONTH_TRIPS);
    expect(answer?.species.map((tally) => tally.speciesSlug)).toEqual(["green-sea-turtle"]);
  });

  it("reads the month on the shop's clock", async () => {
    const f = await fixture();
    // 03:00 UTC on 1 April is still 31 March in New York.
    for (let index = 0; index < MIN_MONTH_TRIPS; index += 1) {
      await marchDeparture(f, new Date(Date.UTC(2029 - index, 3, 1, 3)), ["green-sea-turtle"]);
    }
    const answer = await monthSightings(f.db, f.shop.id, "America/New_York", NOW);
    expect(answer?.trips).toBe(MIN_MONTH_TRIPS);
    const utc = await monthSightings(f.db, f.shop.id, "UTC", NOW);
    expect(utc).toBeNull();
  });

  it("ignores a deleted departure", async () => {
    const f = await fixture();
    const created = [];
    for (let index = 0; index < MIN_MONTH_TRIPS; index += 1) {
      created.push(await marchDeparture(f, march(2029, index + 1), ["green-sea-turtle"]));
    }
    await f.db.update(trips).set({ deletedAt: NOW }).where(eq(trips.id, created[0].id));
    expect(await monthSightings(f.db, f.shop.id, "America/New_York", NOW)).toBeNull();
  });

  it("does not let another shop's query read these logged and tapped departures", async () => {
    const f = await fixture();
    const [other] = await f.db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-month-sightings", timezone: "UTC" })
      .returning();
    if (!other) throw new Error("second shop insert failed");

    for (let index = 0; index < MIN_MONTH_TRIPS; index += 1) {
      const trip = await marchDeparture(f, march(2029, index + 1), ["green-sea-turtle"]);
      await upsertExecutedDive(f.db, {
        shopId: f.shop.id,
        tripId: trip.id,
        diveNumber: 1,
        actualSiteId: f.site.id,
        recordedByPersonId: f.owner.id,
      });
    }

    const own = await monthSightings(f.db, f.shop.id, "America/New_York", NOW);
    expect(own?.trips).toBe(MIN_MONTH_TRIPS);
    expect(own?.species).toEqual([{ speciesSlug: "green-sea-turtle", trips: MIN_MONTH_TRIPS }]);
    expect(await monthSightings(f.db, other.id, "America/New_York", NOW)).toBeNull();
  });
});
