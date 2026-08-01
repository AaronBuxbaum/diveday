// @vitest-environment node
import { describe, expect, it } from "vitest";
import { seededShopContext, seededTestDb } from "@/test/db";
import { shops } from "./schema";
import { getShopBySlug, setShopAddress } from "./shops";

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
