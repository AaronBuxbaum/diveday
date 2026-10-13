import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { createBooking } from "./bookings";
import { recordCourseInquiry } from "./course-inquiries";
import { getCourseBySlug } from "./courses";
import { listBookableDivers } from "./divers";
import { loadShopExportBundleInput } from "./export";
import {
  activityEvents,
  bookings,
  certifications,
  people,
  personRoles,
  shops,
  tripInvitations,
  tripRequirements,
  trips as tripsTable,
} from "./schema";
import {
  createDirectTripInvitation,
  createTripRequestInvitations,
  listTripInvitations,
  offerDepartureToDiver,
  recordTripInvitation,
} from "./trip-invitations";
import { getTripRoster, getTripWithBooked, upcomingTripsWithCounts } from "./trips";
import { createTrip } from "./trips-create";

async function invitationContext() {
  const { db, shop } = await seededShopContext();
  const course = await getCourseBySlug(db, shop.id, "open-water-diver");
  if (!course) throw new Error("expected seeded course missing");
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
  return { db, shop, course, author, firstTrip, secondTrip };
}

async function makeRequest(
  db: Awaited<ReturnType<typeof invitationContext>>["db"],
  shopId: string,
  courseId: string,
  name: string,
) {
  return recordCourseInquiry(db, {
    shopId,
    courseId,
    name,
    email: `${name.toLowerCase().replaceAll(" ", ".")}@example.com`,
    experienceLevel: "certified",
    divers: 2,
  });
}

describe("trip invitations", () => {
  it("keeps request outreach outside capacity and allows one request on multiple trips", async () => {
    const { db, shop, course, author, firstTrip, secondTrip } = await invitationContext();
    const request = await makeRequest(db, shop.id, course.id, "Invitation Iris");
    const bookedBefore = await getTripWithBooked(db, shop.id, firstTrip.id);
    const rosterBefore = await getTripRoster(db, shop.id, firstTrip.id);

    await expect(
      createTripRequestInvitations(db, {
        shopId: shop.id,
        tripId: firstTrip.id,
        requestIds: [request.id],
        createdByPersonId: author.id,
      }),
    ).resolves.toBe(1);
    await expect(
      createTripRequestInvitations(db, {
        shopId: shop.id,
        tripId: firstTrip.id,
        requestIds: [request.id],
        createdByPersonId: author.id,
      }),
    ).resolves.toBe(0);
    await expect(
      createTripRequestInvitations(db, {
        shopId: shop.id,
        tripId: secondTrip.id,
        requestIds: [request.id],
        createdByPersonId: author.id,
      }),
    ).resolves.toBe(1);

    expect(await getTripWithBooked(db, shop.id, firstTrip.id)).toMatchObject({
      booked: bookedBefore?.booked,
    });
    expect(await getTripRoster(db, shop.id, firstTrip.id)).toHaveLength(rosterBefore.length);
    expect(await listTripInvitations(db, shop.id, firstTrip.id)).toHaveLength(1);
    expect(await listTripInvitations(db, shop.id, secondTrip.id)).toHaveLength(1);

    const bundle = await loadShopExportBundleInput(db, shop.id);
    const invitationTable = bundle?.tables.find((table) => table.file === "trip_invitations.csv");
    expect(invitationTable?.rows).toHaveLength(2);
    expect(invitationTable?.rows[0]?.[invitationTable.header.indexOf("source")]).toBe(
      "date_request",
    );
    expect(invitationTable?.rows[0]?.[invitationTable.header.indexOf("person_name")]).toBe(
      "Invitation Iris",
    );
  });

  it("shows the request contact and records outreach without creating a booking", async () => {
    const { db, shop, course, author, firstTrip, secondTrip } = await invitationContext();
    const request = await makeRequest(db, shop.id, course.id, "Invitation Ines");
    await createTripRequestInvitations(db, {
      shopId: shop.id,
      tripId: firstTrip.id,
      requestIds: [request.id],
      createdByPersonId: author.id,
    });

    const [listed] = await listTripInvitations(db, shop.id, firstTrip.id);
    if (!listed) throw new Error("invitation was not listed");
    expect(listed.request?.name).toBe("Invitation Ines");
    expect(listed.invitation.invitedAt).toBeNull();

    const now = new Date("2026-08-16T15:00:00.000Z");
    await expect(
      recordTripInvitation(db, {
        shopId: shop.id,
        tripId: firstTrip.id,
        invitationId: listed.invitation.id,
        now,
      }),
    ).resolves.toBe(true);
    const [after] = await listTripInvitations(db, shop.id, firstTrip.id);
    expect(after?.invitation.invitedAt?.toISOString()).toBe(now.toISOString());
    expect(await getTripRoster(db, shop.id, firstTrip.id)).toHaveLength(0);

    await expect(
      recordTripInvitation(db, {
        shopId: shop.id,
        tripId: secondTrip.id,
        invitationId: listed.invitation.id,
      }),
    ).resolves.toBe(false);
  });

  it("supports a direct existing-diver invitation without seating them", async () => {
    const { db, shop, author, firstTrip } = await invitationContext();
    const [candidate] = await listBookableDivers(db, shop.id, firstTrip.id, {
      query: "mail.example",
    });
    if (!candidate) throw new Error("expected a bookable seeded diver");

    await expect(
      createDirectTripInvitation(db, {
        shopId: shop.id,
        tripId: firstTrip.id,
        personId: candidate.person.id,
        createdByPersonId: author.id,
      }),
    ).resolves.toBe(true);
    await expect(
      createDirectTripInvitation(db, {
        shopId: shop.id,
        tripId: firstTrip.id,
        personId: candidate.person.id,
        createdByPersonId: author.id,
      }),
    ).resolves.toBe(false);

    const [listed] = await listTripInvitations(db, shop.id, firstTrip.id);
    expect(listed?.invitation.source).toBe("direct");
    expect(listed?.person?.id).toBe(candidate.person.id);
    expect(await getTripRoster(db, shop.id, firstTrip.id)).toHaveLength(0);
  });

  it("does not attach a request across shop boundaries", async () => {
    const { db, shop, course, author, firstTrip } = await invitationContext();
    const request = await makeRequest(db, shop.id, course.id, "Tenant Tina");
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Invitation Shop", slug: "other-invitation-shop", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("other shop setup failed");
    const otherTrip = await createTrip(db, {
      shopId: otherShop.id,
      title: "Other Trip",
      startsAt: new Date("2026-09-01T12:00:00.000Z"),
      endsAt: new Date("2026-09-01T16:00:00.000Z"),
      capacity: 12,
    });
    if (!otherTrip) throw new Error("other trip setup failed");

    await expect(
      createTripRequestInvitations(db, {
        shopId: otherShop.id,
        tripId: otherTrip.id,
        requestIds: [request.id],
        createdByPersonId: author.id,
      }),
    ).resolves.toBe(0);
    expect(await listTripInvitations(db, otherShop.id, otherTrip.id)).toEqual([]);
    expect(await listTripInvitations(db, shop.id, firstTrip.id)).toEqual([]);
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
    const listed = await listTripInvitations(db, shop.id, firstTrip.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.invitation.invitedAt).toBeInstanceOf(Date);
    expect(await getTripRoster(db, shop.id, firstTrip.id)).toHaveLength(0);
  });

  /**
   * Issue #2480: a double tap at a busy counter sent two commercial emails,
   * because every send stamps a fresh `invitedAt` and so a fresh idempotency
   * key. Mail that went out under an hour ago answers "already sent".
   */
  describe("a second tap on Email them this date", () => {
    async function offerInput() {
      const { db, shop, author, firstTrip } = await invitationContext();
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
      const { db, input } = await offerInput();
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

    it("sends again once the hour has passed", async () => {
      const { db, input } = await offerInput();
      const mail = fakeEmail();
      await expect(offerDepartureToDiver(db, input, mail.provider)).resolves.toBe("sent");
      const earlier = new Date(nowDate().getTime() - 2 * 3_600_000);
      await db
        .update(tripInvitations)
        .set({ invitedAt: earlier })
        .where(eq(tripInvitations.tripId, input.tripId));
      await db
        .update(activityEvents)
        .set({ occurredAt: earlier })
        .where(eq(activityEvents.tripId, input.tripId));
      await expect(offerDepartureToDiver(db, input, mail.provider)).resolves.toBe("sent");
      expect(mail.sent).toHaveLength(2);
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
        .select({ id: tripInvitations.id })
        .from(tripInvitations)
        .where(
          and(eq(tripInvitations.tripId, ctx.firstTrip.id), eq(tripInvitations.personId, personId)),
        );
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
      // knows nothing about is admitted blind, H-08) and finds them short.
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
     * F2 (the review asked for seat-held statuses here). A `no_show` row on the
     * offered departure still refuses the offer on purpose: `bookings` is
     * unique on (trip, person) and the booking form answers `already_booked`
     * for any row that is not cancelled, so the link would not seat them.
     */
    it("refuses a departure the diver already has a booking row on, whatever its status", async () => {
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
      await expectNothingSent(ctx, booked.personId);
    });
  });
});
