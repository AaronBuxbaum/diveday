import { and, eq, ilike, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { courses, diveSites, gearItems, orders, people, shops, trips } from "./schema";
import { searchShop } from "./search";

describe("searchShop", () => {
  it("finds a diver by a case-insensitive substring of their name, email, or phone", async () => {
    const { db, shop } = await seededShopContext();

    const byName = await searchShop(db, shop.id, "priya", "America/New_York", "en-US");
    expect(byName.divers.map((d) => d.fullName)).toContain("Priya Sharma");

    const byNameSubstring = await searchShop(db, shop.id, "SHARMA", "America/New_York", "en-US");
    expect(byNameSubstring.divers.map((d) => d.fullName)).toContain("Priya Sharma");
  });

  /**
   * **The tag is what a wet hand reaches for.** `gear_items.label` carries a
   * schema comment saying so in as many words — and it was the one identifier
   * the shop's own search box could not find, because `searchShop` queried five
   * tables and gear was not among them (issue #719).
   */
  it("finds a gear unit by its tag, its serial and its brand, with the status", async () => {
    const { db, shop } = await seededShopContext();
    const [unit] = await db
      .insert(gearItems)
      .values({
        shopId: shop.id,
        label: "REG-07",
        kind: "regulator",
        brandModel: "Scubapro MK25",
        serialNumber: "SP-99814",
        status: "needs_service",
      })
      .returning();
    if (!unit) throw new Error("gear insert returned no row");

    const byTag = await searchShop(db, shop.id, "REG-07", "America/New_York", "en-US");
    expect(byTag.gear.map((g) => g.id)).toContain(unit.id);
    // The status rides along as a *code* — this module returns codes and the
    // palette picks the words — because finding the unit and learning it is out
    // for service in the same glance is the whole value of the row.
    expect(byTag.gear[0]?.status).toBe("needs_service");
    expect(byTag.gear[0]?.detail).toBe("SP-99814");

    // The field you reach for when a manufacturer issues a recall.
    const bySerial = await searchShop(db, shop.id, "99814", "America/New_York", "en-US");
    expect(bySerial.gear.map((g) => g.id)).toContain(unit.id);

    const byBrand = await searchShop(db, shop.id, "scubapro", "America/New_York", "en-US");
    expect(byBrand.gear.map((g) => g.id)).toContain(unit.id);
  });

  it("shows no gear group for a shop that has never used the register", async () => {
    // Opt-in **by presence** (ADR 20260815-minimal-gear-register): zero rows
    // means no gear UI anywhere, and an empty heading in the palette would be
    // the register announcing itself to a shop that never asked for it. A shop
    // of its own, because the seeded one *does* run a register — asserting this
    // against blue-mantis would pass only while nothing there matched.
    const { db } = await seededShopContext();
    const [fresh] = await db
      .insert(shops)
      .values({ name: "No Gear Divers", slug: "no-gear-divers", timezone: "America/New_York" })
      .returning();
    if (!fresh) throw new Error("shop insert returned no row");

    const result = await searchShop(db, fresh.id, "reg", "America/New_York", "en-US");
    expect(result.gear).toEqual([]);
  });

  it("does not surface a deleted unit", async () => {
    const { db, shop } = await seededShopContext();
    await db.insert(gearItems).values({
      shopId: shop.id,
      label: "BCD #14",
      kind: "bcd",
      deletedAt: new Date("2026-07-01T00:00:00.000Z"),
    });

    const result = await searchShop(db, shop.id, "BCD #14", "America/New_York", "en-US");
    expect(result.gear).toEqual([]);
  });

  /**
   * **Digits to digits.** `people.phone` is free text — the seed holds
   * `"+1 305 555 0142"` — so a staffer typing what caller ID showed them
   * matched nothing at all (issue #719).
   */
  it("finds a diver by the bare digits of a formatted phone number", async () => {
    const { db, shop } = await seededShopContext();
    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Caller Id", phone: "+1 (305) 555-0199" })
      .returning();
    if (!person) throw new Error("person insert returned no row");

    const asTyped = await searchShop(db, shop.id, "3055550199", "America/New_York", "en-US");
    expect(asTyped.divers.map((d) => d.id)).toContain(person.id);

    // The formatted form still works — the raw `ilike` is the indexed one this
    // module is built around, and it was kept rather than replaced.
    const asStored = await searchShop(db, shop.id, "(305) 555-0199", "America/New_York", "en-US");
    expect(asStored.divers.map((d) => d.id)).toContain(person.id);
  });

  it("does not treat a short ordinary query as a phone number", async () => {
    // The digit floor: "pr" must not drag every phone column through a
    // normalising scan, and a name query must still answer as a name query.
    const { db, shop } = await seededShopContext();
    const result = await searchShop(db, shop.id, "priya", "America/New_York", "en-US");
    expect(result.divers.map((d) => d.fullName)).toContain("Priya Sharma");
  });

  /**
   * **Where the floor actually is.** The test above searches `"priya"` — zero
   * digits — so it passes identically at every possible value of
   * `MIN_PHONE_SEARCH_DIGITS`, which makes it a test of the *name* path and not
   * of the floor at all. This pins the boundary from both sides with a query
   * that can only be answered digit-wise: `8877` is not a substring of
   * `"+1 (999) 888-7766"` (the dash is in the way), only of its digits.
   */
  it("switches to digit matching at the floor and not below it", async () => {
    const { db, shop } = await seededShopContext();
    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Floor Case", phone: "+1 (999) 888-7766" })
      .returning();
    if (!person) throw new Error("person insert returned no row");

    const atFloor = await searchShop(db, shop.id, "8877", "America/New_York", "en-US");
    expect(atFloor.divers.map((d) => d.id)).toContain(person.id);

    const belowFloor = await searchShop(db, shop.id, "877", "America/New_York", "en-US");
    expect(belowFloor.divers.map((d) => d.id)).not.toContain(person.id);
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
    expect(result).toEqual({
      divers: [],
      trips: [],
      diveSites: [],
      courses: [],
      orders: [],
      gear: [],
    });
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
      // The shop's own gear, by the tag written on the unit (issue #719).
      "gear_items_brand_model_trgm_idx",
      "gear_items_label_trgm_idx",
      "gear_items_serial_trgm_idx",
      "orders_description_trgm_idx",
      "people_email_trgm_idx",
      "people_full_name_trgm_idx",
      // `people.phone` twice: as stored, and with its punctuation stripped, so
      // a staffer typing the digits off a caller ID is still an index lookup
      // rather than a sequential scan.
      "people_phone_digits_trgm_idx",
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
