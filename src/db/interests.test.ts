import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { deliverSeatOffer } from "./interest-offers";
import {
  askForDeparture,
  askForDepartureAsKnownDiver,
  ensureDepartureInterest,
  getDepartureInterestForTrip,
  listDepartureInterests,
} from "./interests";
import { bookings, courses, interests, people, personRoles, shops } from "./schema";
import { listCertificationSummaries } from "./self-declared-cards";
import {
  createTrip,
  getTripRoster,
  getTripWithBooked,
  listStaff,
  setTripCrew,
  upcomingTripsWithCounts,
} from "./trips";

async function seededContext() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const fullTrip = trips.find((trip) => trip.title === "Wreck Trip — Spiegel Grove");
  const openTrip = trips.find((trip) => trip.title === "Two-Tank Reef — Christ of the Abyss");
  if (!fullTrip || !openTrip) throw new Error("expected seeded trips missing");
  return { db, shop, fullTrip, openTrip };
}

const visitor = { fullName: "Nora Quinn", email: "nora@example.com", phone: "+1-305-555-0199" };

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

describe("askForDeparture (in-memory PGlite)", () => {
  it("adds a new diver to a full trip without consuming a seat", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const outcome = await askForDeparture(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      ...visitor,
    });

    expect(outcome).toMatchObject({ ok: true, personName: "Nora Quinn" });
    expect(await getTripRoster(db, shop.id, fullTrip.id)).toHaveLength(fullTrip.capacity);
  });

  it("keeps one entry per diver and trip, dated when they first asked", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const first = await askForDeparture(db, { shopId: shop.id, tripId: fullTrip.id, ...visitor });
    const again = await askForDeparture(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      ...visitor,
      email: "NORA@example.com",
    });

    expect(first).toMatchObject({ ok: true });
    expect(again).toMatchObject({
      ok: false,
      reason: "already_waitlisted",
      interestId: first.interestId,
    });
  });

  /**
   * The wait-list half of H-20260724-one-person-per-email's borrowed-identity rule — see the twin in
   * `last-minute-list.test.ts` for why a certification is the one write on this
   * unauthenticated fork that a mismatched name has to stop.
   */
  it("does not write a declaration onto a person whose name does not match", async () => {
    const { db, shop, fullTrip } = await seededContext();
    await askForDeparture(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      ...visitor,
      declaration: { level: "open_water", noCertification: false, nitrox: false },
    });
    const [person] = await db.select().from(people).where(eq(people.email, visitor.email));
    if (!person) throw new Error("setup: joiner not created");

    const again = await askForDeparture(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      email: visitor.email,
      fullName: "Someone Else Entirely",
      declaration: { level: "instructor", noCertification: false, nitrox: true },
    });

    // The entry side is unchanged — a second submission on an existing entry is
    // `already_waitlisted` either way. Only the evidence write is gated.
    expect(again).toMatchObject({ ok: false, reason: "already_waitlisted" });
    const profile = (await listCertificationSummaries(db, shop.id, [person.id])).get(person.id);
    expect(profile?.level).toBe("open_water");
    expect(profile?.nitrox).toBe(false);
  });

  it("refuses a wait-list entry while a spot is available", async () => {
    const { db, shop, openTrip } = await seededContext();
    await expect(
      askForDeparture(db, { shopId: shop.id, tripId: openTrip.id, ...visitor }),
    ).resolves.toEqual({ ok: false, reason: "trip_available" });
    const trip = await getTripWithBooked(db, shop.id, openTrip.id);
    expect(trip?.booked).toBe(openTrip.booked);
  });

  /**
   * **The same full/not-full decision the booking door makes** — `seatHeld`,
   * not "every status but cancelled" (issue #1209).
   *
   * The counter can release a seat from the dock call onwards, which is inside
   * the window this form is still open in. Counting the released row as held
   * would put a diver on an interest list for a boat `createBooking` would have
   * sold them outright, and the two doors would be saying opposite things
   * about the same departure at the same moment.
   */
  it("sends a diver to book rather than to wait, once a seat is released", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const roster = await getTripRoster(db, shop.id, fullTrip.id);
    const released = roster[0];
    if (!released) throw new Error("expected the full trip to have a roster");
    await db
      .update(bookings)
      .set({ status: "no_show" })
      .where(eq(bookings.id, released.booking.id));

    await expect(
      askForDeparture(db, { shopId: shop.id, tripId: fullTrip.id, ...visitor }),
    ).resolves.toEqual({ ok: false, reason: "trip_available" });
  });
});

/**
 * **The desk picks a diver on file for the wait list** (Aaron, 2026-10-23):
 * the record is reused, never typed again, under the same full/not-full
 * decision the typed door makes.
 */
describe("askForDepartureAsKnownDiver", () => {
  async function knownDiver() {
    const { db, shop } = ctx;
    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Ines Duarte", email: "ines@example.com" })
      .returning();
    if (!person) throw new Error("setup: no person");
    await db.insert(personRoles).values({ personId: person.id, role: "diver" });
    return person;
  }

  it("puts the diver on file on a full trip's list as their own ask, adding nobody", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const person = await knownDiver();
    const before = await db.select({ id: people.id }).from(people);

    const outcome = await askForDepartureAsKnownDiver(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      personId: person.id,
    });

    expect(outcome).toMatchObject({ ok: true, personName: "Ines Duarte" });
    const rows = await listDepartureInterests(db, shop.id, fullTrip.id);
    const row = rows.find((r) => r.person?.id === person.id);
    expect(row?.interest.askedBy).toBe("diver");
    expect(await db.select({ id: people.id }).from(people)).toHaveLength(before.length);
  });

  it("refuses while a seat is open, as the typed door does", async () => {
    const { db, shop, openTrip } = await seededContext();
    const person = await knownDiver();
    await expect(
      askForDepartureAsKnownDiver(db, {
        shopId: shop.id,
        tripId: openTrip.id,
        personId: person.id,
      }),
    ).resolves.toEqual({ ok: false, reason: "trip_available" });
  });

  it("makes a cold invitation the diver's own ask, keeping the one row", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const person = await knownDiver();
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("setup: no staff");
    const invited = await ensureDepartureInterest(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      personId: person.id,
      createdByPersonId: staff.person.id,
    });

    const outcome = await askForDepartureAsKnownDiver(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      personId: person.id,
    });

    expect(outcome).toMatchObject({
      ok: false,
      reason: "already_waitlisted",
      interestId: invited?.interestId,
    });
    const [row] = await db.select().from(interests).where(eq(interests.personId, person.id));
    expect(row?.askedBy).toBe("diver");
  });

  it("refuses someone who is not this shop's live diver", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const person = await knownDiver();
    await db
      .update(people)
      .set({ deletedAt: new Date(nowMs()) })
      .where(eq(people.id, person.id));
    await expect(
      askForDepartureAsKnownDiver(db, {
        shopId: shop.id,
        tripId: fullTrip.id,
        personId: person.id,
      }),
    ).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a diver who already holds a seat on the trip", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const [seat] = await getTripRoster(db, shop.id, fullTrip.id);
    if (!seat) throw new Error("setup: empty roster");
    await expect(
      askForDepartureAsKnownDiver(db, {
        shopId: shop.id,
        tripId: fullTrip.id,
        personId: seat.booking.personId,
      }),
    ).resolves.toEqual({ ok: false, reason: "already_booked" });
  });
});

/**
 * **A wait-list party** (fourth UX review, item 34; ADR 20260719-trip-waitlist,
 * amended): a couple waits together for the full Saturday as one entry of two,
 * and a boat with one seat left is still full for them.
 */
describe("askForDeparture for a party", () => {
  async function interest(id: string | undefined) {
    if (!id) throw new Error("expected an entry");
    const [row] = await ctx.db.select().from(interests).where(eq(interests.id, id));
    return row;
  }

  it("records the party on one entry", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const outcome = await askForDeparture(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      ...visitor,
      partySize: 2,
    });
    expect(outcome).toMatchObject({ ok: true });
    expect((await interest(outcome.interestId))?.partySize).toBe(2);
  });

  it("waits a pair on a boat with one seat left, and sends one diver to book it", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const [released] = await getTripRoster(db, shop.id, fullTrip.id);
    if (!released) throw new Error("expected the full trip to have a roster");
    await db
      .update(bookings)
      .set({ status: "no_show" })
      .where(eq(bookings.id, released.booking.id));

    await expect(
      askForDeparture(db, { shopId: shop.id, tripId: fullTrip.id, ...visitor }),
    ).resolves.toEqual({ ok: false, reason: "trip_available" });
    const pair = await askForDeparture(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      ...visitor,
      partySize: 2,
    });
    expect(pair).toMatchObject({ ok: true });
  });

  it("updates the party when the joiner asks again", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const first = await askForDeparture(db, { shopId: shop.id, tripId: fullTrip.id, ...visitor });
    const again = await askForDeparture(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      ...visitor,
      partySize: 3,
    });
    expect(again).toMatchObject({
      ok: false,
      reason: "already_waitlisted",
      interestId: first.interestId,
    });
    expect((await interest(first.interestId))?.partySize).toBe(3);
  });

  /**
   * The form says "up to the boat's seats", and the server holds it there: a
   * hand-posted party of twenty on a smaller boat would otherwise count twenty
   * seats of demand on the staff roster (security review r4-4, F1).
   */
  it("holds a party larger than the boat to the boat's seats", async () => {
    const { db, shop, fullTrip } = await seededContext();
    expect(fullTrip.capacity).toBeLessThan(20);
    const outcome = await askForDeparture(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      ...visitor,
      partySize: fullTrip.capacity + 5,
    });
    expect(outcome).toMatchObject({ ok: true });
    expect((await interest(outcome.interestId))?.partySize).toBe(fullTrip.capacity);

    await askForDeparture(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      ...visitor,
      partySize: 99,
    });
    expect((await interest(outcome.interestId))?.partySize).toBe(fullTrip.capacity);
  });
});

describe("deliverSeatOffer on a wait-list interest", () => {
  const T = new Date("2026-07-21T10:00:00.000Z");

  async function joined() {
    const { db, shop, fullTrip } = await seededContext();
    const outcome = await askForDeparture(db, { shopId: shop.id, tripId: fullTrip.id, ...visitor });
    if (!outcome.ok) throw new Error(`join failed: ${outcome.reason}`);
    const find = async () =>
      (await listDepartureInterests(db, shop.id, fullTrip.id)).find(
        (row) => row.interest.id === outcome.interestId,
      );
    return { db, shop, fullTrip, interestId: outcome.interestId, find };
  }

  it("stamps the interest as offered and reports the composer fallback when email isn't configured", async () => {
    // The test environment sets neither APP_HOST nor SES_*, so a real send
    // can't happen and the delivery degrades to the fallback — while the offer
    // is still durably recorded.
    const { db, shop, fullTrip, interestId, find } = await joined();
    await expect(
      deliverSeatOffer(db, {
        shopId: shop.id,
        shopSlug: "blue-mantis",
        tripId: fullTrip.id,
        interestId,
        now: T,
      }),
    ).resolves.toBe("fallback");
    expect((await find())?.interest.offeredAt?.toISOString()).toBe(T.toISOString());
    // The mail did not go, so it holds no 24-hour window.
    expect((await find())?.interest.emailedAt).toBeNull();
  });

  it("moves the stamp forward on a re-offer instead of adding a row", async () => {
    const { db, shop, fullTrip, interestId, find } = await joined();
    const input = { shopId: shop.id, shopSlug: "blue-mantis", tripId: fullTrip.id, interestId };
    await deliverSeatOffer(db, { ...input, now: T });
    const later = new Date(T.getTime() + 2 * 3_600_000);
    await deliverSeatOffer(db, { ...input, now: later });
    expect((await find())?.interest.offeredAt?.toISOString()).toBe(later.toISOString());
    expect(await listDepartureInterests(db, shop.id, fullTrip.id)).toHaveLength(1);
  });

  it("still offers the seat a diver waited for after they opted out of courtesy email", async () => {
    // Leo — self-serve email unsubscribe. H-20261005-one-interest-table-names D-2 option (b), H-20261006-staff-trip-invitation-service's own
    // test: the diver asked for this boat, so the offer is service mail and
    // `people.courtesyEmailOptOutAt` does not silence it. Here it degrades to
    // the composer only because the test environment has no mail provider.
    const { db, shop, fullTrip, interestId, find } = await joined();
    await db
      .update(people)
      .set({ courtesyEmailOptOutAt: new Date("2026-07-20T00:00:00.000Z") })
      .where(eq(people.email, visitor.email));

    await expect(
      deliverSeatOffer(db, {
        shopId: shop.id,
        shopSlug: "blue-mantis",
        tripId: fullTrip.id,
        interestId,
        now: T,
      }),
    ).resolves.toBe("fallback");
    expect((await find())?.interest.offeredAt?.toISOString()).toBe(T.toISOString());
    expect((await find())?.interest.emailedAt).toBeNull();
  });

  it("does not stamp or offer an interest from another shop", async () => {
    const { db, fullTrip, interestId, find } = await joined();
    await expect(
      deliverSeatOffer(db, {
        shopId: "00000000-0000-4000-8000-000000000099",
        shopSlug: "blue-mantis",
        tripId: fullTrip.id,
        interestId,
      }),
    ).resolves.toBe("fallback");
    expect((await find())?.interest.offeredAt).toBeNull();
  });
});

describe("listDepartureInterests / getDepartureInterestForTrip cross-tenant isolation (CR-007)", () => {
  it("neither shop can read the other's real departure interest by substituting its own trip/interest id", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-waitlist-test", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");

    const joined = await askForDeparture(db, { shopId: shop.id, tripId: fullTrip.id, ...visitor });
    if (!joined.ok) throw new Error(`join failed: ${joined.reason}`);

    // A genuinely different shop, its own trip, its own real entry — not a
    // hardcoded placeholder id — so this proves the query rejects a real
    // mismatched shop_id, not just an id that matches nothing at all.
    const otherTrips = await upcomingTripsWithCounts(db, otherShop.id);
    expect(otherTrips).toEqual([]); // a fresh shop has no seeded trips of its own

    // otherShop's session can't see shop's entry at all.
    expect(await listDepartureInterests(db, otherShop.id, fullTrip.id)).toEqual([]);
    expect(
      await getDepartureInterestForTrip(db, otherShop.id, fullTrip.id, joined.interestId),
    ).toBeNull();

    // shop's own session still can, unaffected by the other shop existing.
    expect(
      await getDepartureInterestForTrip(db, shop.id, fullTrip.id, joined.interestId),
    ).not.toBeNull();
  });
});

/**
 * **A course session full at its instructor ratio takes the wait list**
 * (issue #2679). The sale refuses a student beyond the ratio
 * (`course_ratio_full`) while hull seats stand empty, so a join that measured
 * hull seats alone answered "there is room, book it" and the diver was bounced
 * between two doors. The join now measures a seat the way the sale and the
 * roll's `invitableSeats` do.
 *
 * Discover Scuba is PADI's 2:1 intro ratio (HD-6); 180 days out keeps the
 * seeded instructor's calendar clear, as in `bookings.test.ts`.
 */
describe("askForDeparture on a ratio-full course session (issue #2679)", () => {
  const OFFSET_MS = 180 * 24 * 60 * 60 * 1000;

  async function introSession() {
    const { db, shop } = ctx;
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Discover Scuba Diving")));
    if (!course) throw new Error("Discover Scuba Diving course missing");
    const instructor = (await listStaff(db, shop.id)).find((entry) =>
      entry.roles.includes("instructor"),
    );
    if (!instructor) throw new Error("seeded instructor missing");
    const trip = await createTrip(db, {
      shopId: shop.id,
      courseId: course.id,
      title: "Discover Scuba — wait list",
      startsAt: new Date(nowMs() + OFFSET_MS),
      endsAt: new Date(nowMs() + OFFSET_MS + 4 * 60 * 60 * 1000),
      capacity: 12,
      plannedDives: 2,
    });
    if (!trip) throw new Error("intro session not created");
    if (!(await setTripCrew(db, shop.id, trip.id, [instructor.person.id]))) {
      throw new Error("instructor not assigned");
    }
    return trip;
  }

  async function student(tripId: string, name: string) {
    const outcome = await createBooking(ctx.db, {
      actor: "staff",
      shopId: ctx.shop.id,
      tripId,
      fullName: name,
      email: `${name.toLowerCase().replace(/\W+/g, "-")}@example.com`,
    });
    if (!outcome.ok) throw new Error(`setup booking refused: ${outcome.reason}`);
  }

  it("takes a join once the ratio is full, though hull seats stand empty", async () => {
    const trip = await introSession();
    await student(trip.id, "Ada First");
    await student(trip.id, "Bea Second");
    // The sale is closed on the ratio...
    expect(
      await createBooking(ctx.db, {
        actor: "public",
        shopId: ctx.shop.id,
        tripId: trip.id,
        ...visitor,
      }),
    ).toMatchObject({ ok: false, reason: "course_ratio_full" });
    // ...so the wait list is open.
    expect(
      await askForDeparture(ctx.db, { shopId: ctx.shop.id, tripId: trip.id, ...visitor }),
    ).toMatchObject({ ok: true });
  });

  it("takes a party of two that the ratio cannot seat beside the others", async () => {
    const trip = await introSession();
    await student(trip.id, "Ada First");
    expect(
      await askForDeparture(ctx.db, {
        shopId: ctx.shop.id,
        tripId: trip.id,
        ...visitor,
        partySize: 2,
      }),
    ).toMatchObject({ ok: true });
  });

  it("still sends a diver to book while the ratio has room", async () => {
    const trip = await introSession();
    await student(trip.id, "Ada First");
    expect(
      await askForDeparture(ctx.db, { shopId: ctx.shop.id, tripId: trip.id, ...visitor }),
    ).toEqual({ ok: false, reason: "trip_available" });
  });
});

describe("a shop-asked interest and a diver's own ask are one row", () => {
  async function diverAndOwner() {
    const { db, shop, fullTrip } = await seededContext();
    const asked = await askForDeparture(db, { shopId: shop.id, tripId: fullTrip.id, ...visitor });
    if (!asked.ok) throw new Error(`join failed: ${asked.reason}`);
    const [row] = await db.select().from(interests).where(eq(interests.id, asked.interestId));
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Nora Quinn")));
    return { db, shop, fullTrip, row, ownerId: owner?.id ?? "", interestId: asked.interestId };
  }

  it("keeps the row a waiting diver has when staff offer them the same departure", async () => {
    const { db, shop, fullTrip, row, interestId } = await diverAndOwner();
    if (!row?.personId) throw new Error("setup: interest has no person");
    const ensured = await ensureDepartureInterest(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      personId: row.personId,
      createdByPersonId: row.personId,
    });
    expect(ensured).toEqual({ interestId, created: false });
    expect(await listDepartureInterests(db, shop.id, fullTrip.id)).toHaveLength(1);
  });

  it("refuses a diver, an author or a departure that is not this shop's", async () => {
    const { db, shop, fullTrip, row } = await diverAndOwner();
    if (!row?.personId) throw new Error("setup: interest has no person");
    const stranger = "00000000-0000-4000-8000-000000000099";
    const base = {
      shopId: shop.id,
      tripId: fullTrip.id,
      personId: row.personId,
      createdByPersonId: row.personId,
    };
    expect(await ensureDepartureInterest(db, { ...base, shopId: stranger })).toBeNull();
    expect(await ensureDepartureInterest(db, { ...base, tripId: stranger })).toBeNull();
    expect(await ensureDepartureInterest(db, { ...base, personId: stranger })).toBeNull();
    expect(await ensureDepartureInterest(db, { ...base, createdByPersonId: stranger })).toBeNull();
  });

  it("makes a diver-asked row of a shop-asked one when the diver asks themselves", async () => {
    const { db, shop, fullTrip, row, interestId } = await diverAndOwner();
    if (!row?.personId) throw new Error("setup: interest has no person");
    await db.update(interests).set({ askedBy: "shop" }).where(eq(interests.id, interestId));
    const again = await askForDeparture(db, { shopId: shop.id, tripId: fullTrip.id, ...visitor });
    expect(again).toMatchObject({ ok: false, reason: "already_waitlisted", interestId });
    const [after] = await db.select().from(interests).where(eq(interests.id, interestId));
    expect(after?.askedBy).toBe("diver");
  });

  // Security review of #2656, minor 3: the form is unauthenticated, so a
  // submit under another name with this diver's address may be a second human.
  // It must not reclassify the shop's invitation or rewrite the party.
  it("leaves a shop-asked row alone when someone asks under another name with the diver's address", async () => {
    const { db, shop, fullTrip, interestId } = await diverAndOwner();
    await db
      .update(interests)
      .set({ askedBy: "shop", partySize: 1 })
      .where(eq(interests.id, interestId));
    const again = await askForDeparture(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      ...visitor,
      fullName: "Someone Else",
      partySize: 3,
    });
    expect(again).toMatchObject({ ok: false, reason: "already_waitlisted", interestId });
    const [after] = await db.select().from(interests).where(eq(interests.id, interestId));
    expect(after).toMatchObject({ askedBy: "shop", partySize: 1 });
  });
});
