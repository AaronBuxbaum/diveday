// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { temperatureUnitFor } from "@/lib/temperature-units";
import { seededShopContext, seededTestDb, unseededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import { courses, divePackages, shops, trips } from "./schema";
import {
  getShopBySlug,
  listShopsForSitemap,
  setShopAddress,
  setShopDepthUnit,
  setShopFlySafeHours,
  setShopHospitalityNotes,
  setShopSearchListing,
  setShopTemperatureUnit,
  shopHasPricedRecords,
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

describe("setShopFlySafeHours", () => {
  it("defaults a brand-new shop to 18 and 24 hours", async () => {
    const { shop } = await seededShopContext();
    expect(shop.flySafeHoursSingle).toBe(18);
    expect(shop.flySafeHoursRepetitive).toBe(24);
  });

  it("stores the shop's own pair and reads it back", async () => {
    const { db, shop } = await seededShopContext();
    const after = await setShopFlySafeHours(db, shop.id, { single: 24, repetitive: 36 });
    expect(after?.flySafeHoursSingle).toBe(24);
    expect(after?.flySafeHoursRepetitive).toBe(36);
    const reread = await getShopBySlug(db, shop.slug);
    expect(reread?.flySafeHoursRepetitive).toBe(36);
  });

  it("refuses, at the table, a wait under DAN's floor or a repetitive wait shorter than the single", async () => {
    const { db, shop } = await seededShopContext();
    // Below DAN's 12-hour single-dive minimum: the sentence on the recap
    // attributes the number to DAN's guidance, so the table will not hold it.
    // Drizzle wraps the driver's error, so the constraint's name is on the cause.
    const namesTheConstraint = {
      cause: expect.objectContaining({
        message: expect.stringContaining("shops_fly_safe_hours_in_range"),
      }),
    };
    await expect(
      setShopFlySafeHours(db, shop.id, { single: 6, repetitive: 24 }),
    ).rejects.toMatchObject(namesTheConstraint);
    await expect(
      setShopFlySafeHours(db, shop.id, { single: 30, repetitive: 24 }),
    ).rejects.toMatchObject(namesTheConstraint);
    const untouched = await getShopBySlug(db, shop.slug);
    expect(untouched?.flySafeHoursSingle).toBe(18);
  });
});

/**
 * The shop's three hospitality notes (#1212). Every reader asks `note ? …` —
 * the Ready thread's welcome, `TripArrivalCard`'s dock-call fallback, the
 * after-state's sign-off — so "unset" has to have exactly one shape. A
 * whitespace-only textarea stored as `"   "` is truthy, and each of those three
 * surfaces would then render a blank line where a sentence was promised.
 */
describe("setShopHospitalityNotes", () => {
  it("stores all three and reads them back off the shop", async () => {
    const { db, shop } = await seededShopContext();
    const after = await setShopHospitalityNotes(db, shop.id, {
      welcomeNote: "Glad you are diving with us.",
      dockCallNote: "Park behind the blue shed.",
      signOffNote: "Rinse your gear at the far tap.",
    });
    expect(after?.welcomeNote).toBe("Glad you are diving with us.");
    expect(after?.dockCallNote).toBe("Park behind the blue shed.");
    expect(after?.signOffNote).toBe("Rinse your gear at the far tap.");
    const reread = await getShopBySlug(db, shop.slug);
    expect(reread?.signOffNote).toBe("Rinse your gear at the far tap.");
  });

  it("normalises an empty and a whitespace-only note to null, field by field", async () => {
    const { db, shop } = await seededShopContext();
    await setShopHospitalityNotes(db, shop.id, {
      welcomeNote: "Glad you are diving with us.",
      dockCallNote: "Park behind the blue shed.",
      signOffNote: "Rinse your gear at the far tap.",
    });

    const after = await setShopHospitalityNotes(db, shop.id, {
      welcomeNote: "",
      dockCallNote: "   \n  ",
      signOffNote: "Rinse your gear at the far tap.",
    });
    expect(after?.welcomeNote).toBeNull();
    expect(after?.dockCallNote).toBeNull();
    // Clearing two says nothing about the third.
    expect(after?.signOffNote).toBe("Rinse your gear at the far tap.");
  });

  it("trims what it keeps, so a stray newline never reaches a diver", async () => {
    const { db, shop } = await seededShopContext();
    const after = await setShopHospitalityNotes(db, shop.id, {
      welcomeNote: "  Glad you are diving with us.\n",
      dockCallNote: "",
      signOffNote: "",
    });
    expect(after?.welcomeNote).toBe("Glad you are diving with us.");
  });

  it("leaves a shop that never set them as all null", async () => {
    const { shop } = await seededShopContext();
    expect(shop.welcomeNote).toBeNull();
    expect(shop.dockCallNote).toBeNull();
    expect(shop.signOffNote).toBeNull();
  });

  it("holds 280 characters and refuses the 281st at the table", async () => {
    const { db, shop } = await seededShopContext();
    const full = "a".repeat(280);
    const after = await setShopHospitalityNotes(db, shop.id, {
      welcomeNote: full,
      dockCallNote: "",
      signOffNote: "",
    });
    expect(after?.welcomeNote).toBe(full);

    // The bound is in the database, not only in the form: three short
    // templates, never a freeform brand CMS (schema.ts:415-427).
    await expect(
      setShopHospitalityNotes(db, shop.id, {
        welcomeNote: "",
        dockCallNote: "",
        signOffNote: "b".repeat(281),
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringContaining("shops_hospitality_notes_bounded"),
      }),
    });
    const untouched = await getShopBySlug(db, shop.slug);
    expect(untouched?.welcomeNote).toBe(full);
  });
});
