import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOUR_MS, nowDate } from "@/lib/clock";
import type { Notification } from "@/lib/notifications/kinds";
import { fileScopedShopContext } from "@/test/db";
import { fakePromotions } from "@/test/fakes";
import { addInterest } from "./interest-dates-fixtures";

const ctx = fileScopedShopContext();

/**
 * **What a later offer owes an earlier answer** (security and dive-domain
 * reviews of #2656). The send is captured and the app origin pinned, as
 * `interest-offers.deal.test` does, so these pin what would leave:
 *
 * - an unsubscribe from the last-minute list stops the offers that list made
 *   possible, and an offer on a diver's own row carries a way out that works
 *   (security MAJOR 1);
 * - a deal blast neither re-parents a diver's own wait-list row nor drops the
 *   seats an earlier offer on it holds (dive-domain M3), and forty deal rows do
 *   not count against a three-seat boat (R2, M2);
 * - the held send rechecks the departure when it fires (dive-domain m3).
 */
vi.mock("./notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./notifications")>();
  return { ...actual, sendNotification: vi.fn() };
});
vi.mock("@/lib/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications")>();
  return { ...actual, publicAppUrl: () => "https://dive.day" };
});

const { sendNotification } = await import("./notifications");
const { invitableSeats, offerSeats } = await import("./interest-offers");
const { associateDateRequestOfferBooking, askAnytime, unsubscribeAnytimeInterestByToken } =
  await import("./interests");
const { optOutPersonFromCourtesyEmailByToken, resolveCourtesyEmailUnsubscribeToken } = await import(
  "./courtesy-email"
);
const {
  bookings,
  dateRequestOfferBookings,
  interests,
  people,
  shops,
  tripLastMinutePromos,
  trips,
} = await import("./schema");
const { setShopStripeAccountStatus, upsertShopStripeAccount } = await import("./stripe-accounts");
const { createTrip, upcomingTripsWithCounts } = await import("./trips");

const ana = { fullName: "Ana Reyes", email: "ana@example.com" };
const openWater = { level: "open_water" as const, noCertification: false, nitrox: false };

async function context() {
  const { db, shop } = ctx;
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (row) => row.title === "Two-Tank Reef — Christ of the Abyss",
  );
  if (!trip) throw new Error("expected seeded trip missing");
  await upsertShopStripeAccount(db, shop.id, "acct_optout_test");
  await setShopStripeAccountStatus(db, "acct_optout_test", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  return { db, shop, trip };
}

function offered(): Notification[] {
  return vi.mocked(sendNotification).mock.calls.map((call) => call[1]);
}

function tokenOf(mail: Notification | undefined): string {
  if (mail?.kind !== "seat_offer_commercial") throw new Error("expected a commercial offer");
  return mail.unsubscribeUrl.split("/unsubscribe/")[1] ?? "";
}

async function tripRow(db: (typeof ctx)["db"], tripId: string) {
  const [row] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!row) throw new Error("trip missing");
  return row;
}

/** Moves a row's last email out of the 24-hour window, as a day passing would. */
async function aDayLater(db: (typeof ctx)["db"], interestId: string) {
  const longAgo = new Date(nowDate().getTime() - 25 * HOUR_MS);
  await db
    .update(interests)
    .set({ emailedAt: longAgo, offeredAt: longAgo })
    .where(eq(interests.id, interestId));
}

beforeEach(() => {
  vi.mocked(sendNotification).mockReset();
  vi.mocked(sendNotification).mockResolvedValue({ status: "sent", providerMessageId: "m-1" });
});

describe("an unsubscribe from the last-minute list", () => {
  it("stops a later offer on the departure row that list's deal made", async () => {
    const { db, shop, trip } = await context();
    const joined = await askAnytime(db, { shopId: shop.id, ...ana, declaration: openWater });
    const deal = await offerSeats(
      db,
      {
        shopId: shop.id,
        shopSlug: shop.slug,
        tripId: trip.id,
        interestIds: [joined.interestId],
        discount: { percent: 20 },
      },
      undefined,
      fakePromotions(),
    );
    expect(deal.results).toEqual([{ interestId: joined.interestId, delivery: "sent" }]);
    expect(
      await unsubscribeAnytimeInterestByToken(db, { token: tokenOf(offered()[0]) }),
    ).not.toBeNull();
    const [child] = await db
      .select()
      .from(interests)
      .where(and(eq(interests.parentInterestId, joined.interestId), eq(interests.tripId, trip.id)));
    if (!child) throw new Error("setup: departure row missing");
    await aDayLater(db, child.id);
    vi.mocked(sendNotification).mockClear();

    const later = await offerSeats(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      tripId: trip.id,
      interestIds: [child.id],
    });

    expect(later.results).toEqual([{ interestId: child.id, delivery: "opted_out" }]);
    expect(offered()).toEqual([]);
  });

  it("does not point a diver's own wait-list row at the list, and its way out works", async () => {
    const { db, shop, trip } = await context();
    const joined = await askAnytime(db, { shopId: shop.id, ...ana, declaration: openWater });
    const [person] = await db.select().from(people).where(eq(people.email, ana.email));
    if (!person) throw new Error("setup: person missing");
    const [own] = await db
      .insert(interests)
      .values({
        shopId: shop.id,
        scope: "departure",
        askedBy: "diver",
        tripId: trip.id,
        personId: person.id,
        partySize: 1,
      })
      .returning();
    if (!own) throw new Error("setup: wait-list row missing");

    await offerSeats(
      db,
      {
        shopId: shop.id,
        shopSlug: shop.slug,
        tripId: trip.id,
        interestIds: [joined.interestId],
        discount: { percent: 20 },
      },
      undefined,
      fakePromotions(),
    );

    const [after] = await db.select().from(interests).where(eq(interests.id, own.id));
    expect(after?.parentInterestId).toBeNull();
    // The deal went out on her own row, so its link is her own way out of
    // commercial mail, and using it stops the next offer on that row.
    const token = tokenOf(offered()[0]);
    expect(await resolveCourtesyEmailUnsubscribeToken(db, token)).toMatchObject({
      personId: person.id,
    });
    await optOutPersonFromCourtesyEmailByToken(db, { token });
    await aDayLater(db, own.id);
    vi.mocked(sendNotification).mockClear();

    const later = await offerSeats(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      tripId: trip.id,
      interestIds: [own.id],
    });
    expect(later.results).toEqual([{ interestId: own.id, delivery: "opted_out" }]);
    expect(offered()).toEqual([]);
  });
});

describe("invitableSeats and the deal", () => {
  it("counts one seat per linked booking and follows its departure and status", async () => {
    const { db, shop, trip } = await context();
    const departure = await tripRow(db, trip.id);
    const baseline = await invitableSeats(db, departure);
    const requestId = await addInterest(db, shop.id, {
      interest: "reef dive",
      name: "Anonymous request",
      email: "request-3102@example.com",
    });
    const unrelatedRequestId = await addInterest(db, shop.id, {
      interest: "another reef dive",
      name: "Another anonymous request",
      email: "other-request-3102@example.com",
    });
    const offeredAt = nowDate();
    const [bookedOffer] = await db
      .insert(interests)
      .values({
        shopId: shop.id,
        scope: "departure",
        askedBy: "diver",
        tripId: trip.id,
        parentInterestId: requestId,
        partySize: 2,
        offeredAt,
      })
      .returning({ id: interests.id });
    const [unrelatedOffer] = await db
      .insert(interests)
      .values({
        shopId: shop.id,
        scope: "departure",
        askedBy: "diver",
        tripId: trip.id,
        parentInterestId: unrelatedRequestId,
        partySize: 1,
        offeredAt,
        closedAt: offeredAt,
        closedAs: "done",
      })
      .returning({ id: interests.id });
    if (!bookedOffer || !unrelatedOffer) throw new Error("setup: date offers missing");
    expect(await invitableSeats(db, departure)).toBe(baseline - 3);

    const bookingEmail = "booked-3102@example.com";
    await askAnytime(db, {
      shopId: shop.id,
      fullName: "A diver booking separately",
      email: bookingEmail,
      declaration: openWater,
    });
    const [bookedPerson] = await db.select().from(people).where(eq(people.email, bookingEmail));
    if (!bookedPerson) throw new Error("setup: booking person missing");
    const [booking] = await db
      .insert(bookings)
      .values({
        bookedAs: "diver",
        shopId: shop.id,
        tripId: trip.id,
        personId: bookedPerson.id,
        status: "booked",
      })
      .returning({ id: bookings.id });
    if (!booking) throw new Error("setup: booking missing");
    const otherDeparture = (await upcomingTripsWithCounts(db, shop.id)).find(
      (candidate) => candidate.id !== trip.id,
    );
    if (!otherDeparture) throw new Error("setup: second departure missing");
    const otherBaseline = await invitableSeats(db, await tripRow(db, otherDeparture.id));
    const [otherOffer] = await db
      .insert(interests)
      .values({
        shopId: shop.id,
        scope: "departure",
        askedBy: "diver",
        tripId: otherDeparture.id,
        parentInterestId: requestId,
        partySize: 2,
        offeredAt,
      })
      .returning({ id: interests.id });
    if (!otherOffer) throw new Error("setup: second departure offer missing");
    const secondBookingEmail = "second-3102@example.com";
    await askAnytime(db, {
      shopId: shop.id,
      fullName: "The second diver in the party",
      email: secondBookingEmail,
      declaration: openWater,
    });
    const [secondPerson] = await db
      .select()
      .from(people)
      .where(eq(people.email, secondBookingEmail));
    if (!secondPerson) throw new Error("setup: second booking person missing");
    const [secondBooking] = await db
      .insert(bookings)
      .values({
        bookedAs: "diver",
        shopId: shop.id,
        tripId: trip.id,
        personId: secondPerson.id,
        status: "booked",
      })
      .returning({ id: bookings.id });
    if (!secondBooking) throw new Error("setup: second booking missing");
    const foreignBookingEmail = "foreign-3102@example.com";
    await askAnytime(db, {
      shopId: shop.id,
      fullName: "A diver on another departure",
      email: foreignBookingEmail,
      declaration: openWater,
    });
    const [foreignPerson] = await db
      .select()
      .from(people)
      .where(eq(people.email, foreignBookingEmail));
    if (!foreignPerson) throw new Error("setup: second booking person missing");
    const [foreignBooking] = await db
      .insert(bookings)
      .values({
        bookedAs: "diver",
        shopId: shop.id,
        tripId: otherDeparture.id,
        personId: foreignPerson.id,
        status: "booked",
      })
      .returning({ id: bookings.id });
    if (!foreignBooking) throw new Error("setup: second departure booking missing");

    const foreignShopSuffix = randomBytes(4).toString("hex");
    const [foreignShop] = await db
      .insert(shops)
      .values({
        name: `Other shop ${foreignShopSuffix}`,
        slug: `other-shop-${foreignShopSuffix}`,
        timezone: "UTC",
      })
      .returning();
    if (!foreignShop) throw new Error("setup: foreign shop missing");
    const [foreignTrip] = await db
      .insert(trips)
      .values({
        shopId: foreignShop.id,
        title: "Foreign departure",
        startsAt: trip.startsAt,
        endsAt: trip.endsAt,
        capacity: 2,
      })
      .returning();
    if (!foreignTrip) throw new Error("setup: foreign trip missing");
    const [foreignTenantPerson] = await db
      .insert(people)
      .values({
        shopId: foreignShop.id,
        fullName: "Foreign shop diver",
        email: `foreign-tenant-${foreignShopSuffix}@example.com`,
      })
      .returning();
    if (!foreignTenantPerson) throw new Error("setup: foreign tenant person missing");
    const [foreignTenantBooking] = await db
      .insert(bookings)
      .values({
        bookedAs: "diver",
        shopId: foreignShop.id,
        tripId: foreignTrip.id,
        personId: foreignTenantPerson.id,
        status: "booked",
      })
      .returning({ id: bookings.id });
    if (!foreignTenantBooking) throw new Error("setup: foreign tenant booking missing");
    expect(
      await associateDateRequestOfferBooking(db, {
        shopId: shop.id,
        tripId: trip.id,
        requestId,
        bookingId: foreignTenantBooking.id,
      }),
    ).toBe(false);
    expect(await invitableSeats(db, await tripRow(db, trip.id))).toBe(baseline - 5);
    expect(await invitableSeats(db, await tripRow(db, otherDeparture.id))).toBe(otherBaseline - 3);

    expect(
      await associateDateRequestOfferBooking(db, {
        shopId: shop.id,
        tripId: trip.id,
        requestId,
        bookingId: foreignBooking.id,
      }),
    ).toBe(false);
    expect(
      await associateDateRequestOfferBooking(db, {
        shopId: shop.id,
        tripId: trip.id,
        requestId,
        bookingId: booking.id,
      }),
    ).toBe(true);
    expect(await invitableSeats(db, await tripRow(db, trip.id))).toBe(baseline - 4);
    // A no-show releases the boat seat, but the linked anonymous offer regains
    // that one seat of advisory hold. Rebooking or checking the diver in puts
    // the booking back in SEAT_HELD_STATUSES and consumes that hold again, so
    // combined offerable capacity stays level across each transition.
    await db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, booking.id));
    expect(await invitableSeats(db, await tripRow(db, trip.id))).toBe(baseline - 4);
    expect(
      await associateDateRequestOfferBooking(db, {
        shopId: shop.id,
        tripId: trip.id,
        requestId,
        bookingId: booking.id,
      }),
    ).toBe(false);

    await db.update(bookings).set({ status: "booked" }).where(eq(bookings.id, booking.id));
    expect(await invitableSeats(db, await tripRow(db, trip.id))).toBe(baseline - 4);
    await db.update(bookings).set({ status: "checked_in" }).where(eq(bookings.id, booking.id));
    expect(await invitableSeats(db, await tripRow(db, trip.id))).toBe(baseline - 4);
    await db.update(bookings).set({ status: "booked" }).where(eq(bookings.id, booking.id));

    expect(
      await associateDateRequestOfferBooking(db, {
        shopId: shop.id,
        tripId: trip.id,
        requestId,
        bookingId: secondBooking.id,
      }),
    ).toBe(true);
    expect(
      await associateDateRequestOfferBooking(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        tripId: trip.id,
        requestId: unrelatedRequestId,
        bookingId: booking.id,
      }),
    ).toBe(false);
    expect(await invitableSeats(db, await tripRow(db, trip.id))).toBe(baseline - 3);
    expect(
      await associateDateRequestOfferBooking(db, {
        shopId: shop.id,
        tripId: otherDeparture.id,
        requestId,
        bookingId: foreignBooking.id,
      }),
    ).toBe(true);
    expect(await invitableSeats(db, await tripRow(db, otherDeparture.id))).toBe(otherBaseline - 2);

    const thirdBookingEmail = "third-3102@example.com";
    await askAnytime(db, {
      shopId: shop.id,
      fullName: "A third diver outside the requested party",
      email: thirdBookingEmail,
      declaration: openWater,
    });
    const [thirdPerson] = await db.select().from(people).where(eq(people.email, thirdBookingEmail));
    if (!thirdPerson) throw new Error("setup: third booking person missing");
    const [thirdBooking] = await db
      .insert(bookings)
      .values({
        bookedAs: "diver",
        shopId: shop.id,
        tripId: trip.id,
        personId: thirdPerson.id,
        status: "booked",
      })
      .returning({ id: bookings.id });
    if (!thirdBooking) throw new Error("setup: third booking missing");
    expect(
      await associateDateRequestOfferBooking(db, {
        shopId: shop.id,
        tripId: trip.id,
        requestId,
        bookingId: thirdBooking.id,
      }),
    ).toBe(false);
    expect(await invitableSeats(db, await tripRow(db, trip.id))).toBe(baseline - 4);

    await db.update(bookings).set({ tripId: otherDeparture.id }).where(eq(bookings.id, booking.id));
    expect(await invitableSeats(db, await tripRow(db, trip.id))).toBe(baseline - 4);
    expect(await invitableSeats(db, await tripRow(db, otherDeparture.id))).toBe(otherBaseline - 3);

    // The staff action names the destination request explicitly. Reassign this
    // booking from the old offer to the offer for its new departure; the old
    // offer regains its unfilled seat while the new offer no longer double-holds it.
    expect(
      await associateDateRequestOfferBooking(db, {
        shopId: shop.id,
        tripId: otherDeparture.id,
        requestId,
        bookingId: booking.id,
      }),
    ).toBe(true);
    expect(await invitableSeats(db, await tripRow(db, trip.id))).toBe(baseline - 4);
    expect(await invitableSeats(db, await tripRow(db, otherDeparture.id))).toBe(otherBaseline - 2);

    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id));
    expect(await invitableSeats(db, await tripRow(db, trip.id))).toBe(baseline - 4);
    expect(await invitableSeats(db, await tripRow(db, otherDeparture.id))).toBe(otherBaseline - 2);

    await db.update(bookings).set({ tripId: trip.id }).where(eq(bookings.id, booking.id));
    expect(await invitableSeats(db, await tripRow(db, trip.id))).toBe(baseline - 4);

    await db.update(bookings).set({ status: "booked" }).where(eq(bookings.id, booking.id));
    expect(await invitableSeats(db, await tripRow(db, trip.id))).toBe(baseline - 5);
    expect(
      await associateDateRequestOfferBooking(db, {
        shopId: shop.id,
        tripId: trip.id,
        requestId,
        bookingId: booking.id,
      }),
    ).toBe(true);
    expect(await invitableSeats(db, await tripRow(db, trip.id))).toBe(baseline - 4);
    expect(await invitableSeats(db, await tripRow(db, otherDeparture.id))).toBe(otherBaseline - 2);

    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id));
    expect(await invitableSeats(db, await tripRow(db, trip.id))).toBe(baseline - 4);

    const [stored] = await db
      .select({ bookingId: dateRequestOfferBookings.bookingId })
      .from(dateRequestOfferBookings)
      .where(eq(dateRequestOfferBookings.interestId, unrelatedOffer.id));
    expect(stored).toBeUndefined();
  });

  it("releases an anonymous date-request party at 48 hours and counts a fresh re-offer", async () => {
    const { db, shop, trip } = await context();
    const departure = await tripRow(db, trip.id);
    await askAnytime(db, { shopId: shop.id, ...ana, declaration: openWater });
    const [bookedPerson] = await db.select().from(people).where(eq(people.email, ana.email));
    if (!bookedPerson) throw new Error("setup: person missing");
    await db.insert(bookings).values({
      bookedAs: "diver",
      shopId: shop.id,
      tripId: trip.id,
      personId: bookedPerson.id,
      status: "booked",
    });
    const baseline = await invitableSeats(db, departure);
    expect(baseline).toBeGreaterThanOrEqual(2);
    expect(baseline).toBeLessThan(departure.capacity);
    const parentId = await addInterest(db, shop.id, {
      interest: "reef dive",
      name: "An unnamed request",
      email: "request@example.com",
    });
    const now = nowDate();
    const [child] = await db
      .insert(interests)
      .values({
        shopId: shop.id,
        scope: "departure",
        askedBy: "diver",
        tripId: trip.id,
        parentInterestId: parentId,
        personId: null,
        partySize: 2,
        offeredAt: new Date(now.getTime() - 48 * HOUR_MS + 1),
      })
      .returning({ id: interests.id });
    if (!child) throw new Error("setup: date request offer missing");
    expect(await invitableSeats(db, departure)).toBe(baseline - 2);

    await db
      .update(interests)
      .set({ offeredAt: new Date(now.getTime() - 48 * HOUR_MS) })
      .where(eq(interests.id, child.id));
    expect(await invitableSeats(db, departure)).toBe(baseline);

    await db.update(interests).set({ offeredAt: now }).where(eq(interests.id, child.id));
    expect(await invitableSeats(db, departure)).toBe(baseline - 2);

    await db.update(interests).set({ offeredAt: null }).where(eq(interests.id, child.id));
    expect(await invitableSeats(db, departure)).toBe(baseline);
  });

  it("keeps an older named offer in the advisory count", async () => {
    const { db, shop, trip } = await context();
    const departure = await tripRow(db, trip.id);
    const baseline = await invitableSeats(db, departure);
    await askAnytime(db, { shopId: shop.id, ...ana, declaration: openWater });
    const [person] = await db.select().from(people).where(eq(people.email, ana.email));
    if (!person) throw new Error("setup: person missing");
    await db.insert(interests).values({
      shopId: shop.id,
      scope: "departure",
      askedBy: "diver",
      tripId: trip.id,
      personId: person.id,
      partySize: 1,
      offeredAt: new Date(nowDate().getTime() - 72 * HOUR_MS),
    });
    expect(await invitableSeats(db, departure)).toBe(baseline - 1);
  });

  it("keeps the seats a wait-list invite holds after a deal reaches the same diver", async () => {
    const { db, shop, trip } = await context();
    await askAnytime(db, { shopId: shop.id, ...ana, declaration: openWater });
    const [person] = await db.select().from(people).where(eq(people.email, ana.email));
    if (!person) throw new Error("setup: person missing");
    // Ana and her buddy were offered on Wednesday, without a deal.
    const wednesday = new Date(nowDate().getTime() - 26 * HOUR_MS);
    await db.insert(interests).values({
      shopId: shop.id,
      scope: "departure",
      askedBy: "diver",
      tripId: trip.id,
      personId: person.id,
      partySize: 2,
      offeredAt: wednesday,
      emailedAt: wednesday,
    });
    const before = await invitableSeats(db, await tripRow(db, trip.id));
    const [anytime] = await db
      .select({ id: interests.id })
      .from(interests)
      .where(and(eq(interests.scope, "anytime"), eq(interests.personId, person.id)));
    if (!anytime) throw new Error("setup: anytime interest missing");

    // Thursday, staff send a deal that reaches her through the list.
    const deal = await offerSeats(
      db,
      {
        shopId: shop.id,
        shopSlug: shop.slug,
        tripId: trip.id,
        interestIds: [anytime.id],
        discount: { percent: 15 },
      },
      undefined,
      fakePromotions(),
    );
    expect(deal.deal).toMatchObject({ ok: true });

    expect(await invitableSeats(db, await tripRow(db, trip.id))).toBe(before);
  });

  // ADR 20261017-one-interest-with-a-scope, R2.
  it("does not count forty deal rows against a three-seat departure", async () => {
    const { db, shop, trip: seeded } = await context();
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Three-seat charter",
      startsAt: seeded.startsAt,
      endsAt: seeded.endsAt,
      capacity: 3,
      plannedDives: 2,
    });
    if (!trip) throw new Error("setup: trip failed");
    const [promo] = await db
      .insert(tripLastMinutePromos)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        code: "LASTMIN-R2",
        discountPercent: 20,
        expiresAt: trip.startsAt,
        status: "sent",
      })
      .returning();
    if (!promo) throw new Error("setup: promo failed");
    const crowd = await db
      .insert(people)
      .values(
        Array.from({ length: 41 }, (_, index) => ({
          shopId: shop.id,
          fullName: `Listed Diver ${index}`,
          email: `listed-${index}@example.com`,
        })),
      )
      .returning({ id: people.id });
    const [waiter, ...listed] = crowd;
    if (!waiter) throw new Error("setup: people failed");
    const parents = await db
      .insert(interests)
      .values(
        listed.map((person) => ({
          shopId: shop.id,
          scope: "anytime" as const,
          askedBy: "diver" as const,
          personId: person.id,
        })),
      )
      .returning({ id: interests.id, personId: interests.personId });
    const now = nowDate();
    await db.insert(interests).values(
      parents.map((parent) => ({
        shopId: shop.id,
        scope: "departure" as const,
        askedBy: "shop" as const,
        tripId: trip.id,
        personId: parent.personId,
        parentInterestId: parent.id,
        partySize: 1,
        promoId: promo.id,
        offeredAt: now,
        emailedAt: now,
      })),
    );
    await db.insert(interests).values({
      shopId: shop.id,
      scope: "departure",
      askedBy: "diver",
      tripId: trip.id,
      personId: waiter.id,
      partySize: 2,
      offeredAt: now,
      emailedAt: now,
    });

    expect(await invitableSeats(db, await tripRow(db, trip.id))).toBe(1);
  });
});

describe("a held offer rechecks its departure when it fires", () => {
  it.each([
    ["cancelled", { status: "cancelled" as const }],
    ["on a conditions hold", { conditionsHold: true }],
    [
      "already gone",
      { startsAt: new Date("2020-01-01T08:00:00Z"), endsAt: new Date("2020-01-01T12:00:00Z") },
    ],
  ])("offers nobody on a departure %s, and stamps nothing", async (_label, change) => {
    const { db, shop, trip } = await context();
    await askAnytime(db, { shopId: shop.id, ...ana, declaration: openWater });
    const [person] = await db.select().from(people).where(eq(people.email, ana.email));
    if (!person) throw new Error("setup: person missing");
    const [own] = await db
      .insert(interests)
      .values({
        shopId: shop.id,
        scope: "departure",
        askedBy: "diver",
        tripId: trip.id,
        personId: person.id,
        partySize: 1,
      })
      .returning();
    if (!own) throw new Error("setup: wait-list row missing");
    // diveday:allow-flat-revision: a test fixture moving a departure into the past.
    await db.update(trips).set(change).where(eq(trips.id, trip.id));

    const outcome = await offerSeats(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      tripId: trip.id,
      interestIds: [own.id],
    });

    expect(outcome.results).toEqual([{ interestId: own.id, delivery: "fallback" }]);
    expect(offered()).toEqual([]);
    const [after] = await db.select().from(interests).where(eq(interests.id, own.id));
    expect(after?.offeredAt).toBeNull();
  });
});

describe("a seat released as the boat loads", () => {
  // The counter's no-show salvage (e2e check-in, "releases a no-show"): ten
  // minutes past the scheduled time the seat is still the shop's to sell
  // (`hasSailed`, the booking transaction's gate), so the wait list hears.
  it("is offered to the wait list inside the departure's grace", async () => {
    const { db, shop, trip } = await context();
    await askAnytime(db, { shopId: shop.id, ...ana, declaration: openWater });
    const [person] = await db.select().from(people).where(eq(people.email, ana.email));
    if (!person) throw new Error("setup: person missing");
    const [own] = await db
      .insert(interests)
      .values({
        shopId: shop.id,
        scope: "departure",
        askedBy: "diver",
        tripId: trip.id,
        personId: person.id,
        partySize: 1,
      })
      .returning();
    if (!own) throw new Error("setup: wait-list row missing");
    const startsAt = new Date(nowDate().getTime() - 10 * 60_000);
    // diveday:allow-flat-revision: a test fixture moving a departure just past its time.
    await db
      .update(trips)
      .set({ startsAt, endsAt: new Date(startsAt.getTime() + 3 * HOUR_MS) })
      .where(eq(trips.id, trip.id));

    await offerSeats(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      tripId: trip.id,
      interestIds: [own.id],
    });

    const [after] = await db.select().from(interests).where(eq(interests.id, own.id));
    expect(after?.offeredAt).not.toBeNull();
  });
});

describe("an offer to someone already aboard", () => {
  // Coordinator's follow-up to the #2656 reviews: the panel hides a seated
  // diver, but a hand-posted id is read on the server, so it is filtered there.
  it("offers nobody who holds a seat on the departure, by their row or by the list", async () => {
    const { db, shop, trip } = await context();
    const joined = await askAnytime(db, { shopId: shop.id, ...ana, declaration: openWater });
    const [person] = await db.select().from(people).where(eq(people.email, ana.email));
    if (!person) throw new Error("setup: person missing");
    const [own] = await db
      .insert(interests)
      .values({
        shopId: shop.id,
        scope: "departure",
        askedBy: "diver",
        tripId: trip.id,
        personId: person.id,
        partySize: 1,
      })
      .returning();
    if (!own) throw new Error("setup: wait-list row missing");
    await db.insert(bookings).values({
      bookedAs: "diver",
      shopId: shop.id,
      tripId: trip.id,
      personId: person.id,
    });

    const outcome = await offerSeats(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      tripId: trip.id,
      interestIds: [own.id, joined.interestId],
    });

    expect(outcome.results).toEqual([
      { interestId: own.id, delivery: "fallback" },
      { interestId: joined.interestId, delivery: "fallback" },
    ]);
    expect(offered()).toEqual([]);
    const [after] = await db.select().from(interests).where(eq(interests.id, own.id));
    expect(after?.offeredAt).toBeNull();
  });

  it("still offers someone whose seat on it was cancelled", async () => {
    const { db, shop, trip } = await context();
    await askAnytime(db, { shopId: shop.id, ...ana, declaration: openWater });
    const [person] = await db.select().from(people).where(eq(people.email, ana.email));
    if (!person) throw new Error("setup: person missing");
    const [own] = await db
      .insert(interests)
      .values({
        shopId: shop.id,
        scope: "departure",
        askedBy: "diver",
        tripId: trip.id,
        personId: person.id,
        partySize: 1,
      })
      .returning();
    if (!own) throw new Error("setup: wait-list row missing");
    await db.insert(bookings).values({
      bookedAs: "diver",
      shopId: shop.id,
      tripId: trip.id,
      personId: person.id,
      status: "cancelled",
    });

    const outcome = await offerSeats(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      tripId: trip.id,
      interestIds: [own.id],
    });
    expect(outcome.results).toEqual([{ interestId: own.id, delivery: "sent" }]);
  });
});
