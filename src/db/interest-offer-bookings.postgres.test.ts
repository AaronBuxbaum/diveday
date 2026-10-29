import { randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { SEAT_HELD_STATUSES } from "@/lib/no-show";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { cancelBooking, createBooking, restoreBooking } from "./bookings";
import { associateDateRequestOfferBooking } from "./interests";
import { bookings, dateRequestOfferBookings, interests, people, shops, trips } from "./schema";

describePostgres("date-request offer booking association under real concurrency", () => {
  it("does not deadlock when erasure updates the request parent before its offer child", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: `Offer erasure ${suffix}`, slug: `offer-erasure-${suffix}`, timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("setup: shop missing");
    const startsAt = new Date(nowDate().getTime() + 24 * 60 * 60_000);
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Offer erasure departure",
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
    const [person] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Booked diver", email: `booked-${suffix}@example.com` })
      .returning();
    if (!person) throw new Error("setup: diver missing");
    const [booking] = await pg.db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: trip.id, personId: person.id, bookedAs: "diver" })
      .returning();
    if (!booking) throw new Error("setup: booking missing");

    let parentLocked!: () => void;
    const parentIsLocked = new Promise<void>((resolve) => {
      parentLocked = resolve;
    });
    let continueErasure!: () => void;
    const allowChildUpdate = new Promise<void>((resolve) => {
      continueErasure = resolve;
    });
    const erasure = pg.connect().transaction(async (tx) => {
      // Mirrors scrubInterests: blank the parent first, then its person-less child.
      await tx.update(interests).set({ email: null }).where(eq(interests.id, request.id));
      parentLocked();
      await allowChildUpdate;
      await tx
        .update(interests)
        .set({ name: null, email: null, phone: null })
        .where(eq(interests.id, offer.id));
    });

    await Promise.race([parentIsLocked, erasure]);
    const association = associateDateRequestOfferBooking(pg.connect(), {
      shopId: shop.id,
      tripId: trip.id,
      requestId: request.id,
      bookingId: booking.id,
    });
    // Association takes the parent lock before its child, the same order as
    // erasure. It waits for the scrub to release the parent, then completes.
    await waitForLockWaiters(pg.db, 1);
    continueErasure();
    const [associationResult, erasureResult] = await Promise.allSettled([association, erasure]);

    expect(associationResult).toEqual({ status: "fulfilled", value: true });
    expect(erasureResult.status).toBe("fulfilled");
  });

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

  it("serializes associations across different offers for one request", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: `Offer group ${suffix}`, slug: `offer-group-${suffix}`, timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("setup: shop missing");
    const startsAt = new Date(nowDate().getTime() + 24 * 60 * 60_000);
    const tripsMade = await pg.db
      .insert(trips)
      .values([
        {
          shopId: shop.id,
          title: "Offer one",
          startsAt,
          endsAt: new Date(startsAt.getTime() + 4 * 60 * 60_000),
          capacity: 4,
        },
        {
          shopId: shop.id,
          title: "Offer two",
          startsAt: new Date(startsAt.getTime() + 24 * 60 * 60_000),
          endsAt: new Date(startsAt.getTime() + 28 * 60 * 60_000),
          capacity: 4,
        },
      ])
      .returning();
    if (tripsMade.length !== 2) throw new Error("setup: trips missing");
    const [request] = await pg.db
      .insert(interests)
      .values({
        shopId: shop.id,
        scope: "date",
        askedBy: "diver",
        interest: "reef dive",
        name: "Group",
        email: `group-${suffix}@example.com`,
      })
      .returning();
    if (!request) throw new Error("setup: request missing");
    const offers = await pg.db
      .insert(interests)
      .values(
        tripsMade.map((trip) => ({
          shopId: shop.id,
          scope: "departure" as const,
          askedBy: "diver" as const,
          tripId: trip.id,
          parentInterestId: request.id,
          partySize: 2,
          offeredAt: nowDate(),
        })),
      )
      .returning();
    if (offers.length !== 2) throw new Error("setup: offers missing");
    const peopleMade = await pg.db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "One Member", email: `one-${suffix}@example.com` },
        { shopId: shop.id, fullName: "Two Member", email: `two-${suffix}@example.com` },
      ])
      .returning();
    if (peopleMade.length !== 2) throw new Error("setup: divers missing");
    const bookingsMade = await pg.db
      .insert(bookings)
      .values(
        peopleMade.map((person, index) => ({
          shopId: shop.id,
          tripId: tripsMade[index]?.id ?? "",
          personId: person.id,
          bookedAs: "diver" as const,
        })),
      )
      .returning();
    if (bookingsMade.length !== 2) throw new Error("setup: bookings missing");

    const gate = await holdRowLock(
      pg,
      sql`select id from interests where id = ${request.id} for update`,
    );
    try {
      const contenders = bookingsMade.map((booking, index) =>
        associateDateRequestOfferBooking(pg.connect(), {
          shopId: shop.id,
          tripId: tripsMade[index]?.id ?? "",
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
    const linked = await pg.db
      .select({ tripId: bookings.tripId })
      .from(dateRequestOfferBookings)
      .innerJoin(bookings, eq(bookings.id, dateRequestOfferBookings.bookingId))
      .where(eq(dateRequestOfferBookings.shopId, shop.id));
    expect(new Set(linked.map((row) => row.tripId)).size).toBe(1);
  });

  it("keeps a party request open until every offered seat is actively booked", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({
        name: `Offer party completion ${suffix}`,
        slug: `offer-party-${suffix}`,
        timezone: "UTC",
      })
      .returning();
    if (!shop) throw new Error("setup: shop missing");
    const startsAt = new Date(nowDate().getTime() + 24 * 60 * 60_000);
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Offered party departure",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 60 * 60_000),
        capacity: 4,
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
        partySize: 2,
        name: "Two divers",
        email: `party-${suffix}@example.com`,
      })
      .returning();
    if (!request) throw new Error("setup: request missing");
    await pg.db.insert(interests).values({
      shopId: shop.id,
      scope: "departure",
      askedBy: "diver",
      tripId: trip.id,
      parentInterestId: request.id,
      partySize: 2,
      offeredAt: nowDate(),
    });

    const first = await createBooking(pg.db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "First party member",
      email: `first-${suffix}@example.com`,
      dateRequestInterestId: request.id,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(`first party seat refused: ${first.reason}`);
    expect(first.dateRequestPartyComplete).toBe(false);
    const [openRequest] = await pg.db
      .select({ closedAt: interests.closedAt, closedAs: interests.closedAs })
      .from(interests)
      .where(eq(interests.id, request.id));
    expect(openRequest).toEqual({ closedAt: null, closedAs: null });

    const second = await createBooking(pg.db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Second party member",
      email: `second-${suffix}@example.com`,
      dateRequestInterestId: request.id,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(`second party seat refused: ${second.reason}`);
    expect(second.dateRequestPartyComplete).toBe(true);
    const [closedRequest] = await pg.db
      .select({ closedAt: interests.closedAt, closedAs: interests.closedAs })
      .from(interests)
      .where(eq(interests.id, request.id));
    expect(closedRequest?.closedAt).toBeInstanceOf(Date);
    expect(closedRequest?.closedAs).toBe("booked");

    const overflow = await createBooking(pg.db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Third party member",
      email: `third-${suffix}@example.com`,
      dateRequestInterestId: request.id,
    });
    expect(overflow).toEqual({ ok: false, reason: "date_request_party_full" });
    const links = await pg.db
      .select({ bookingId: dateRequestOfferBookings.bookingId })
      .from(dateRequestOfferBookings)
      .where(eq(dateRequestOfferBookings.shopId, shop.id));
    expect(links).toHaveLength(2);
  });

  it("allows a released party to book elsewhere and checks reactivation against the active party", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({
        name: `Offer reactivation ${suffix}`,
        slug: `offer-reactivation-${suffix}`,
        timezone: "UTC",
      })
      .returning();
    if (!shop) throw new Error("setup: shop missing");
    const startsAt = new Date(nowDate().getTime() + 24 * 60 * 60_000);
    const departures = await pg.db
      .insert(trips)
      .values([
        {
          shopId: shop.id,
          title: "First offered departure",
          startsAt,
          endsAt: new Date(startsAt.getTime() + 4 * 60 * 60_000),
          capacity: 4,
        },
        {
          shopId: shop.id,
          title: "Second offered departure",
          startsAt: new Date(startsAt.getTime() + 24 * 60 * 60_000),
          endsAt: new Date(startsAt.getTime() + 28 * 60 * 60_000),
          capacity: 4,
        },
      ])
      .returning();
    if (departures.length !== 2) throw new Error("setup: trips missing");
    const [request] = await pg.db
      .insert(interests)
      .values({
        shopId: shop.id,
        scope: "date",
        askedBy: "diver",
        interest: "reef dive",
        name: "Reactivation",
        email: `reactivation-${suffix}@example.com`,
      })
      .returning();
    if (!request) throw new Error("setup: request missing");
    const offers = await pg.db
      .insert(interests)
      .values(
        departures.map((trip) => ({
          shopId: shop.id,
          scope: "departure" as const,
          askedBy: "diver" as const,
          tripId: trip.id,
          parentInterestId: request.id,
          partySize: 2,
          offeredAt: nowDate(),
        })),
      )
      .returning();
    if (offers.length !== 2) throw new Error("setup: offers missing");

    const initial = await createBooking(pg.db, {
      actor: "staff",
      shopId: shop.id,
      tripId: departures[0]?.id ?? "",
      fullName: "Returning Member",
      email: `returning-${suffix}@example.com`,
      dateRequestInterestId: request.id,
    });
    if (!initial.ok) throw new Error(`setup: initial booking failed: ${initial.reason}`);
    expect((await cancelBooking(pg.db, shop.id, initial.bookingId)).ok).toBe(true);

    // With every linked seat released, the request can explicitly take its
    // second offer. Its old association stays for the reactivation check.
    const elsewhere = await createBooking(pg.db, {
      actor: "staff",
      shopId: shop.id,
      tripId: departures[1]?.id ?? "",
      personId: initial.personId,
      dateRequestInterestId: request.id,
    });
    if (!elsewhere.ok)
      throw new Error(`setup: released party could not rebook: ${elsewhere.reason}`);
    expect(elsewhere.bookingId).not.toBe(initial.bookingId);
    expect(await restoreBooking(pg.db, shop.id, initial.bookingId)).toBe(
      "date_request_departure_conflict",
    );

    expect((await cancelBooking(pg.db, shop.id, elsewhere.bookingId)).ok).toBe(true);
    expect(await restoreBooking(pg.db, shop.id, initial.bookingId)).toBe("restored");
    expect((await cancelBooking(pg.db, shop.id, initial.bookingId)).ok).toBe(true);

    const rebookedAgain = await createBooking(pg.db, {
      actor: "staff",
      shopId: shop.id,
      tripId: departures[1]?.id ?? "",
      personId: initial.personId,
      dateRequestInterestId: request.id,
    });
    if (!rebookedAgain.ok) {
      throw new Error(`setup: released party could not rebook again: ${rebookedAgain.reason}`);
    }
    expect(await restoreBooking(pg.db, shop.id, initial.bookingId)).toBe(
      "date_request_departure_conflict",
    );
    expect((await cancelBooking(pg.db, shop.id, rebookedAgain.bookingId)).ok).toBe(true);
    expect(await restoreBooking(pg.db, shop.id, initial.bookingId)).toBe("restored");
    expect((await cancelBooking(pg.db, shop.id, initial.bookingId)).ok).toBe(true);

    const restored = await createBooking(pg.db, {
      actor: "staff",
      shopId: shop.id,
      tripId: departures[0]?.id ?? "",
      personId: initial.personId,
      dateRequestInterestId: request.id,
    });
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.bookingId).toBe(initial.bookingId);
  });

  it("serializes reactivation against rebooking a released party on another offer", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({
        name: `Offer restore race ${suffix}`,
        slug: `offer-restore-${suffix}`,
        timezone: "UTC",
      })
      .returning();
    if (!shop) throw new Error("setup: shop missing");
    const startsAt = new Date(nowDate().getTime() + 24 * 60 * 60_000);
    const departures = await pg.db
      .insert(trips)
      .values([
        {
          shopId: shop.id,
          title: "Restore race A",
          startsAt,
          endsAt: new Date(startsAt.getTime() + 4 * 60 * 60_000),
          capacity: 4,
        },
        {
          shopId: shop.id,
          title: "Restore race B",
          startsAt: new Date(startsAt.getTime() + 24 * 60 * 60_000),
          endsAt: new Date(startsAt.getTime() + 28 * 60 * 60_000),
          capacity: 4,
        },
      ])
      .returning();
    if (departures.length !== 2) throw new Error("setup: trips missing");
    const [request] = await pg.db
      .insert(interests)
      .values({ shopId: shop.id, scope: "date", askedBy: "diver", interest: "reef dive" })
      .returning();
    if (!request) throw new Error("setup: request missing");
    await pg.db.insert(interests).values(
      departures.map((trip) => ({
        shopId: shop.id,
        scope: "departure" as const,
        askedBy: "diver" as const,
        tripId: trip.id,
        parentInterestId: request.id,
        partySize: 2,
        offeredAt: nowDate(),
      })),
    );
    const initial = await createBooking(pg.db, {
      actor: "staff",
      shopId: shop.id,
      tripId: departures[0]?.id ?? "",
      fullName: "Returning Diver",
      email: `returning-${suffix}@example.com`,
      dateRequestInterestId: request.id,
    });
    if (!initial.ok) throw new Error(`setup: initial booking failed: ${initial.reason}`);
    expect((await cancelBooking(pg.db, shop.id, initial.bookingId)).ok).toBe(true);

    const gate = await holdRowLock(
      pg,
      sql`select id from interests where id = ${request.id} for update`,
    );
    try {
      const restoration = restoreBooking(pg.connect(), shop.id, initial.bookingId);
      const rebooking = createBooking(pg.connect(), {
        actor: "staff",
        shopId: shop.id,
        tripId: departures[1]?.id ?? "",
        fullName: "New Party Member",
        email: `new-member-${suffix}@example.com`,
        dateRequestInterestId: request.id,
      });
      await waitForLockWaiters(pg.db, 2);
      await gate.release();
      const [restored, bookedElsewhere] = await Promise.all([restoration, rebooking]);

      if (bookedElsewhere.ok) {
        expect(restored).toBe("date_request_departure_conflict");
      } else {
        expect(bookedElsewhere).toEqual({
          ok: false,
          reason: "date_request_departure_conflict",
        });
        expect(restored).toBe("restored");
      }
      const active = await pg.db
        .select({ tripId: bookings.tripId })
        .from(dateRequestOfferBookings)
        .innerJoin(
          bookings,
          and(
            eq(bookings.id, dateRequestOfferBookings.bookingId),
            eq(bookings.shopId, dateRequestOfferBookings.shopId),
            inArray(bookings.status, [...SEAT_HELD_STATUSES]),
          ),
        )
        .where(eq(dateRequestOfferBookings.shopId, shop.id));
      expect(new Set(active.map((row) => row.tripId)).size).toBe(1);
      expect(active).toHaveLength(1);
    } finally {
      await gate.release();
    }
  });
});
