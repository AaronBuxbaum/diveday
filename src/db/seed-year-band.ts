import { eq } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { diveSiteSlugFrom } from "@/lib/dive-site-slug";
import type { DbExecutor } from "./client";
import { bookings, diveSites, people, shops, tripDives, trips } from "./schema";
import { at, DEMO_SHOP_TIMEZONE } from "./seed-clock";
import { deleteDemoShopCascade } from "./seed-demo-lifecycle";

/**
 * **A real shop with a real year, for DiveDay's homepage band** (ADR
 * 20260908-one-hand, decision 6, lever T).
 *
 * The band and the public year card both refuse an `isDemo` tenant — a demo's
 * shop name, boats and sites are typed by whichever visitor minted it, and the
 * band prints them on dive.day under a sentence vouching for them (security
 * review, finding 1). So the fixture that exercises the band cannot be the
 * `privateShop` mint: it has to be a shop of the kind the band is *for*.
 *
 * This is that shop, and it is deliberately thin — no staff, no logins, no
 * money, no history beyond the departures the year counts. Nothing signs into
 * it. It is **out of search** (`searchListingOptOutAt`) so it joins no sitemap,
 * no regional page and no public list; the band reads the switch, not the
 * listing, so that costs the fixture nothing and keeps it out of every other
 * page's baseline.
 *
 * Seeded and dropped through `/api/test/seed-year-band-shop`, and dropped again
 * by `/api/test/reset` before every test, so a run that dies between the two
 * cannot leave a band standing in the next spec's homepage.
 *
 * Every number below is fixed relative to the fleet's frozen clock, so the card
 * and the band draw the same pixels on every run.
 */

/** Fixed, because the shop's name is on the card and in the claim beside it. */
export const YEAR_BAND_SHOP_SLUG = "tern-rock-dive-club";
const YEAR_BAND_SHOP_NAME = "Tern Rock Dive Club";

/** Weekly departures, back through roughly half a year. */
const DEPARTURES = 26;
const CAPACITY = 12;
/** How full each boat was, cycled — enough to draw all three levels of water. */
const DIVERS_PER_DEPARTURE = [4, 6, 8, 10, 12] as const;

export async function seedYearBandShop(
  db: DbExecutor,
  now: Date = nowDate(),
): Promise<{ slug: string; name: string }> {
  // Idempotent: a run that died before its teardown leaves the shop behind, and
  // the next seed has to be able to start from the same place either way.
  await dropYearBandShop(db);

  const [shop] = await db
    .insert(shops)
    .values({
      name: YEAR_BAND_SHOP_NAME,
      slug: YEAR_BAND_SHOP_SLUG,
      timezone: DEMO_SHOP_TIMEZONE,
      isDemo: false,
      brandColor: "#1d7a5f",
      showYearOnDiveday: true,
      searchListingOptOutAt: now,
      unitsConfirmedAt: at(-200, 9),
    })
    .returning({ id: shops.id });
  if (!shop) throw new Error("seedYearBandShop: shop did not insert");

  const [molasses, benwood] = await db
    .insert(diveSites)
    .values([
      { shopId: shop.id, name: "Molasses Reef", slug: diveSiteSlugFrom("Molasses Reef") },
      { shopId: shop.id, name: "Benwood", slug: diveSiteSlugFrom("Benwood") },
    ])
    .returning({ id: diveSites.id });
  if (!molasses || !benwood) throw new Error("seedYearBandShop: dive sites did not insert");

  // One cast of divers, reused across the departures: the year counts boarded
  // bookings, and twelve people is enough to fill the biggest boat.
  const cast = await db
    .insert(people)
    .values(
      Array.from({ length: CAPACITY }, (_, index) => ({
        shopId: shop.id,
        fullName: `Year Diver ${index + 1}`,
      })),
    )
    .returning({ id: people.id });

  for (let index = 0; index < DEPARTURES; index += 1) {
    // Whole weeks back from the frozen instant, so every departure has sailed
    // and the spread of them is the same on every run.
    const startsAt = new Date(now.getTime() - (index * 7 + 1) * 86_400_000);
    const [trip] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Two-Tank Reef",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
        capacity: CAPACITY,
      })
      .returning({ id: trips.id });
    if (!trip) throw new Error("seedYearBandShop: trip did not insert");

    const aboard = DIVERS_PER_DEPARTURE[index % DIVERS_PER_DEPARTURE.length];
    await db.insert(bookings).values(
      cast.slice(0, aboard).map((person) => ({
        shopId: shop.id,
        tripId: trip.id,
        personId: person.id,
        status: "checked_in" as const,
      })),
    );

    // Molasses on every day out, Benwood on every other one, so the sites
    // ledger has two rows and a bar with something to measure against.
    await db.insert(tripDives).values(
      index % 2 === 0
        ? [
            { tripId: trip.id, diveNumber: 1, diveSiteId: molasses.id },
            { tripId: trip.id, diveNumber: 2, diveSiteId: benwood.id },
          ]
        : [{ tripId: trip.id, diveNumber: 1, diveSiteId: molasses.id }],
    );
  }

  return { slug: YEAR_BAND_SHOP_SLUG, name: YEAR_BAND_SHOP_NAME };
}

/** Drops the fixture. Answers whether there was one, and never touches anything else. */
export async function dropYearBandShop(db: DbExecutor): Promise<boolean> {
  const [shop] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.slug, YEAR_BAND_SHOP_SLUG))
    .limit(1);
  if (!shop) return false;
  await deleteDemoShopCascade(db, shop.id);
  return true;
}
