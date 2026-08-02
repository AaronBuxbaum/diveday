// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { bookings, people, trips } from "@/db/schema";
import { openAfterDiveRollCalls } from "@/db/today";
import { and, asc, gte, lte, ne, inArray } from "drizzle-orm";

describe("dbg", () => {
  it("dbg", async () => {
    const { db, shop } = await seededShopContext();
    const endsAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const [trip] = await db.insert(trips).values({
      shopId: shop.id,
      title: "Returned",
      startsAt: new Date(endsAt.getTime() - 4 * 60 * 60 * 1000),
      endsAt,
      capacity: 12,
      plannedDives: 1,
      priceCents: 13000,
    }).returning();
    console.log("trip", trip?.id, trip?.status, trip?.endsAt, trip?.plannedDives);
    const divers = await db.select({ id: people.id }).from(people).where(eq(people.shopId, shop.id)).limit(3);
    console.log("divers", divers.length);
    const rows = await db.insert(bookings).values(divers.map((d) => ({
      shopId: shop.id, tripId: trip!.id, personId: d.id, status: "checked_in" as const,
    }))).returning();
    console.log("bookings", rows.length);
    const returned = await db.select({ id: trips.id, endsAt: trips.endsAt, status: trips.status })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.status, "scheduled"), lte(trips.endsAt, new Date()), gte(trips.endsAt, new Date(Date.now() - 48*3600*1000))));
    console.log("returned", JSON.stringify(returned));
    const open = await openAfterDiveRollCalls(db, shop.id);
    console.log("open", JSON.stringify(open));
    expect(true).toBe(true);
  });
});
