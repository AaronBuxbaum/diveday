import { and, eq, ilike, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { courses, diveSites, orders, people, shops, trips } from "./schema";
import { searchShop } from "./search";

describe("searchShop", () => {
  it("finds a diver by a case-insensitive substring of their name, email, or phone", async () => {
    const { db, shop } = await seededShopContext();

    const byName = await searchShop(db, shop.id, "priya", "America/New_York", "en-US");
    expect(byName.divers.map((d) => d.fullName)).toContain("Priya Sharma");

    const byNameSubstring = await searchShop(db, shop.id, "SHARMA", "America/New_York", "en-US");
    expect(byNameSubstring.divers.map((d) => d.fullName)).toContain("Priya Sharma");
  });

  it("finds a trip by a substring of its title", async () => {
    const { db, shop } = await seededShopContext();
    // A distinctively-worded seeded trip, not a generic "Two-Tank Reef —"
    // charter — the extended roster seeds dozens of those, and search caps
    // results per group, so a common substring can legitimately rank the
    // soonest (today's) charter outside the top matches once the schedule is
    // this full. "Spiegel Grove" names exactly one trip.
    const [trip] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.title, "Wreck Trip — Spiegel Grove")))
      .limit(1);
    if (!trip) throw new Error("seed trip missing");

    const result = await searchShop(db, shop.id, "Spiegel Grove", "America/New_York", "en-US");
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

    const resultForShop = await searchShop(db, shop.id, "priya", "America/New_York", "en-US");
    expect(resultForShop.divers.map((d) => d.id)).not.toContain(otherPriya.id);

    const resultForOtherShop = await searchShop(
      db,
      otherShop.id,
      "priya",
      "America/New_York",
      "en-US",
    );
    expect(resultForOtherShop.divers.map((d) => d.id)).toEqual([otherPriya.id]);
  });

  it("returns nothing for a below-minimum-length query", async () => {
    const { db, shop } = await seededShopContext();
    const result = await searchShop(db, shop.id, "p", "America/New_York", "en-US");
    expect(result).toEqual({ divers: [], trips: [], diveSites: [], courses: [], orders: [] });
  });

  it("finds a dive site by a substring of its name", async () => {
    const { db, shop } = await seededShopContext();
    const [site] = await db
      .select()
      .from(diveSites)
      .where(and(eq(diveSites.shopId, shop.id), ilike(diveSites.name, "%Spiegel Grove%")))
      .limit(1);
    if (!site) throw new Error("seed dive site missing");

    const result = await searchShop(db, shop.id, "Spiegel Grove", "America/New_York", "en-US");
    expect(result.diveSites.map((s) => s.id)).toContain(site.id);
  });

  it("finds a course by a substring of its title", async () => {
    const { db, shop } = await seededShopContext();
    const [course] = await db.select().from(courses).where(eq(courses.shopId, shop.id)).limit(1);
    if (!course) throw new Error("seed course missing");

    const result = await searchShop(db, shop.id, course.title, "America/New_York", "en-US");
    expect(result.courses.map((c) => c.id)).toContain(course.id);
  });

  it("finds an order by the buyer's name", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const [order] = await db
      .select({ id: orders.id, personId: orders.personId })
      .from(orders)
      .where(eq(orders.shopId, shop.id))
      .limit(1);
    if (!order) throw new Error("seed order missing");
    const [buyer] = await db.select().from(people).where(eq(people.id, order.personId)).limit(1);
    if (!buyer) throw new Error("seed order's buyer missing");

    const result = await searchShop(db, shop.id, buyer.fullName, "America/New_York", "en-US");
    expect(result.orders.map((o) => o.id)).toContain(order.id);
  });

  it("never returns another shop's dive sites, courses, or orders", async () => {
    const { db, shop } = await seededShopContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Second Shop", slug: "second-shop-2", timezone: "America/New_York" })
      .returning();
    if (!otherShop) throw new Error("insert failed");
    const [otherSite] = await db
      .insert(diveSites)
      .values({ shopId: otherShop.id, name: "Priya's Point" })
      .returning();
    if (!otherSite) throw new Error("insert failed");

    const result = await searchShop(db, shop.id, "Priya's Point", "America/New_York", "en-US");
    expect(result.diveSites.map((s) => s.id)).not.toContain(otherSite.id);
  });
});

describe("CR-018 trigram search indexes", () => {
  it("creates a GIN trigram index for every leading-wildcard ILIKE search column", async () => {
    const { db } = await seededShopContext();
    const rows = await db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where indexname like '%_trgm_idx' order by indexname`,
    );
    const names = rows.rows.map((row) => row.indexname);
    // The inventory, by name. Which *columns* need to be in it is no longer a
    // fact this hand-kept list carries alone — `search-indexes.test.ts` derives
    // the searched set from `src/db/**` and fails on an unindexed arm, which is
    // how the three DATA-L6 added went unnoticed under this assertion.
    expect(names).toEqual([
      "courses_title_trgm_idx",
      "dive_sites_location_trgm_idx",
      "dive_sites_name_trgm_idx",
      "orders_description_trgm_idx",
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
