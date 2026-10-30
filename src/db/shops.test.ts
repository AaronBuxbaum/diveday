// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { temperatureUnitFor } from "@/lib/temperature-units";
import { fileScopedShopContext, seededShopContext, unseededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import { courses, divePackages, shops, trips } from "./schema";
import {
  clearPassedReopensOn,
  getShopBySlug,
  listShopsForDiverPicker,
  listShopsForSitemap,
  setShopAddress,
  setShopCrewLead,
  setShopDepthUnit,
  setShopNitroxFillMethod,
  setShopReopensOn,
  setShopSearchListing,
  setShopTemperatureUnit,
  shopHasPricedRecords,
} from "./shops";
import { createTrip } from "./trips";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

describe("shop queries (in-memory PGlite)", () => {
  it("seeds a shop retrievable by slug", async () => {
    const db = ctx.db;
    const shop = await getShopBySlug(db, "blue-mantis");
    expect(shop?.name).toBe("Blue Mantis Divers");
    expect(shop?.timezone).toBe("America/New_York");
  });
});

describe("setShopAddress", () => {
  it("sets all five fields", async () => {
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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

  it("replaces coordinates too, clearing them when omitted", async () => {
    const { db, shop } = ctx;
    await setShopAddress(db, shop.id, {
      addressStreet: "123 Reef Rd",
      addressLocality: "Key Largo",
      addressRegion: "FL",
      addressPostalCode: "33037",
      addressCountry: "US",
      latitude: 25.0865,
      longitude: -80.4473,
    });

    const after = await setShopAddress(db, shop.id, {
      addressStreet: "123 Reef Rd",
      addressLocality: "Key Largo",
      addressRegion: "FL",
      addressPostalCode: "33037",
      addressCountry: "US",
    });

    expect(after?.latitude).toBeNull();
    expect(after?.longitude).toBeNull();
  });

  it("leaves an unfilled address as all null", async () => {
    const db = ctx.db;
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
    const db = ctx.db;
    const [freshShop] = await db
      .insert(shops)
      .values({ name: "Plain Shop", slug: "plain-shop-temperature", timezone: "America/New_York" })
      .returning();
    if (!freshShop) throw new Error("setup shop insert failed");
    expect(freshShop.temperatureUnit).toBe("celsius");
    expect(temperatureUnitFor(freshShop)).toBe("celsius");
  });

  it("stores the shop's chosen unit and reads it back", async () => {
    const { db, shop } = ctx;
    const after = await setShopTemperatureUnit(db, shop.id, "fahrenheit");
    expect(after?.temperatureUnit).toBe("fahrenheit");
    expect(temperatureUnitFor(await getShopBySlug(db, shop.slug))).toBe("fahrenheit");
  });

  it("is independent of the depth unit — a shop can read feet and Celsius", async () => {
    // The combination the pre-column derivation could not express, and the
    // reason this is its own setting rather than a reading of `depth_unit`.
    const { db, shop } = ctx;
    await setShopTemperatureUnit(db, shop.id, "celsius");
    await setShopDepthUnit(db, shop.id, "feet");
    const after = await getShopBySlug(db, shop.slug);
    expect(after?.depthUnit).toBe("feet");
    expect(temperatureUnitFor(after)).toBe("celsius");
  });

  it("moves no stored water temperature when the unit flips", async () => {
    const { db, shop } = ctx;
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

/** Issue 3004: how the shop fills nitrox, which places Rent out's O2-clean warning. */
describe("setShopNitroxFillMethod", () => {
  it("starts a brand-new shop on blending, so the warning stays on every EANx fill", async () => {
    const [freshShop] = await ctx.db
      .insert(shops)
      .values({ name: "Plain Shop", slug: "plain-shop-nitrox-fill", timezone: "America/New_York" })
      .returning();
    expect(freshShop?.nitroxFillMethod).toBe("blending");
  });

  it("starts the seeded shop on blending", async () => {
    expect((await getShopBySlug(ctx.db, ctx.shop.slug))?.nitroxFillMethod).toBe("blending");
  });

  it("stores the shop's choice and reads it back, for this shop only", async () => {
    const { db, shop } = ctx;
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-nitrox-fill", timezone: "America/New_York" })
      .returning();
    expect((await setShopNitroxFillMethod(db, shop.id, "membrane_premix"))?.nitroxFillMethod).toBe(
      "membrane_premix",
    );
    expect((await getShopBySlug(db, shop.slug))?.nitroxFillMethod).toBe("membrane_premix");
    expect((await getShopBySlug(db, "other-shop-nitrox-fill"))?.nitroxFillMethod).toBe("blending");
    expect(other).toBeDefined();
    await setShopNitroxFillMethod(db, shop.id, "blending");
    expect((await getShopBySlug(db, shop.slug))?.nitroxFillMethod).toBe("blending");
  });
});

/** Ux-delight sheet 2026-10-22, item 2 (H-149): "Crew arrive N minutes before divers". */
describe("setShopCrewLead", () => {
  it("starts a new shop at 30 minutes, and stores or clears the shop's choice", async () => {
    const { db, shop } = ctx;
    const [fresh] = await db
      .insert(shops)
      .values({ name: "Crew Shop", slug: "crew-lead-default", timezone: "America/New_York" })
      .returning();
    expect(fresh?.crewLeadMinutes).toBe(30);
    expect((await setShopCrewLead(db, shop.id, 45))?.crewLeadMinutes).toBe(45);
    expect((await setShopCrewLead(db, shop.id, null))?.crewLeadMinutes).toBeNull();
    expect((await getShopBySlug(db, shop.slug))?.crewLeadMinutes).toBeNull();
  });

  it("is refused by the table outside 5 to 180 minutes", async () => {
    // Each refusal in its own database: the first aborts the transaction it runs in.
    for (const minutes of [0, 181]) {
      const { db, shop } = await seededShopContext();
      await expect(setShopCrewLead(db, shop.id, minutes)).rejects.toThrow();
    }
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
    const db = ctx.db;
    const [shop] = await db
      .insert(shops)
      .values({ name: `Shop ${slug}`, slug, timezone: "America/New_York", isDemo })
      .returning();
    if (!shop) throw new Error("test shop insert failed");
    return { db, shop };
  }

  async function scheduleADeparture(db: AppDb, shopId: string) {
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

/**
 * **The diver's shop picker names exactly the listed shops** (fourth review,
 * item 50). It is a public list DiveDay publishes, so it reads through the same
 * scope as the sitemap: never a demo, never a shop that opted out of search.
 */
describe("listShopsForDiverPicker", () => {
  it("names the sitemap's shops, in name order, with their town", async () => {
    const db = ctx.db;
    const picker = await listShopsForDiverPicker(db);
    expect(picker.map((row) => row.slug).sort()).toEqual(
      (await listShopsForSitemap(db)).map((row) => row.slug).sort(),
    );
    const names = picker.map((row) => row.name);
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(picker.map((row) => row.slug)).not.toContain("blue-mantis");
    expect(picker.find((row) => row.slug === "reef-line-divers")?.locality).toBe("Key Largo");
  });

  it("drops a shop that opted out of search", async () => {
    const db = ctx.db;
    const [shop] = await db.select().from(shops).where(eq(shops.slug, "reef-line-divers"));
    if (!shop) throw new Error("the listed seed shop is missing");
    await setShopSearchListing(db, shop.id, false);
    expect((await listShopsForDiverPicker(db)).map((row) => row.slug)).not.toContain(
      "reef-line-divers",
    );
  });
});

/**
 * **The currency warning is only as good as the places it looks.**
 *
 * `shopHasPricedRecords` decides whether Settings warns a shop that switching
 * currency will silently redenominate every number it has written down (ADR
 * 20260731-shop-currency). The first version asked about priced trips and
 * orders alone — the shape a shop has on day one, and not the shape it has by
 * week two — so a shop that had priced its courses, published a rental price
 * list, built a dive package or taken a deposit but not yet a fun dive was
 * told the switch was free. It had no test of any kind.
 */
describe("shopHasPricedRecords", () => {
  async function bareShop(db: AppDb, slug: string) {
    const [shop] = await db
      .insert(shops)
      .values({ name: "Bare Reef", slug, timezone: "America/New_York" })
      .returning();
    if (!shop) throw new Error("shop insert failed");
    return shop;
  }

  const laterToday = () => new Date(nowDate().getTime() + 30 * 24 * 60 * 60 * 1000);

  async function unpricedTrip(db: AppDb, shopId: string) {
    const startsAt = laterToday();
    const trip = await createTrip(db, {
      shopId,
      title: "Two-tank morning",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 8,
      plannedDives: 2,
    });
    if (!trip) throw new Error("trip insert failed");
    return trip;
  }

  it("says no for a shop that has not priced anything", async () => {
    const db = await unseededTestDb();
    const shop = await bareShop(db, "bare-nothing");
    // A departure on the board with no price on it is still free to switch:
    // there is no number in the old currency to redenominate.
    await unpricedTrip(db, shop.id);
    expect(await shopHasPricedRecords(db, shop.id)).toBe(false);
  });

  it("says yes for a priced departure", async () => {
    const db = await unseededTestDb();
    const shop = await bareShop(db, "bare-trip");
    const trip = await unpricedTrip(db, shop.id);
    await db.update(trips).set({ priceCents: 9500 }).where(eq(trips.id, trip.id));
    expect(await shopHasPricedRecords(db, shop.id)).toBe(true);
  });

  it("says yes for a deposit on an otherwise unpriced departure", async () => {
    const db = await unseededTestDb();
    const shop = await bareShop(db, "bare-deposit");
    const trip = await unpricedTrip(db, shop.id);
    await db.update(trips).set({ depositCents: 2500 }).where(eq(trips.id, trip.id));
    expect(await shopHasPricedRecords(db, shop.id)).toBe(true);
  });

  it("says yes for a priced course, and for one nobody is selling right now", async () => {
    const db = await unseededTestDb();
    const shop = await bareShop(db, "bare-course");
    const [course] = await db
      .insert(courses)
      .values({
        shopId: shop.id,
        slug: "open-water",
        title: "Open Water",
        priceCents: 45000,
        isActive: false,
      })
      .returning();
    if (!course) throw new Error("course insert failed");
    expect(await shopHasPricedRecords(db, shop.id)).toBe(true);
  });

  it("says yes for a course priced only for its e-learning half", async () => {
    const db = await unseededTestDb();
    const shop = await bareShop(db, "bare-elearning");
    await db.insert(courses).values({
      shopId: shop.id,
      slug: "open-water-elearning",
      title: "Open Water",
      eLearningPriceCents: 12000,
    });
    expect(await shopHasPricedRecords(db, shop.id)).toBe(true);
  });

  it("says yes for a dive package", async () => {
    const db = await unseededTestDb();
    const shop = await bareShop(db, "bare-package");
    await db
      .insert(divePackages)
      .values({ shopId: shop.id, name: "Ten-dive package", diveCount: 10, priceCents: 40000 });
    expect(await shopHasPricedRecords(db, shop.id)).toBe(true);
  });

  it.each([
    ["a set price for the core kit", { setCents: 3500, perItemCents: {}, nitroxCents: null }],
    ["one per-piece price", { setCents: null, perItemCents: { bcd: 1200 }, nitroxCents: null }],
    ["a nitrox surcharge", { setCents: null, perItemCents: {}, nitroxCents: 1000 }],
  ])("says yes for a rental price list carrying %s", async (_label, rentalPricing) => {
    const db = await unseededTestDb();
    const shop = await bareShop(db, `bare-rental-${_label.replace(/\W+/g, "-")}`);
    await db.update(shops).set({ rentalPricing }).where(eq(shops.id, shop.id));
    expect(await shopHasPricedRecords(db, shop.id)).toBe(true);
  });

  it("never answers for another shop's prices", async () => {
    const db = await unseededTestDb();
    const bare = await bareShop(db, "bare-isolated");
    const rival = await bareShop(db, "rival-priced");
    const trip = await unpricedTrip(db, rival.id);
    await db.update(trips).set({ priceCents: 9500 }).where(eq(trips.id, trip.id));
    await db
      .insert(divePackages)
      .values({ shopId: rival.id, name: "Ten dives", diveCount: 10, priceCents: 40000 });
    expect(await shopHasPricedRecords(db, bare.id)).toBe(false);
  });
});

describe("clearPassedReopensOn", () => {
  it("clears a date before the shop's own today and keeps today and later", async () => {
    const { db, shop } = ctx;
    // 2030-06-02 01:00 UTC is still 1 June in New York (the shop's zone).
    const now = new Date("2030-06-02T01:00:00.000Z");
    await setShopReopensOn(db, shop.id, "2030-05-31");
    expect(await clearPassedReopensOn(db, now)).toBe(1);
    expect((await getShopBySlug(db, shop.slug))?.reopensOn).toBeNull();

    // The day itself is not passed yet.
    await setShopReopensOn(db, shop.id, "2030-06-01");
    expect(await clearPassedReopensOn(db, now)).toBe(0);
    expect((await getShopBySlug(db, shop.slug))?.reopensOn).toBe("2030-06-01");

    await setShopReopensOn(db, shop.id, "2031-01-15");
    expect(await clearPassedReopensOn(db, now)).toBe(0);
  });

  it("leaves a shop with no date alone", async () => {
    const { db, shop } = ctx;
    await setShopReopensOn(db, shop.id, null);
    expect(await clearPassedReopensOn(db, new Date("2030-06-02T01:00:00.000Z"))).toBe(0);
  });
});
