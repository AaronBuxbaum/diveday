import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { lockDateRequestOffer } from "./date-request-offer-bookings";
import { askForDate } from "./interests";
import { interests } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/** An open request for two, offered the first upcoming departure. */
async function offeredRequest() {
  const [trip] = await upcomingTripsWithCounts(ctx.db, ctx.shop.id);
  if (!trip) throw new Error("seeded departure missing");
  const { id } = await askForDate(ctx.db, {
    shopId: ctx.shop.id,
    interest: "Reef",
    name: "Offer Asker",
    email: "offer.asker@example.com",
    partySize: 2,
  });
  await ctx.db.insert(interests).values({
    shopId: ctx.shop.id,
    scope: "departure",
    askedBy: "diver",
    tripId: trip.id,
    parentInterestId: id,
    partySize: 2,
    offeredAt: nowDate(),
  });
  return { tripId: trip.id, requestId: id };
}

describe("lockDateRequestOffer", () => {
  it("locks an open request's offer on its departure", async () => {
    const { tripId, requestId } = await offeredRequest();
    const locked = await lockDateRequestOffer(ctx.db, { shopId: ctx.shop.id, tripId, requestId });
    expect(locked).toMatchObject({ requestId, partySize: 2 });
  });

  /**
   * A stale band can still post a request a colleague has since closed. The
   * band reads a closed request as gone, and the seat agrees: nothing links to
   * it (round-2 dive-domain review, finding 4).
   */
  it("refuses a request that has been closed", async () => {
    const { tripId, requestId } = await offeredRequest();
    await ctx.db
      .update(interests)
      .set({ closedAt: nowDate(), closedAs: "done" })
      .where(eq(interests.id, requestId));
    expect(
      await lockDateRequestOffer(ctx.db, { shopId: ctx.shop.id, tripId, requestId, newLink: true }),
    ).toBe("date_request_offer_unavailable");
    // A seat already linked (restored, moved) keeps its closed request.
    expect(
      await lockDateRequestOffer(ctx.db, { shopId: ctx.shop.id, tripId, requestId }),
    ).toMatchObject({ requestId });
  });
});
