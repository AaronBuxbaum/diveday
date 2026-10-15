import { and, asc, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { diveSites, executedDives, trips } from "@/db/schema";
import { staffTranslator } from "@/i18n/staff-messages";
import { fileScopedShopContext } from "@/test/db";
import { detailsReadRows } from "./details-rows";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();
const t = staffTranslator("en-US");

/** Fifth-loop ideas, item 6: Details says what each planned site was like last time. */
describe("detailsReadRows (in-memory PGlite)", () => {
  it("says the last dive on a planned site in one Last time row, and reads nothing off Details", async () => {
    const { db, shop } = ctx;
    const [earlier, later] = await db
      .select({ id: trips.id, startsAt: trips.startsAt })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), isNull(trips.deletedAt)))
      .orderBy(asc(trips.startsAt), asc(trips.id))
      .limit(2);
    const [site] = await db
      .select({ id: diveSites.id, name: diveSites.name })
      .from(diveSites)
      .where(eq(diveSites.shopId, shop.id))
      .orderBy(asc(diveSites.name))
      .limit(1);
    if (!earlier || !later || !site) throw new Error("demo trips or sites missing");
    await db.delete(executedDives).where(eq(executedDives.tripId, earlier.id));
    await db.insert(executedDives).values({
      shopId: shop.id,
      tripId: earlier.id,
      diveNumber: 1,
      actualSiteId: site.id,
      observedConditions: { visibility: "40 ft" },
    });
    const overview = { trip: later, diveSites: { sites: [site] } };
    const rows = await detailsReadRows({ db, shop, overview, t, locale: "en-US", shown: true });
    const history = rows.find((row) => row.id === "site-history");
    expect(history?.label).toBe("Last time");
    expect(history?.value).toContain(`${site.name}: last dived`);
    expect(history?.value).toContain("visibility 40 ft");
    expect(await detailsReadRows({ db, shop, overview, t, locale: "en-US", shown: false })).toEqual(
      [],
    );
  });
});
