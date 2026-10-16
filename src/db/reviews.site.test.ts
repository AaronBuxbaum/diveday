import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { listSiteReviews } from "./reviews";
import { diveSites, tripDives, tripReviews, trips as tripsTable } from "./schema";
import { createTrip } from "./trips";

const OTHER_SHOP_ID = "00000000-0000-0000-0000-000000000000";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

/**
 * **What earlier divers said about this site** (fifth-loop ideas, item 20):
 * published reviews with words, from departures that went there, newest day
 * first and two at most. Nothing the shop's own archive does not already show.
 */
describe("listSiteReviews", () => {
  async function site(name: string) {
    const [row] = await ctx.db
      .insert(diveSites)
      .values({ shopId: ctx.shop.id, name, slug: name.toLowerCase().replaceAll(" ", "-") })
      .returning({ id: diveSites.id });
    if (!row) throw new Error("site insert failed");
    return row.id;
  }

  /** A past departure to `siteId` (by a planned dive), one diver, one review. */
  async function reviewed(
    siteId: string,
    daysAgo: number,
    review: { comment: string | null; published: boolean },
    fullName = "Lars Petersen",
  ) {
    const startsAt = new Date(Date.UTC(2026, 8, 30 - daysAgo, 12));
    const trip = await createTrip(ctx.db, {
      shopId: ctx.shop.id,
      title: `Reef ${daysAgo}`,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
      capacity: 6,
      plannedDives: 1,
    });
    if (!trip) throw new Error("createTrip refused");
    await ctx.db.insert(tripDives).values({ tripId: trip.id, diveNumber: 9, diveSiteId: siteId });
    const party = await createBookingParty(ctx.db, [
      {
        actor: "staff",
        shopId: ctx.shop.id,
        tripId: trip.id,
        fullName,
        email: `${fullName.split(" ")[0].toLowerCase()}-${daysAgo}@example.com`,
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    const booking = party.bookings[0];
    await ctx.db.insert(tripReviews).values({
      shopId: ctx.shop.id,
      bookingId: booking.bookingId,
      tripId: trip.id,
      personId: booking.personId,
      rating: 5,
      comment: review.comment,
      isPublished: review.published,
      publishedAt: review.published ? startsAt : null,
    });
    return trip;
  }

  it("quotes the newest two published reviews with words, from departures to the site", async () => {
    const spiegel = await site("Spiegel Test Wreck");
    await reviewed(spiegel, 9, { comment: "Oldest one", published: true });
    await reviewed(spiegel, 5, { comment: "Calm, unhurried briefing.", published: true });
    await reviewed(spiegel, 3, { comment: "Held for a read", published: false });
    await reviewed(spiegel, 2, { comment: null, published: true });
    await reviewed(
      spiegel,
      1,
      { comment: "  Best wreck dive yet.  ", published: true },
      "Ana Ruiz",
    );

    const quoted = await listSiteReviews(ctx.db, ctx.shop.id, [spiegel]);
    expect(quoted.map((review) => review.comment)).toEqual([
      "Best wreck dive yet.",
      "Calm, unhurried briefing.",
    ]);
    expect(quoted[0]?.reviewer).toBe("Ana R.");
    expect(quoted[1]?.reviewer).toBe("Lars P.");
  });

  it("reads only the sites asked about, and only this shop's", async () => {
    const one = await site("Site One Test");
    const other = await site("Site Other Test");
    await reviewed(other, 4, { comment: "Somewhere else", published: true });
    expect(await listSiteReviews(ctx.db, ctx.shop.id, [one])).toEqual([]);
    expect(await listSiteReviews(ctx.db, OTHER_SHOP_ID, [other])).toEqual([]);
    expect(await listSiteReviews(ctx.db, ctx.shop.id, [])).toEqual([]);
  });

  it("drops a deleted departure's review", async () => {
    const reef = await site("Deleted Trip Reef");
    const trip = await reviewed(reef, 4, { comment: "Gone", published: true });
    await ctx.db
      .update(tripsTable)
      .set({ deletedAt: new Date("2026-10-01T00:00:00.000Z") })
      .where(eq(tripsTable.id, trip.id));
    expect(await listSiteReviews(ctx.db, ctx.shop.id, [reef])).toEqual([]);
  });

  it("leaves out a private charter's review, which would say where that group dived and when", async () => {
    const reef = await site("Private Charter Reef");
    const trip = await reviewed(reef, 4, { comment: "Our own boat", published: true });
    await ctx.db.update(tripsTable).set({ isPrivate: true }).where(eq(tripsTable.id, trip.id));
    expect(await listSiteReviews(ctx.db, ctx.shop.id, [reef])).toEqual([]);
  });
});
