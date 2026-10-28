import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { associateDateRequestOfferBooking } from "./interests";
import { bookings, dateRequestOfferBookings, interests, people, shops, trips } from "./schema";

describePostgres("date-request offer booking association under real concurrency", () => {
  it("does not associate more live bookings than the offered party size", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: `Offer race ${suffix}`, slug: `offer-race-${suffix}`, timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("setup: shop missing");
    const startsAt = new Date(nowDate().getTime() + 24 * 60 * 60_000);
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Offer race departure",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 60 * 60_000),
        capacity: 3,
      })
      .returning();
    if (!trip) throw new Error("setup: trip missing");
    const [request] = await pg.db
      .insert(interests)
      .values({
        shopId: shop.id,
        scope: "date",
        askedBy: "diver",
        interest: "reef dive",
        name: "Anonymous request",
        email: `request-${suffix}@example.com`,
      })
      .returning();
    if (!request) throw new Error("setup: request missing");
    const [offer] = await pg.db
      .insert(interests)
      .values({
        shopId: shop.id,
        scope: "departure",
        askedBy: "diver",
        tripId: trip.id,
        parentInterestId: request.id,
        partySize: 1,
        offeredAt: nowDate(),
      })
      .returning();
    if (!offer) throw new Error("setup: offer missing");
    const candidates = await pg.db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "First Diver", email: `first-${suffix}@example.com` },
        { shopId: shop.id, fullName: "Second Diver", email: `second-${suffix}@example.com` },
      ])
      .returning();
    if (candidates.length !== 2) throw new Error("setup: divers missing");
    const candidateBookings = await pg.db
      .insert(bookings)
      .values(
        candidates.map((person) => ({
          shopId: shop.id,
          tripId: trip.id,
          personId: person.id,
          bookedAs: "diver" as const,
        })),
      )
      .returning();
    if (candidateBookings.length !== 2) throw new Error("setup: bookings missing");

    // Keep both association transactions parked on the same offer row. This
    // makes the race deterministic and exercises the party-size serialization.
    const gate = await holdRowLock(
      pg,
      sql`select id from interests where id = ${offer.id} for update`,
    );
    try {
      const contenders = candidateBookings.map((booking) =>
        associateDateRequestOfferBooking(pg.connect(), {
          shopId: shop.id,
          tripId: trip.id,
          requestId: request.id,
          bookingId: booking.id,
        }),
      );
      await waitForLockWaiters(pg.db, contenders.length);
      await gate.release();
      expect((await Promise.all(contenders)).sort()).toEqual([false, true]);
    } finally {
      await gate.release();
    }

    const foreignSuffix = randomBytes(4).toString("hex");
    const [foreignShop] = await pg.db
      .insert(shops)
      .values({
        name: `Foreign offer shop ${foreignSuffix}`,
        slug: `foreign-offer-${foreignSuffix}`,
        timezone: "UTC",
      })
      .returning();
    if (!foreignShop) throw new Error("setup: foreign shop missing");
    const [foreignTrip] = await pg.db
      .insert(trips)
      .values({
        shopId: foreignShop.id,
        title: "Foreign offer trip",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 60 * 60_000),
        capacity: 2,
      })
      .returning();
    if (!foreignTrip) throw new Error("setup: foreign trip missing");
    const [foreignPerson] = await pg.db
      .insert(people)
      .values({
        shopId: foreignShop.id,
        fullName: "Foreign shop diver",
        email: `foreign-${suffix}@example.com`,
      })
      .returning();
    if (!foreignPerson) throw new Error("setup: foreign person missing");
    const [foreignBooking] = await pg.db
      .insert(bookings)
      .values({
        shopId: foreignShop.id,
        tripId: foreignTrip.id,
        personId: foreignPerson.id,
        bookedAs: "diver",
      })
      .returning();
    if (!foreignBooking) throw new Error("setup: foreign booking missing");
    expect(
      await associateDateRequestOfferBooking(pg.db, {
        shopId: shop.id,
        tripId: trip.id,
        requestId: request.id,
        bookingId: foreignBooking.id,
      }),
    ).toBe(false);
    await expect(
      pg.db.insert(dateRequestOfferBookings).values({
        shopId: shop.id,
        interestId: offer.id,
        bookingId: foreignBooking.id,
      }),
    ).rejects.toThrow();
  });
});
