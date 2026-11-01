import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext, seededShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { createBooking } from "./bookings";
import { listBookableDivers } from "./divers";
import { deliverSeatOffer, offerDepartureToDiver } from "./interest-offers";
import { ensureDepartureInterest, listDepartureInterests } from "./interests";
import {
  activityEvents,
  bookings,
  certifications,
  interests,
  people,
  personRoles,
  tripRequirements,
  trips as tripsTable,
} from "./schema";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";

// One database for the file, a rolled-back transaction per test. The one race
// below ("two taps that land together") takes its own: inside one transaction
// its two writers are savepoints on one connection and the race proves nothing
// (src/test/db.ts, "When NOT to use this").
const fileCtx = fileScopedShopContext();

async function invitationContext({ fresh = false } = {}) {
  const { db, shop } = fresh ? await seededShopContext() : fileCtx;
  const [author] = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.shopId, shop.id))
    .limit(1);
  if (!author) throw new Error("expected seeded person missing");
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const firstTrip = trips.find((trip) => trip.title === "Two-Tank Reef — Christ of the Abyss");
  const secondTrip = trips.find((trip) => trip.title === "Wreck Trip — Spiegel Grove");
  if (!firstTrip || !secondTrip) throw new Error("expected seeded trips missing");
  return { db, shop, author, firstTrip, secondTrip };
}

describe("seat offers", () => {
  it("leaves the offer open when the diver already has a booking on that departure", async () => {
    const { db, shop, firstTrip } = await invitationContext();
    const email = "already-booked-offer@example.com";
    const existing = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: firstTrip.id,
      fullName: "Already Booked Diver",
      email,
    });
    expect(existing.ok).toBe(true);

    const [request] = await db
      .insert(interests)
      .values({
        shopId: shop.id,
        scope: "date",
        askedBy: "diver",
        interest: "reef dive",
        partySize: 2,
        name: "Party with an existing booking",
        email: "existing-booking-party@example.com",
      })
      .returning();
    if (!request) throw new Error("date request insert failed");
    await db.insert(interests).values({
      shopId: shop.id,
      scope: "departure",
      askedBy: "diver",
      tripId: firstTrip.id,
      parentInterestId: request.id,
      partySize: 2,
      offeredAt: nowDate(),
    });

    const duplicate = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: firstTrip.id,
      fullName: "Already Booked Diver",
      email,
      dateRequestInterestId: request.id,
    });
    expect(duplicate).toEqual({ ok: false, reason: "already_booked" });
    const [stillOpen] = await db
      .select({ closedAt: interests.closedAt, closedAs: interests.closedAs })
      .from(interests)
      .where(eq(interests.id, request.id));
    expect(stillOpen).toEqual({ closedAt: null, closedAs: null });
  });

  it("closes a date request only when the offered party is fully seated", async () => {
    const { db, shop, firstTrip } = await invitationContext();
    const [request] = await db
      .insert(interests)
      .values({
        shopId: shop.id,
        scope: "date",
        askedBy: "diver",
        interest: "reef dive",
        partySize: 2,
        name: "Two divers",
        email: "request-party@example.com",
      })
      .returning();
    if (!request) throw new Error("date request insert failed");
    await db.insert(interests).values({
      shopId: shop.id,
      scope: "departure",
      askedBy: "diver",
      tripId: firstTrip.id,
      parentInterestId: request.id,
      partySize: 2,
      offeredAt: nowDate(),
    });

    const first = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: firstTrip.id,
      fullName: "First party member",
      email: "first-party-member@example.com",
      dateRequestInterestId: request.id,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(`first party seat refused: ${first.reason}`);
    expect(first.dateRequestPartyComplete).toBe(false);
    const [stillOpen] = await db
      .select({ closedAt: interests.closedAt, closedAs: interests.closedAs })
      .from(interests)
      .where(eq(interests.id, request.id));
    expect(stillOpen).toEqual({ closedAt: null, closedAs: null });

    const second = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: firstTrip.id,
      fullName: "Second party member",
      email: "second-party-member@example.com",
      dateRequestInterestId: request.id,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(`second party seat refused: ${second.reason}`);
    expect(second.dateRequestPartyComplete).toBe(true);
    const [closed] = await db
      .select({ closedAt: interests.closedAt, closedAs: interests.closedAs })
      .from(interests)
      .where(eq(interests.id, request.id));
    expect(closed?.closedAt).toBeInstanceOf(Date);
    expect(closed?.closedAs).toBe("booked");

    const overflow = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: firstTrip.id,
      fullName: "Third party member",
      email: "third-party-member@example.com",
      dateRequestInterestId: request.id,
    });
    expect(overflow).toEqual({ ok: false, reason: "date_request_party_full" });
  });

  it("records a shop interest for an existing diver without seating them", async () => {
    const { db, shop, author, firstTrip } = await invitationContext();
    const [candidate] = await listBookableDivers(db, shop.id, firstTrip.id, {
      query: "mail.example",
    });
    if (!candidate) throw new Error("expected a bookable seeded diver");

    const ask = {
      shopId: shop.id,
      tripId: firstTrip.id,
      personId: candidate.person.id,
      createdByPersonId: author.id,
    };
    expect(await ensureDepartureInterest(db, ask)).toMatchObject({ created: true });
    expect(await ensureDepartureInterest(db, ask)).toMatchObject({ created: false });

    const [listed] = await listDepartureInterests(db, shop.id, firstTrip.id);
    expect(listed?.interest.askedBy).toBe("shop");
    expect(listed?.person?.id).toBe(candidate.person.id);
    expect(await getTripRoster(db, shop.id, firstTrip.id)).toHaveLength(0);
  });

  it("refuses a shop interest for an erased or merged person", async () => {
    const { db, shop, author, firstTrip } = await invitationContext({ fresh: true });
    const [candidate, other] = await listBookableDivers(db, shop.id, firstTrip.id, {
      query: "mail.example",
    });
    if (!candidate || !other) throw new Error("expected two bookable seeded divers");
    const now = nowDate();
    await db
      .update(people)
      .set({ anonymizedAt: now, deletedAt: now })
      .where(eq(people.id, candidate.person.id));
    await db
      .update(people)
      .set({
        mergedIntoPersonId: author.id,
        mergedAt: now,
        mergedByPersonId: author.id,
        deletedAt: now,
      })
      .where(eq(people.id, other.person.id));

    for (const personId of [candidate.person.id, other.person.id]) {
      expect(
        await ensureDepartureInterest(db, {
          shopId: shop.id,
          tripId: firstTrip.id,
          personId,
          createdByPersonId: author.id,
        }),
      ).toBeNull();
    }
    expect(await listDepartureInterests(db, shop.id, firstTrip.id)).toHaveLength(0);
  });

  /** UX review 2026-10-11, item 14: the no-show's "another day", sent in one tap. */
  it("offers a departure to a diver, again on a second tap, never seating them", async () => {
    const { db, shop, author, firstTrip } = await invitationContext();
    const [candidate] = await listBookableDivers(db, shop.id, firstTrip.id, {
      query: "mail.example",
    });
    if (!candidate) throw new Error("expected a bookable seeded diver");
    const input = {
      shopId: shop.id,
      shopSlug: shop.slug,
      tripId: firstTrip.id,
      personId: candidate.person.id,
      createdByPersonId: author.id,
    };
    // No mail provider in tests: the honest answer is the fallback, never "sent".
    await expect(offerDepartureToDiver(db, input)).resolves.toBe("fallback");
    await expect(offerDepartureToDiver(db, input)).resolves.toBe("fallback");
    const listed = await listDepartureInterests(db, shop.id, firstTrip.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.interest.offeredAt).toBeInstanceOf(Date);
    expect(await getTripRoster(db, shop.id, firstTrip.id)).toHaveLength(0);
  });

  /**
   * Issue #2480: a double tap at a busy counter sent two commercial emails,
   * because every send stamps a fresh `offeredAt` and so a fresh idempotency
   * key. Mail that went out under an hour ago answers "already sent".
   */
  describe("a second tap on Email them this date", () => {
    async function offerInput({ fresh = false } = {}) {
      const { db, shop, author, firstTrip } = await invitationContext({ fresh });
      const [candidate] = await listBookableDivers(db, shop.id, firstTrip.id, {
        query: "mail.example",
      });
      if (!candidate) throw new Error("expected a bookable seeded diver");
      return {
        db,
        input: {
          shopId: shop.id,
          shopSlug: shop.slug,
          tripId: firstTrip.id,
          personId: candidate.person.id,
          createdByPersonId: author.id,
        },
      };
    }

    it("sends one email for two taps, and says so on the second", async () => {
      const { db, input } = await offerInput();
      const mail = fakeEmail();
      await expect(offerDepartureToDiver(db, input, mail.provider)).resolves.toBe("sent");
      await expect(offerDepartureToDiver(db, input, mail.provider)).resolves.toBe("already_sent");
      expect(mail.sent).toHaveLength(1);
    });

    it("sends one email for two taps that land together", async () => {
      const { db, input } = await offerInput({ fresh: true });
      const mail = fakeEmail();
      const outcomes = await Promise.all([
        offerDepartureToDiver(db, input, mail.provider),
        offerDepartureToDiver(db, input, mail.provider),
      ]);
      expect(outcomes.sort()).toEqual(["already_sent", "sent"]);
      expect(mail.sent).toHaveLength(1);
    });

    it("sends on the second tap when the first one's mail did not go", async () => {
      const { db, input } = await offerInput();
      const failed = fakeEmail({ status: "failed", retryable: false, errorCode: "rejected" });
      await expect(offerDepartureToDiver(db, input, failed.provider)).resolves.toBe("fallback");
      const mail = fakeEmail();
      await expect(offerDepartureToDiver(db, input, mail.provider)).resolves.toBe("sent");
      expect(mail.sent).toHaveLength(1);
    });

    /**
     * Issue #2133: an offer is a cold invitation, so the day's window holds it
     * too. Mail that went in the last 24 hours, from the counter or from the
     * guests page, answers "already sent".
     */
    it("answers already sent two hours on, and sends again once the day has passed", async () => {
      const { db, input } = await offerInput();
      const mail = fakeEmail();
      await expect(offerDepartureToDiver(db, input, mail.provider)).resolves.toBe("sent");
      const ago = async (hours: number) => {
        const at = new Date(nowDate().getTime() - hours * 3_600_000);
        await db
          .update(interests)
          .set({ offeredAt: at, emailedAt: at })
          .where(eq(interests.tripId, input.tripId));
        await db
          .update(activityEvents)
          .set({ occurredAt: at })
          .where(eq(activityEvents.tripId, input.tripId));
      };
      await ago(2);
      await expect(offerDepartureToDiver(db, input, mail.provider)).resolves.toBe("already_sent");
      await ago(24);
      await expect(offerDepartureToDiver(db, input, mail.provider)).resolves.toBe("sent");
      expect(mail.sent).toHaveLength(2);
    });

    it("answers already sent after the guests page emailed the diver minutes ago", async () => {
      const { db, input } = await offerInput();
      const mail = fakeEmail();
      const interest = await ensureDepartureInterest(db, input);
      if (!interest) throw new Error("shop interest missing");
      await expect(
        deliverSeatOffer(db, { ...input, interestId: interest.interestId }, mail.provider),
      ).resolves.toBe("sent");
      const fiveMinutesAgo = new Date(nowDate().getTime() - 5 * 60_000);
      await db
        .update(interests)
        .set({ offeredAt: fiveMinutesAgo, emailedAt: fiveMinutesAgo })
        .where(eq(interests.id, interest.interestId));

      await expect(offerDepartureToDiver(db, input, mail.provider)).resolves.toBe("already_sent");
      expect(mail.sent).toHaveLength(1);
    });
  });

  it("does not email a diver who turned off shop email", async () => {
    const { db, shop, author, firstTrip } = await invitationContext();
    const [candidate] = await listBookableDivers(db, shop.id, firstTrip.id, {
      query: "mail.example",
    });
    if (!candidate) throw new Error("expected a bookable seeded diver");
    await db
      .update(people)
      .set({ courtesyEmailOptOutAt: nowDate() })
      .where(eq(people.id, candidate.person.id));
    await expect(
      offerDepartureToDiver(db, {
        shopId: shop.id,
        shopSlug: shop.slug,
        tripId: firstTrip.id,
        personId: candidate.person.id,
        createdByPersonId: author.id,
      }),
    ).resolves.toBe("opted_out");
  });

  it("offers nothing to a diver already on that departure, or to another shop's", async () => {
    const { db, shop, author, firstTrip } = await invitationContext();
    const booked = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: firstTrip.id,
      fullName: "Already Aboard",
      email: "already-aboard@example.com",
    });
    if (!booked.ok) throw new Error("booking failed");
    await expect(
      offerDepartureToDiver(db, {
        shopId: shop.id,
        shopSlug: shop.slug,
        tripId: firstTrip.id,
        personId: booked.personId,
        createdByPersonId: author.id,
      }),
    ).resolves.toBe("unavailable");
    await expect(
      offerDepartureToDiver(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        shopSlug: shop.slug,
        tripId: firstTrip.id,
        personId: booked.personId,
        createdByPersonId: author.id,
      }),
    ).resolves.toBe("unavailable");
  });
  /**
   * Dive-domain review of layer 8, F1: the offer must name a departure the
   * diver could actually book from the link, or the notice that it was sent
   * is a promise the booking form then breaks. Each refusal sends nothing and
   * leaves no invitation behind.
   */
  describe("offers only a departure the diver could book", () => {
    async function freshDiver(
      db: Awaited<ReturnType<typeof invitationContext>>["db"],
      shopId: string,
    ) {
      const [person] = await db
        .insert(people)
        .values({ shopId, fullName: "Offer Olive", email: "offer.olive@example.com" })
        .returning({ id: people.id });
      if (!person) throw new Error("person insert failed");
      await db.insert(personRoles).values({ personId: person.id, role: "diver" });
      return person.id;
    }

    async function expectNothingSent(
      ctx: Awaited<ReturnType<typeof invitationContext>>,
      personId: string,
    ) {
      await expect(
        offerDepartureToDiver(ctx.db, {
          shopId: ctx.shop.id,
          shopSlug: ctx.shop.slug,
          tripId: ctx.firstTrip.id,
          personId,
          createdByPersonId: ctx.author.id,
        }),
      ).resolves.toBe("unavailable");
      const rows = await ctx.db
        .select({ id: interests.id })
        .from(interests)
        .where(and(eq(interests.tripId, ctx.firstTrip.id), eq(interests.personId, personId)));
      expect(rows).toEqual([]);
    }

    it("refuses a full departure", async () => {
      const ctx = await invitationContext();
      const personId = await freshDiver(ctx.db, ctx.shop.id);
      const held = await createBooking(ctx.db, {
        actor: "staff",
        shopId: ctx.shop.id,
        tripId: ctx.firstTrip.id,
        fullName: "Last Seat Lou",
        email: "last.seat.lou@example.com",
      });
      if (!held.ok) throw new Error("booking failed");
      const roster = await getTripRoster(ctx.db, ctx.shop.id, ctx.firstTrip.id);
      await ctx.db
        .update(tripsTable)
        .set({ capacity: roster.length })
        .where(eq(tripsTable.id, ctx.firstTrip.id));
      await expectNothingSent(ctx, personId);
    });

    it("refuses a departure that has already left", async () => {
      const ctx = await invitationContext();
      const personId = await freshDiver(ctx.db, ctx.shop.id);
      const now = nowDate();
      await ctx.db
        .update(tripsTable)
        .set({
          // diveday:allow-flat-revision: a fixture moving the clock, not a reschedule.
          startsAt: new Date(now.getTime() - 10 * 60 * 1000),
          endsAt: new Date(now.getTime() + 3 * 60 * 60 * 1000),
        })
        .where(eq(tripsTable.id, ctx.firstTrip.id));
      await expectNothingSent(ctx, personId);
    });

    it("refuses a departure whose requirement the diver does not meet", async () => {
      const ctx = await invitationContext();
      const personId = await freshDiver(ctx.db, ctx.shop.id);
      // An Open Water card on file, so admission judges them (a diver the shop
      // knows nothing about is admitted blind, H-20260724-certification-levels-agency-rules) and finds them short.
      await ctx.db.insert(certifications).values({
        shopId: ctx.shop.id,
        personId,
        agency: "padi",
        level: "open_water",
        identifier: "OW-OFFER-1",
        status: "verified",
      });
      await ctx.db
        .insert(tripRequirements)
        .values({
          tripId: ctx.firstTrip.id,
          shopId: ctx.shop.id,
          minimumCertificationLevel: "advanced_open_water",
        })
        .onConflictDoUpdate({
          target: tripRequirements.tripId,
          set: { minimumCertificationLevel: "advanced_open_water" },
        });
      await expectNothingSent(ctx, personId);
    });

    it("refuses a private charter", async () => {
      const ctx = await invitationContext();
      const personId = await freshDiver(ctx.db, ctx.shop.id);
      await ctx.db
        .update(tripsTable)
        .set({ isPrivate: true })
        .where(eq(tripsTable.id, ctx.firstTrip.id));
      await expectNothingSent(ctx, personId);
    });

    /**
     * #2484: a `no_show` row on a departure still ahead is booked again the way
     * a cancelled one is, so the offer is not refused for it. A live booking
     * still is, and so is a no-show once the departure has started.
     */
    it("refuses a departure the diver holds a live booking row on", async () => {
      const ctx = await invitationContext();
      const booked = await createBooking(ctx.db, {
        actor: "staff",
        shopId: ctx.shop.id,
        tripId: ctx.firstTrip.id,
        fullName: "Still Booked",
        email: "still.booked@example.com",
      });
      if (!booked.ok) throw new Error("booking failed");
      await expectNothingSent(ctx, booked.personId);
    });

    it("offers a departure to a diver marked no-show on it while it is still ahead", async () => {
      const ctx = await invitationContext();
      const booked = await createBooking(ctx.db, {
        actor: "staff",
        shopId: ctx.shop.id,
        tripId: ctx.firstTrip.id,
        fullName: "Marked Absent",
        email: "marked.absent@example.com",
      });
      if (!booked.ok) throw new Error("booking failed");
      await ctx.db
        .update(bookings)
        .set({ status: "no_show" })
        .where(eq(bookings.id, booked.bookingId));
      const mail = fakeEmail();
      await expect(
        offerDepartureToDiver(
          ctx.db,
          {
            shopId: ctx.shop.id,
            shopSlug: ctx.shop.slug,
            tripId: ctx.firstTrip.id,
            personId: booked.personId,
            createdByPersonId: ctx.author.id,
          },
          mail.provider,
        ),
      ).resolves.toBe("sent");
      expect(mail.sent).toHaveLength(1);
    });
  });
});
