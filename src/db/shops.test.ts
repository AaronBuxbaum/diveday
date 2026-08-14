// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { temperatureUnitFor } from "@/lib/temperature-units";
import { seededShopContext, seededTestDb } from "@/test/db";
import { shops, trips } from "./schema";
import {
  getShopBySlug,
  listShopsForSitemap,
  setShopAddress,
  setShopDepthUnit,
  setShopSearchListing,
  setShopTemperatureUnit,
} from "./shops";
import { createTrip } from "./trips";

describe("shop queries (in-memory PGlite)", () => {
  it("seeds a shop retrievable by slug", async () => {
    const db = await seededTestDb();
    const shop = await getShopBySlug(db, "blue-mantis");
    expect(shop?.name).toBe("Blue Mantis Divers");
    expect(shop?.timezone).toBe("America/New_York");
  });
});

describe("setShopAddress", () => {
  it("sets all five fields", async () => {
    const { db, shop } = await seededShopContext();
    const after = await setShopAddress(db, shop.id, {
      addressStreet: "123 Reef Rd",
      addressLocality: "Key Largo",
      addressRegion: "FL",
      addressPostalCode: "33037",
      addressCountry: "US",
    });
    expect(after?.addressStreet).toBe("123 Reef Rd");
    expect(after?.addressLocality).toBe("Key Largo");
    expect(after?.addressRegion).toBe("FL");
    expect(after?.addressPostalCode).toBe("33037");
    expect(after?.addressCountry).toBe("US");
  });

  it("clears a field back to null on an empty string, independently of the others", async () => {
    const { db, shop } = await seededShopContext();
    await setShopAddress(db, shop.id, {
      addressStreet: "123 Reef Rd",
      addressLocality: "Key Largo",
      addressRegion: "FL",
      addressPostalCode: "33037",
      addressCountry: "US",
    });

    const after = await setShopAddress(db, shop.id, {
      addressStreet: "",
      addressLocality: "Key Largo",
      addressRegion: "FL",
      addressPostalCode: "33037",
      addressCountry: "US",
    });
    expect(after?.addressStreet).toBeNull();
    expect(after?.addressLocality).toBe("Key Largo");
  });

  it("leaves an unfilled address as all null", async () => {
    const db = await seededTestDb();
    const [freshShop] = await db
      .insert(shops)
      .values({ name: "Plain Shop", slug: "plain-shop-address", timezone: "America/New_York" })
      .returning();
    if (!freshShop) throw new Error("setup shop insert failed");
    expect(freshShop.addressStreet).toBeNull();
    expect(freshShop.addressCountry).toBeNull();
  });
});

describe("setShopTemperatureUnit", () => {
  it("defaults a brand-new shop to Celsius", async () => {
    const db = await seededTestDb();
    const [freshShop] = await db
      .insert(shops)
      .values({ name: "Plain Shop", slug: "plain-shop-temperature", timezone: "America/New_York" })
      .returning();
    if (!freshShop) throw new Error("setup shop insert failed");
    expect(freshShop.temperatureUnit).toBe("celsius");
    expect(temperatureUnitFor(freshShop)).toBe("celsius");
  });

  it("stores the shop's chosen unit and reads it back", async () => {
    const { db, shop } = await seededShopContext();
    const after = await setShopTemperatureUnit(db, shop.id, "fahrenheit");
    expect(after?.temperatureUnit).toBe("fahrenheit");
    expect(temperatureUnitFor(await getShopBySlug(db, shop.slug))).toBe("fahrenheit");
  });

  it("is independent of the depth unit — a shop can read feet and Celsius", async () => {
    // The combination the pre-column derivation could not express, and the
    // reason this is its own setting rather than a reading of `depth_unit`.
    const { db, shop } = await seededShopContext();
    await setShopDepthUnit(db, shop.id, "feet");
    const after = await getShopBySlug(db, shop.slug);
    expect(after?.depthUnit).toBe("feet");
    expect(temperatureUnitFor(after)).toBe("celsius");
  });

  it("moves no stored water temperature when the unit flips", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .limit(1);
    if (!trip) throw new Error("seed produced no trip");
    await db.update(trips).set({ waterTemperatureC: 24 }).where(eq(trips.id, trip.id));
    await setShopTemperatureUnit(db, shop.id, "fahrenheit");
    const [after] = await db
      .select({ waterTemperatureC: trips.waterTemperatureC })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(after?.waterTemperatureC).toBe(24);
  });
});

/**
 * Who reaches `sitemap.xml`, and who can leave it
 * (ADR 20260813-search-listing-is-a-choice). Being indexed is the default —
 * a public schedule nobody can find is most of the value gone — but it is
 * disclosed, reversible, and withheld until the shop has published something.
 */
describe("listShopsForSitemap", () => {
  async function shopWithNoDepartures(slug: string, isDemo = false) {
    const db = await seededTestDb();
    const [shop] = await db
      .insert(shops)
      .values({ name: `Shop ${slug}`, slug, timezone: "America/New_York", isDemo })
      .returning();
    if (!shop) throw new Error("test shop insert failed");
    return { db, shop };
  }

  async function scheduleADeparture(db: Awaited<ReturnType<typeof seededTestDb>>, shopId: string) {
    await createTrip(db, {
      shopId,
      title: "First Charter",
      startsAt: new Date("2026-09-01T13:00:00.000Z"),
      endsAt: new Date("2026-09-01T17:00:00.000Z"),
      capacity: 6,
      plannedDives: 2,
    });
  }

  it("holds a brand-new shop out until it has published a departure", async () => {
    const { db, shop } = await shopWithNoDepartures("fresh-shop");
    expect((await listShopsForSitemap(db)).map((row) => row.slug)).not.toContain("fresh-shop");

    await scheduleADeparture(db, shop.id);
    expect((await listShopsForSitemap(db)).map((row) => row.slug)).toContain("fresh-shop");
  });

  it("drops a shop that opts out, and takes it back when it changes its mind", async () => {
    const { db, shop } = await shopWithNoDepartures("shy-shop");
    await scheduleADeparture(db, shop.id);
    expect((await listShopsForSitemap(db)).map((row) => row.slug)).toContain("shy-shop");

    await setShopSearchListing(db, shop.id, false);
    expect((await listShopsForSitemap(db)).map((row) => row.slug)).not.toContain("shy-shop");

    await setShopSearchListing(db, shop.id, true);
    expect((await listShopsForSitemap(db)).map((row) => row.slug)).toContain("shy-shop");
  });

  it("stamps when the shop opted out, and clears the stamp rather than keeping a trail", async () => {
    const { db, shop } = await shopWithNoDepartures("stamped-shop");
    const optedOut = await setShopSearchListing(db, shop.id, false);
    expect(optedOut?.searchListingOptOutAt).toBeInstanceOf(Date);
    const listedAgain = await setShopSearchListing(db, shop.id, true);
    expect(listedAgain?.searchListingOptOutAt).toBeNull();
  });

  it("never lists a demo shop, however much it has scheduled", async () => {
    const { db, shop } = await shopWithNoDepartures("demo-shop", true);
    await scheduleADeparture(db, shop.id);
    expect((await listShopsForSitemap(db)).map((row) => row.slug)).not.toContain("demo-shop");
  });
});
