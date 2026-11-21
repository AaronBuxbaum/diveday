import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createBooking } from "../../db/bookings";
import { diveSites, people, shops, tripSightings, trips as tripTable } from "../../db/schema/index";
import { listTripDives } from "../../db/trips";
import { upcomingTripsWithCounts } from "../../db/trips-queries.test-support";
import { nowDate } from "../../lib/clock";
import { fileScopedShopContext } from "../../test/db";
import { getBookedCard } from "./ready";

const ctx = fileScopedShopContext();

/** A fresh unpaid booking on the seeded "open" reef trip. */
async function unpaidBooking() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const open = trips.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  if (!open) throw new Error("expected seeded open trip missing");
  const booked = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: open.id,
    fullName: "Nora Quinn",
    email: "nora@example.com",
    phone: "+1-305-555-0199",
  });
  if (!booked.ok) throw new Error("setup booking failed");
  return { db, shop, open, bookingId: booked.bookingId };
}

describe("getBookedCard's ticket", () => {
  // Issue #4386: the card is a ticket, with the day's first photo and one line
  // from the crews' public sightings log, or neither.
  it("carries the day's first site photo and its latest sighting, and nothing when sightings are off", async () => {
    const { db, shop, open, bookingId } = await unpaidBooking();
    const dives = await listTripDives(db, shop.id, open.id);
    const site = dives.find((dive) => dive.diveSite)?.diveSite;
    if (!site) throw new Error("expected the seeded reef trip to name a site");
    await db
      .update(diveSites)
      .set({ imageUrls: ["https://example.com/reef.jpg"] })
      .where(eq(diveSites.id, site.id));
    const [crew] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, shop.id))
      .limit(1);
    const [past] = await db
      .select({ id: tripTable.id, startsAt: tripTable.startsAt })
      .from(tripTable)
      .where(
        and(
          eq(tripTable.shopId, shop.id),
          eq(tripTable.status, "scheduled"),
          ne(tripTable.id, open.id),
        ),
      )
      .limit(1);
    if (!crew || !past) throw new Error("seed is missing a person or a trip");
    const seenAt = new Date(nowDate().getTime() - 3 * 24 * 60 * 60 * 1000);
    await db
      .update(tripTable)
      .set({ startsAt: seenAt, endsAt: new Date(seenAt.getTime() + 4 * 60 * 60 * 1000) })
      .where(eq(tripTable.id, past.id));
    await db.insert(tripSightings).values({
      shopId: shop.id,
      tripId: past.id,
      diveSiteId: site.id,
      diveSiteName: site.name,
      speciesSlug: "goliath-grouper",
      count: 1,
      recordedByPersonId: crew.id,
    });

    const card = await getBookedCard(db, { shopId: shop.id, bookingId });
    expect(card?.ticket.photoUrl).toBe("https://example.com/reef.jpg");
    expect(card?.ticket.sighting).toMatchObject({
      siteName: site.name,
      speciesSlug: "goliath-grouper",
    });

    await db.update(shops).set({ sightingsEnabled: false }).where(eq(shops.id, shop.id));
    const off = await getBookedCard(db, { shopId: shop.id, bookingId });
    expect(off?.ticket.sighting).toBeNull();
    expect(off?.ticket.photoUrl).toBe("https://example.com/reef.jpg");
  });
});
