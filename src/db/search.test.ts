// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { people, shops, trips } from "./schema";
import { searchShop } from "./search";

describe("searchShop", () => {
  it("finds a diver by a case-insensitive substring of their name, email, or phone", async () => {
    const { db, shop } = await seededShopContext();

    const byName = await searchShop(db, shop.id, "priya", "America/New_York");
    expect(byName.divers.map((d) => d.fullName)).toContain("Priya Sharma");

    const byNameSubstring = await searchShop(db, shop.id, "SHARMA", "America/New_York");
    expect(byNameSubstring.divers.map((d) => d.fullName)).toContain("Priya Sharma");
  });

  it("finds a trip by a substring of its title", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await db.select().from(trips).where(eq(trips.shopId, shop.id)).limit(1);
    if (!trip) throw new Error("seed trip missing");

    const result = await searchShop(db, shop.id, trip.title.slice(2, 8), "America/New_York");
    expect(result.trips.map((t) => t.id)).toContain(trip.id);
  });

  it("never returns another shop's people, even when both have a same-named diver", async () => {
    const { db, shop } = await seededShopContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Second Shop", slug: "second-shop", timezone: "America/New_York" })
      .returning();
    if (!otherShop) throw new Error("insert failed");
    const [otherPriya] = await db
      .insert(people)
      .values({ shopId: otherShop.id, fullName: "Priya Sharma", email: "priya@second.example" })
      .returning();
    if (!otherPriya) throw new Error("insert failed");

    const resultForShop = await searchShop(db, shop.id, "priya", "America/New_York");
    expect(resultForShop.divers.map((d) => d.id)).not.toContain(otherPriya.id);

    const resultForOtherShop = await searchShop(db, otherShop.id, "priya", "America/New_York");
    expect(resultForOtherShop.divers.map((d) => d.id)).toEqual([otherPriya.id]);
  });

  it("returns nothing for a below-minimum-length query", async () => {
    const { db, shop } = await seededShopContext();
    const result = await searchShop(db, shop.id, "p", "America/New_York");
    expect(result).toEqual({ divers: [], trips: [] });
  });
});

describe("CR-018 trigram search indexes", () => {
  it("creates a GIN trigram index for every leading-wildcard ILIKE search column", async () => {
    const { db } = await seededShopContext();
    const rows = await db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where indexname like '%_trgm_idx' order by indexname`,
    );
    const names = rows.rows.map((row) => row.indexname);
    expect(names).toEqual([
      "dive_sites_name_trgm_idx",
      "people_email_trgm_idx",
      "people_full_name_trgm_idx",
      "people_phone_trgm_idx",
      "trips_title_trgm_idx",
    ]);
  });

  it("has the pg_trgm extension available", async () => {
    const { db } = await seededShopContext();
    const rows = await db.execute<{ extname: string }>(
      sql`select extname from pg_extension where extname = 'pg_trgm'`,
    );
    expect(rows.rows).toHaveLength(1);
  });
});
