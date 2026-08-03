// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { temperatureUnitFor } from "@/lib/temperature-units";
import { seededShopContext, seededTestDb } from "@/test/db";
import { shops, trips } from "./schema";
import { getShopBySlug, setShopAddress, setShopDepthUnit, setShopTemperatureUnit } from "./shops";

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
