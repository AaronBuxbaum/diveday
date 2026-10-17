import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { getRecapPageData } from "./recap";
import { createTrip, upcomingTripsWithCounts } from "./trips";

/**
 * **The recap's ordinal counts dive days, not boats** (glossary **Dive day**;
 * dive-domain review of layer r5-4, fix 2): one calendar day in the shop's
 * zone, however many boats, the same count the milestone and "Your days" say
 * through `diveDayOrdinal`.
 */

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

const RAE = { fullName: "Rae Recap", email: "recap-rae@example.com" };

async function book(tripId: string) {
  const party = await createBookingParty(ctx.db, [
    { actor: "staff", shopId: ctx.shop.id, tripId, ...RAE },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  return party.bookings[0].bookingId;
}

describe("getRecapPageData's dive-day count", () => {
  it("counts a morning and an afternoon boat on one date as one dive day", async () => {
    const { db, shop } = ctx;
    const reef = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((t) =>
      t.title.startsWith("Two-Tank Reef — Molasses"),
    );
    if (!reef) throw new Error("demo reef trip missing");
    const bookingId = await book(reef.id);
    const anHourBefore = new Date(reef.startsAt.getTime() - 60 * 60 * 1000);
    const morning = await createTrip(db, {
      shopId: shop.id,
      title: "Morning Single",
      startsAt: anHourBefore,
      endsAt: new Date(anHourBefore.getTime() + 30 * 60 * 1000),
      capacity: 12,
      plannedDives: 1,
    });
    if (!morning) throw new Error("test setup: the morning departure could not be created");
    await book(morning.id);

    expect((await getRecapPageData(db, bookingId))?.visitCount).toBe(1);
  });
});
