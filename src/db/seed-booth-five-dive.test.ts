import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { certifications, courses, diveSites, executedDives, trips } from "./schema";
import { SHOP_CERTIFIED_TITLE } from "./seed-booth";

const ctx = fileScopedShopContext({ history: true });

describe("the booth's shop-issued Advanced Open Water weekend", () => {
  it("records five adventure dives, including a deep dive on the Duane, before issuing the cards", async () => {
    const { db, shop } = ctx;
    const [session] = await db
      .select({
        id: trips.id,
        plannedDives: trips.plannedDives,
        boatId: trips.boatId,
        certifiesLevel: courses.certifiesLevel,
      })
      .from(trips)
      .innerJoin(courses, eq(courses.id, trips.courseId))
      .where(and(eq(trips.shopId, shop.id), eq(trips.title, SHOP_CERTIFIED_TITLE)))
      .limit(1);
    expect(session).toMatchObject({ plannedDives: 5, certifiesLevel: "advanced_open_water" });
    if (!session) throw new Error("shop-certified course missing");
    expect(session.boatId).not.toBeNull();
    const dives = await db
      .select({
        number: executedDives.diveNumber,
        depth: executedDives.maxDepthMeters,
        site: diveSites.name,
      })
      .from(executedDives)
      .innerJoin(diveSites, eq(diveSites.id, executedDives.actualSiteId))
      .where(and(eq(executedDives.shopId, shop.id), eq(executedDives.tripId, session.id)))
      .orderBy(asc(executedDives.diveNumber));
    expect(dives.map((dive) => dive.number)).toEqual([1, 2, 3, 4, 5]);
    expect(dives[0]?.site).toMatch(/duane/i);
    expect(dives[0]?.depth).toBeGreaterThan(18);
    const cards = await db
      .select({ level: certifications.level, issuedAt: certifications.issuedByShopAt })
      .from(certifications)
      .where(
        and(eq(certifications.shopId, shop.id), eq(certifications.issuedFromTripId, session.id)),
      );
    expect(cards).toHaveLength(2);
    expect(
      cards.every((card) => card.level === "advanced_open_water" && card.issuedAt !== null),
    ).toBe(true);
  });
});
