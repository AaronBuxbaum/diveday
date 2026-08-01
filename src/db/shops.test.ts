// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext, seededTestDb } from "@/test/db";
import { createBooking } from "./bookings";
import { bookings, shops } from "./schema";
import { backfillLegacyNitroxOffering, getShopBySlug, setShopAddress } from "./shops";
import { upcomingTripsWithCounts } from "./trips";

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

describe("backfillLegacyNitroxOffering", () => {
  it("adds nitrox to the catalog for a shop that already priced it", async () => {
    const { db, shop } = await seededShopContext();
    // Simulate a shop that priced nitrox before it existed as a catalog entry:
    // strip "nitrox" back out of the seeded catalog but keep the price.
    await db
      .update(shops)
      .set({ rentalItems: shop.rentalItems.filter((kind) => kind !== "nitrox") })
      .where(eq(shops.id, shop.id));

    await backfillLegacyNitroxOffering(db);

    const after = await getShopBySlug(db, "blue-mantis");
    expect(after?.rentalItems).toContain("nitrox");
  });

  it("adds nitrox to the catalog for a shop with a live nitrox request but no price", async () => {
    const { db, shop } = await seededShopContext();
    await db
      .update(shops)
      .set({
        rentalItems: shop.rentalItems.filter((kind) => kind !== "nitrox"),
        rentalPricing: { ...shop.rentalPricing, nitroxCents: null },
      })
      .where(eq(shops.id, shop.id));
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const trip = trips[0];
    if (!trip) throw new Error("seed: no upcoming trip to book");
    const booking = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Legacy Diver",
      email: "legacy-nitrox@example.com",
    });
    if (!booking.ok) throw new Error("setup booking failed");
    // A request recorded before the write-time gate existed — the thing this
    // backfill exists to reconcile.
    await db.update(bookings).set({ wantsNitrox: true }).where(eq(bookings.id, booking.bookingId));

    await backfillLegacyNitroxOffering(db);

    const after = await getShopBySlug(db, "blue-mantis");
    expect(after?.rentalItems).toContain("nitrox");
  });

  it("leaves a shop untouched when it never priced or requested nitrox", async () => {
    const db = await seededTestDb();
    const [freshShop] = await db
      .insert(shops)
      .values({ name: "Plain Shop", slug: "plain-shop-e2e", timezone: "America/New_York" })
      .returning();
    if (!freshShop) throw new Error("setup shop insert failed");

    await backfillLegacyNitroxOffering(db);

    const after = await getShopBySlug(db, "plain-shop-e2e");
    expect(after?.rentalItems).not.toContain("nitrox");
    expect(after?.rentalItems).toEqual(freshShop.rentalItems);
  });

  it("is idempotent for a shop that already lists nitrox", async () => {
    const { db, shop } = await seededShopContext();
    expect(shop.rentalItems).toContain("nitrox");

    await backfillLegacyNitroxOffering(db);
    await backfillLegacyNitroxOffering(db);

    const after = await getShopBySlug(db, "blue-mantis");
    expect(after?.rentalItems.filter((kind) => kind === "nitrox")).toHaveLength(1);
  });
});
