import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { MINUTE_MS } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { departureInterest } from "@/test/interests";
import { noShowSalvage } from "./no-show";
import { interests, people, shops } from "./schema";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";

// Review 2026-10-23, item 5: a wait list switched off on the Features page is
// no salvage for the desk, since none of its offers could be sent; the desk is
// offered the other day instead.

const ctx = fileScopedShopContext();

describe("noShowSalvage with the wait list switched off", () => {
  it("counts nobody waiting, so the wait list is never the offer", async () => {
    const { db, shop } = ctx;
    const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
      (candidate) => candidate.title === "Two-Tank Reef — Molasses & French",
    );
    if (!trip) throw new Error("seeded reef trip missing");
    const [seat] = await getTripRoster(db, shop.id, trip.id);
    const [waiting] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, shop.id))
      .limit(1);
    if (!seat || !waiting) throw new Error("seeded rows missing");
    await db
      .insert(interests)
      .values(departureInterest({ shopId: shop.id, tripId: trip.id, personId: waiting.id }));
    const salvage = async () =>
      (
        await noShowSalvage(db, {
          shopId: shop.id,
          tripId: trip.id,
          personIds: [seat.person.id],
          now: new Date(trip.startsAt.getTime() + 10 * MINUTE_MS),
        })
      ).get(seat.person.id);

    expect((await salvage())?.kind).toBe("waitlist");
    await db.update(shops).set({ waitlistEnabled: false }).where(eq(shops.id, shop.id));
    expect((await salvage())?.kind).not.toBe("waitlist");
  });
});
