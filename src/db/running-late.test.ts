import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS, MINUTE_MS } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBooking, createBookingParty } from "./bookings";
import { listCheckInQueue } from "./check-in";
import {
  clearBookingRunningLate,
  markBookingRunningLate,
  markMessageRunningLate,
  markPersonRunningLate,
  markPhoneRunningLate,
  messageSeats,
} from "./running-late";
import { activityEvents, bookings, people, shops, tripDeskEvents, trips } from "./schema";
import { initializeTodayCatchUp, readTodayCatchUp } from "./today-catch-up";
import { createTrip, listStaff, upcomingTripsWithCounts } from "./trips";

/**
 * **"Running late"** (J3): one guarded write behind three doors. What matters
 * is where it is refused — a seat that has arrived, a boat that has left, a
 * trip too far off — and that the first statement stands.
 */

const DIVER = { fullName: "Iris Okafor", email: "iris.late@example.com", phone: "+1-305-555-0177" };
const E164 = "+13055550177";

const ctx = fileScopedShopContext();

async function context() {
  const { db, shop } = ctx;
  const open = (await upcomingTripsWithCounts(db, shop.id)).find(
    (trip) => trip.title === "Two-Tank Reef — Christ of the Abyss",
  );
  if (!open) throw new Error("expected seeded trip missing");
  const booked = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: open.id,
    ...DIVER,
  });
  if (!booked.ok) throw new Error("setup booking failed");
  const [diver] = await db
    .select({ id: people.id, phone: people.phone })
    .from(people)
    .where(and(eq(people.shopId, shop.id), eq(people.email, DIVER.email)))
    .limit(1);
  if (!diver) throw new Error("setup diver missing");
  // Half an hour before the boat leaves: the ordinary moment to say it.
  const now = new Date(open.startsAt.getTime() - 30 * MINUTE_MS);
  const [staffer] = await listStaff(db, shop.id);
  if (!staffer) throw new Error("expected seeded staff");
  return {
    actorPersonId: staffer.person.id,
    actorName: staffer.person.fullName,
    db,
    shop,
    trip: open,
    bookingId: booked.bookingId,
    personId: diver.id,
    phone: diver.phone,
    now,
  };
}

/** The trail lines filed on the diver's record for a staff-marked late message. */
async function lateLines(personId: string) {
  return ctx.db
    .select({ actor: activityEvents.actorPersonId, params: activityEvents.params })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.subjectPersonId, personId),
        eq(activityEvents.code, "running_late_from_message"),
      ),
    );
}

async function lateAt(bookingId: string) {
  const [row] = await ctx.db
    .select({ at: bookings.runningLateAt })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row?.at ?? null;
}

describe("markBookingRunningLate", () => {
  it("stamps an open seat, and the first statement stands", async () => {
    const { db, shop, bookingId, now } = await context();
    expect(await markBookingRunningLate(db, { shopId: shop.id, bookingId, now })).toEqual({
      status: "marked",
      bookingId,
      at: now,
    });
    const later = new Date(now.getTime() + 5 * MINUTE_MS);
    expect(await markBookingRunningLate(db, { shopId: shop.id, bookingId, now: later })).toEqual({
      status: "already",
      bookingId,
      at: now,
    });
    expect(await lateAt(bookingId)).toEqual(now);
  });

  it("records exactly one desk event when the diver first says they are late", async () => {
    const { db, shop, trip, bookingId, personId, now } = await context();
    await markBookingRunningLate(db, { shopId: shop.id, bookingId, now });
    await markBookingRunningLate(db, { shopId: shop.id, bookingId, now });
    const events = await db
      .select()
      .from(tripDeskEvents)
      .where(eq(tripDeskEvents.bookingId, bookingId));
    expect(events.filter((event) => event.kind === "running_late")).toMatchObject([
      { shopId: shop.id, tripId: trip.id, subjectPersonId: personId, actorPersonId: null },
    ]);
  });

  it("refuses before the day-before window and once the boat has sailed", async () => {
    const { db, shop, trip, bookingId } = await context();
    for (const now of [
      new Date(trip.startsAt.getTime() - 25 * HOUR_MS),
      new Date(trip.startsAt.getTime() + 61 * MINUTE_MS),
    ]) {
      expect(await markBookingRunningLate(db, { shopId: shop.id, bookingId, now })).toEqual({
        status: "closed",
      });
    }
    expect(await lateAt(bookingId)).toBeNull();
  });

  it("takes it ten minutes past the scheduled time, while the boat is still at the dock", async () => {
    const { db, shop, trip, bookingId } = await context();
    const now = new Date(trip.startsAt.getTime() + 10 * MINUTE_MS);
    expect(await markBookingRunningLate(db, { shopId: shop.id, bookingId, now })).toMatchObject({
      status: "marked",
    });
  });

  it("refuses a seat that has already checked in, and a called-off departure", async () => {
    const { db, shop, trip, bookingId, now } = await context();
    await db.update(bookings).set({ status: "checked_in" }).where(eq(bookings.id, bookingId));
    expect(await markBookingRunningLate(db, { shopId: shop.id, bookingId, now })).toEqual({
      status: "closed",
    });
    await db.update(bookings).set({ status: "booked" }).where(eq(bookings.id, bookingId));
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));
    expect(await markBookingRunningLate(db, { shopId: shop.id, bookingId, now })).toEqual({
      status: "closed",
    });
  });

  it("never reaches another shop's booking", async () => {
    const { db, bookingId, now } = await context();
    const otherShop = "00000000-0000-4000-8000-000000000000";
    expect(await markBookingRunningLate(db, { shopId: otherShop, bookingId, now })).toEqual({
      status: "closed",
    });
    expect(await lateAt(bookingId)).toBeNull();
  });
});

describe("the arrivals list", () => {
  it("says it on a seat still to arrive, and drops it once they check in", async () => {
    const { db, shop, trip, bookingId, now } = await context();
    await markBookingRunningLate(db, { shopId: shop.id, bookingId, now });
    const [row] = await listCheckInQueue(db, shop.id, { now, tripId: trip.id, query: DIVER.email });
    expect(row?.runningLateAt).toEqual(now);

    await db.update(bookings).set({ status: "checked_in" }).where(eq(bookings.id, bookingId));
    const [arrived] = await listCheckInQueue(db, shop.id, {
      now,
      tripId: trip.id,
      query: DIVER.email,
    });
    expect(arrived?.runningLateAt).toBeNull();
  });
});

describe("markPersonRunningLate (a LATE reply)", () => {
  it("marks the diver's soonest open seat in this shop", async () => {
    const { db, shop, personId, bookingId, now } = await context();
    expect(await markPersonRunningLate(db, { shopId: shop.id, personId, now })).toMatchObject({
      status: "marked",
      bookingId,
    });
  });

  it("finds nothing when no seat is inside the window", async () => {
    const { db, shop, trip, personId } = await context();
    const tooEarly = new Date(trip.startsAt.getTime() - 2 * 24 * HOUR_MS);
    expect(await markPersonRunningLate(db, { shopId: shop.id, personId, now: tooEarly })).toEqual({
      status: "closed",
    });
  });
});

/**
 * UX review 2026-10-13, item 19: a running-late message in the diver's own
 * words. The Inbox row names the seat it could be about, and a staffer marks
 * it; the instant stored is when the diver wrote.
 */
describe("a message in the diver's own words (the Inbox)", () => {
  const MESSAGE_ID = "8f000000-1111-4222-8333-444444444444";

  it("names the seat open when they wrote, and marks it with the moment they wrote", async () => {
    const { db, shop, trip, bookingId, personId, now, actorPersonId, actorName } = await context();
    const receivedAt = new Date(now.getTime() - 10 * MINUTE_MS);
    const seats = await messageSeats(db, shop.id, [{ id: MESSAGE_ID, personId, receivedAt }], now);
    expect(seats.get(MESSAGE_ID)).toMatchObject([
      { bookingId, tripId: trip.id, title: trip.title, runningLateAt: null },
    ]);

    expect(
      await markMessageRunningLate(db, {
        shopId: shop.id,
        personId,
        bookingId,
        receivedAt,
        now,
        actorPersonId,
      }),
    ).toEqual({ status: "marked", bookingId, at: receivedAt });
    expect(await lateAt(bookingId)).toEqual(receivedAt);
    // Security review 1 / domain review 3: the staffer who read it is on the
    // diver's trail, so "said {time}" on the roster never passes as the diver's tap.
    expect(await lateLines(personId)).toEqual([
      { actor: actorPersonId, params: { actor: actorName, diver: DIVER.fullName } },
    ]);
    // A second mark changes nothing, so it files nothing.
    expect(
      await markMessageRunningLate(db, {
        shopId: shop.id,
        personId,
        bookingId,
        receivedAt,
        now,
        actorPersonId,
      }),
    ).toMatchObject({ status: "already" });
    expect(await lateLines(personId)).toHaveLength(1);
    const after = await messageSeats(db, shop.id, [{ id: MESSAGE_ID, personId, receivedAt }], now);
    expect(after.get(MESSAGE_ID)?.[0]?.runningLateAt).toEqual(receivedAt);
  });

  it("names nothing for words written before this boat's window opened", async () => {
    const { db, shop, trip, bookingId, personId, now, actorPersonId } = await context();
    // Two days out: about some other boat, or none, never this one.
    const receivedAt = new Date(trip.startsAt.getTime() - 48 * HOUR_MS);
    const seats = await messageSeats(db, shop.id, [{ id: MESSAGE_ID, personId, receivedAt }], now);
    expect(seats.size).toBe(0);
    expect(
      await markMessageRunningLate(db, {
        shopId: shop.id,
        personId,
        bookingId,
        receivedAt,
        now,
        actorPersonId,
      }),
    ).toEqual({ status: "closed" });
    expect(await lateAt(bookingId)).toBeNull();
    expect(await lateLines(personId)).toEqual([]);
  });

  it("names nothing for a stranger, and closes once the diver has checked in", async () => {
    const { db, shop, bookingId, personId, now, actorPersonId } = await context();
    const receivedAt = new Date(now.getTime() - 5 * MINUTE_MS);
    const stranger = await messageSeats(
      db,
      shop.id,
      [{ id: MESSAGE_ID, personId: null, receivedAt }],
      now,
    );
    expect(stranger.size).toBe(0);
    await db.update(bookings).set({ status: "checked_in" }).where(eq(bookings.id, bookingId));
    expect(
      await markMessageRunningLate(db, {
        shopId: shop.id,
        personId,
        bookingId,
        receivedAt,
        now,
        actorPersonId,
      }),
    ).toEqual({ status: "closed" });
  });

  it("never reaches another shop's seat", async () => {
    const { db, bookingId, personId, now, actorPersonId } = await context();
    const otherShop = "00000000-0000-4000-8000-000000000000";
    expect(
      await markMessageRunningLate(db, {
        shopId: otherShop,
        personId,
        bookingId,
        receivedAt: now,
        now,
        actorPersonId,
      }),
    ).toEqual({ status: "closed" });
    expect(await lateAt(bookingId)).toBeNull();
  });
});

/**
 * A sender with two seats both inside the window when they wrote (issue #2551,
 * decided 2026-10-16): the row lists both, the desk chooses, and the server
 * re-derives the candidates from the stored message and refuses any other
 * booking id. A `LATE` keyword reply stays the soonest seat, by design.
 */
describe("a message from a sender holding two seats in the window", () => {
  const MESSAGE_ID = "8f000000-1111-4222-8333-444444444444";

  async function twoSeats() {
    const base = await context();
    const { db, shop, trip } = base;
    const other = (await upcomingTripsWithCounts(db, shop.id)).find(
      (candidate) => candidate.id !== trip.id && candidate.title !== trip.title,
    );
    if (!other) throw new Error("expected a second seeded trip");
    const second = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: other.id,
      ...DIVER,
    });
    if (!second.ok) throw new Error("second booking failed");
    // The second boat sails eight hours after the first, inside the same day.
    const startsAt = new Date(trip.startsAt.getTime() + 8 * HOUR_MS);
    await db
      .update(trips)
      .set({ startsAt, endsAt: new Date(startsAt.getTime() + 3 * HOUR_MS) })
      .where(eq(trips.id, other.id));
    return { ...base, secondBookingId: second.bookingId, secondTripId: other.id };
  }

  it("names both seats, soonest first", async () => {
    const { db, shop, personId, bookingId, secondBookingId, now } = await twoSeats();
    const receivedAt = new Date(now.getTime() - 10 * MINUTE_MS);
    const seats = await messageSeats(db, shop.id, [{ id: MESSAGE_ID, personId, receivedAt }], now);
    expect(seats.get(MESSAGE_ID)?.map((seat) => seat.bookingId)).toEqual([
      bookingId,
      secondBookingId,
    ]);
  });

  it("marks the seat the desk chose, and only that one", async () => {
    const { db, shop, personId, bookingId, secondBookingId, now, actorPersonId } = await twoSeats();
    const receivedAt = new Date(now.getTime() - 10 * MINUTE_MS);
    expect(
      await markMessageRunningLate(db, {
        shopId: shop.id,
        personId,
        bookingId: secondBookingId,
        receivedAt,
        now,
        actorPersonId,
      }),
    ).toEqual({ status: "marked", bookingId: secondBookingId, at: receivedAt });
    expect(await lateAt(secondBookingId)).toEqual(receivedAt);
    expect(await lateAt(bookingId)).toBeNull();
  });

  it("refuses a booking id that is not among the message's own seats", async () => {
    const { db, shop, trip, personId, bookingId, now, actorPersonId } = await twoSeats();
    const receivedAt = new Date(now.getTime() - 10 * MINUTE_MS);
    // Another diver's seat at this shop, and an id that names nothing at all.
    const stranger = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Someone Else",
      email: "someone.else@example.com",
    });
    if (!stranger.ok) throw new Error("setup booking failed");
    for (const forged of [stranger.bookingId, "00000000-0000-4000-8000-000000000000"]) {
      expect(
        await markMessageRunningLate(db, {
          shopId: shop.id,
          personId,
          bookingId: forged,
          receivedAt,
          now,
          actorPersonId,
        }),
      ).toEqual({ status: "closed" });
      expect(await lateAt(forged)).toBeNull();
    }
    expect(await lateAt(bookingId)).toBeNull();
    expect(await lateLines(personId)).toEqual([]);
  });

  it("refuses a seat that was not yet in the window when they wrote", async () => {
    const { db, shop, trip, personId, secondBookingId, secondTripId, now, actorPersonId } =
      await twoSeats();
    // Put the second boat past a day from the message: it was not the one the
    // words could have been about, even though it is open now.
    const receivedAt = new Date(trip.startsAt.getTime() - 20 * HOUR_MS);
    const later = new Date(receivedAt.getTime() + 30 * HOUR_MS);
    await db
      .update(trips)
      .set({ startsAt: later, endsAt: new Date(later.getTime() + 3 * HOUR_MS) })
      .where(eq(trips.id, secondTripId));
    expect(
      await markMessageRunningLate(db, {
        shopId: shop.id,
        personId,
        bookingId: secondBookingId,
        receivedAt,
        now,
        actorPersonId,
      }),
    ).toEqual({ status: "closed" });
    expect(await lateAt(secondBookingId)).toBeNull();
  });

  it("leaves a LATE keyword reply on the soonest seat", async () => {
    const { db, shop, personId, bookingId, secondBookingId, now } = await twoSeats();
    expect(await markPersonRunningLate(db, { shopId: shop.id, personId, now })).toMatchObject({
      status: "marked",
      bookingId,
    });
    expect(await lateAt(secondBookingId)).toBeNull();
  });
});

describe("markPhoneRunningLate (a LATE text)", () => {
  it("matches the stored E.164 number exactly", async () => {
    const { db, bookingId, phone, now } = await context();
    expect(phone).toBe(E164);
    expect(await markPhoneRunningLate(db, { phone: E164, now })).toMatchObject({
      status: "marked",
      bookingId,
    });
  });

  it("finds nothing for a number nobody holds", async () => {
    const { db, now } = await context();
    expect(await markPhoneRunningLate(db, { phone: "+13055550000", now })).toEqual({
      status: "closed",
    });
  });

  it("ignores a deleted diver record's number", async () => {
    const { db, personId, now } = await context();
    await db.update(people).set({ deletedAt: now }).where(eq(people.id, personId));
    expect(await markPhoneRunningLate(db, { phone: E164, now })).toEqual({ status: "closed" });
  });
});

describe("one statement for the people travelling together", () => {
  it("covers a party organizer's other seats from their link", async () => {
    const { db, shop, trip, now } = await context();
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Ada Lead",
        email: "ada.lead@example.com",
      },
      {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Ben Lead",
        email: "ben.lead@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`party failed: ${party.reason}`);
    const [lead, member] = party.bookings;
    if (!lead || !member) throw new Error("party seats missing");
    await markBookingRunningLate(db, { shopId: shop.id, bookingId: lead.bookingId, now });
    expect(await lateAt(member.bookingId)).toEqual(now);
    const events = await db
      .select()
      .from(tripDeskEvents)
      .where(eq(tripDeskEvents.kind, "running_late"));
    expect(
      events.filter((event) => [lead.bookingId, member.bookingId].includes(event.bookingId ?? "")),
    ).toMatchObject([{ actorPersonId: null }, { actorPersonId: null }]);
    // A member's own tap speaks for that member alone.
    await db.update(bookings).set({ runningLateAt: null }).where(eq(bookings.id, lead.bookingId));
    await db.update(bookings).set({ runningLateAt: null }).where(eq(bookings.id, member.bookingId));
    await markBookingRunningLate(db, { shopId: shop.id, bookingId: member.bookingId, now });
    expect(await lateAt(lead.bookingId)).toBeNull();
  });

  it("covers the organizer's party from a LATE reply too, as the link does", async () => {
    const { db, shop, trip, now } = await context();
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Cleo Organizer",
        email: "cleo.organizer@example.com",
      },
      {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Dev Member",
        email: "dev.member@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`party failed: ${party.reason}`);
    const [lead, member] = party.bookings;
    if (!lead || !member) throw new Error("party seats missing");
    expect(
      await markPersonRunningLate(db, { shopId: shop.id, personId: lead.personId, now }),
    ).toMatchObject({ status: "marked", bookingId: lead.bookingId });
    expect(await lateAt(member.bookingId)).toEqual(now);
  });

  it("files the staffer's line for every party member a message mark stamped, in one stroke", async () => {
    const { db, shop, trip, now, actorPersonId } = await context();
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Eve Organizer",
        email: "eve.organizer@example.com",
      },
      {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Finn Member",
        email: "finn.member@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`party failed: ${party.reason}`);
    const [lead, member] = party.bookings;
    if (!lead || !member) throw new Error("party seats missing");
    const receivedAt = new Date(now.getTime() - 5 * MINUTE_MS);
    const observer = (await listStaff(db, shop.id)).find(
      (staff) => staff.person.id !== actorPersonId,
    )?.person.id;
    if (!observer) throw new Error("expected another staff reader");
    for (const personId of [actorPersonId, observer]) {
      const input = { shopId: shop.id, personId, now, timeZone: shop.timezone };
      const snapshot = await readTodayCatchUp(db, input);
      await initializeTodayCatchUp(db, { ...input, eventIds: snapshot.snapshotIds });
    }
    expect(
      await markMessageRunningLate(db, {
        shopId: shop.id,
        personId: lead.personId,
        bookingId: lead.bookingId,
        receivedAt,
        now,
        actorPersonId,
      }),
    ).toMatchObject({ status: "marked", bookingId: lead.bookingId });
    expect(await lateAt(member.bookingId)).toEqual(receivedAt);
    const events = await db
      .select()
      .from(tripDeskEvents)
      .where(eq(tripDeskEvents.kind, "running_late"));
    expect(
      events.filter((event) => [lead.bookingId, member.bookingId].includes(event.bookingId ?? "")),
    ).toMatchObject([{ actorPersonId }, { actorPersonId }]);
    const actorView = await readTodayCatchUp(db, {
      shopId: shop.id,
      personId: actorPersonId,
      now,
      timeZone: shop.timezone,
    });
    const observerView = await readTodayCatchUp(db, {
      shopId: shop.id,
      personId: observer,
      now,
      timeZone: shop.timezone,
    });
    expect(actorView.events.filter((event) => event.kind === "running_late")).toEqual([]);
    expect(
      observerView.events
        .filter((event) => event.kind === "running_late")
        .map((event) => event.subjectName),
    ).toEqual(["Eve Organizer", "Finn Member"]);
    // The member's "said {time}" is the staffer's doing too, so it is on their trail.
    expect(await lateLines(lead.personId)).toHaveLength(1);
    expect(await lateLines(member.personId)).toEqual([
      expect.objectContaining({ actor: actorPersonId }),
    ]);
  });

  it("covers every seat on that boat held under the texting number, and nothing else", async () => {
    const { db, shop, trip, bookingId, now } = await context();
    const sibling = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Kit Okafor",
      email: "kit.late@example.com",
      phone: DIVER.phone,
    });
    const stranger = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Una Other",
      email: "una.other@example.com",
      phone: "+1-305-555-0144",
    });
    if (!sibling.ok || !stranger.ok) throw new Error("setup bookings failed");
    await markPhoneRunningLate(db, { phone: E164, now });
    expect(await lateAt(bookingId)).toEqual(now);
    expect(await lateAt(sibling.bookingId)).toEqual(now);
    expect(await lateAt(stranger.bookingId)).toBeNull();
  });
});

/**
 * **One number, seats at two shops** (issue #2320). A LATE text lands on the
 * sender number it was sent to; when that number belongs to one shop, the seat
 * marked is that shop's, even when another shop's boat leaves sooner. On the
 * shared DiveDay sender (`shopForSmsSender` answers null) the soonest seat
 * across shops stands, as before.
 */
describe("markPhoneRunningLate across two shops (#2320)", () => {
  async function twoShops() {
    const base = await context();
    const { db, trip } = base;
    const [other] = await db
      .insert(shops)
      .values({ name: "Second Reef Shop", slug: "second-reef-shop", timezone: "UTC" })
      .returning();
    if (!other) throw new Error("second shop setup failed");
    // Leaves an hour after the first shop's boat: the later seat of the two.
    const later = await createTrip(db, {
      shopId: other.id,
      title: "Second shop dawn dive",
      startsAt: new Date(trip.startsAt.getTime() + HOUR_MS),
      endsAt: new Date(trip.startsAt.getTime() + 4 * HOUR_MS),
      capacity: 6,
    });
    if (!later) throw new Error("second shop trip failed");
    const booked = await createBooking(db, {
      actor: "staff",
      shopId: other.id,
      tripId: later.id,
      fullName: "Iris Okafor",
      email: "iris.second@example.com",
      phone: DIVER.phone,
    });
    if (!booked.ok) throw new Error("second shop booking failed");
    return { ...base, other, otherBookingId: booked.bookingId };
  }

  it("keeps the soonest seat across shops when no shop is named", async () => {
    const { db, bookingId, otherBookingId, now } = await twoShops();
    await markPhoneRunningLate(db, { phone: E164, now });
    expect(await lateAt(bookingId)).toEqual(now);
    expect(await lateAt(otherBookingId)).toBeNull();
  });

  it("marks the named shop's seat even when another shop's boat leaves sooner", async () => {
    const { db, bookingId, other, otherBookingId, now } = await twoShops();
    expect(await markPhoneRunningLate(db, { phone: E164, now, shopId: other.id })).toMatchObject({
      status: "marked",
      bookingId: otherBookingId,
    });
    expect(await lateAt(otherBookingId)).toEqual(now);
    expect(await lateAt(bookingId)).toBeNull();
  });

  it("marks the first shop's seat when that is the shop named", async () => {
    const { db, shop, bookingId, otherBookingId, now } = await twoShops();
    await markPhoneRunningLate(db, { phone: E164, now, shopId: shop.id });
    expect(await lateAt(bookingId)).toEqual(now);
    expect(await lateAt(otherBookingId)).toBeNull();
  });

  it("closes, and touches no other shop, when the named shop holds no seat for the number", async () => {
    const { db, bookingId, otherBookingId, now } = await twoShops();
    const empty = "00000000-0000-4000-8000-000000000000";
    expect(await markPhoneRunningLate(db, { phone: E164, now, shopId: empty })).toEqual({
      status: "closed",
    });
    expect(await lateAt(bookingId)).toBeNull();
    expect(await lateAt(otherBookingId)).toBeNull();
  });
});

/**
 * **Taken back from the link that said it** (third UX review, item 26): a tap
 * the night before used to stand until the diver checked in.
 */
describe("clearBookingRunningLate", () => {
  it("clears a seat's statement while the seat could still make it", async () => {
    const { db, shop, bookingId, now } = await context();
    await markBookingRunningLate(db, { shopId: shop.id, bookingId, now });
    expect(await clearBookingRunningLate(db, { shopId: shop.id, bookingId, now })).toEqual({
      status: "cleared",
    });
    expect(await lateAt(bookingId)).toBeNull();
    // And it can be said again.
    expect(await markBookingRunningLate(db, { shopId: shop.id, bookingId, now })).toMatchObject({
      status: "marked",
    });
  });

  it("leaves the record alone once the boat has sailed or the diver checked in", async () => {
    const { db, shop, trip, bookingId, now } = await context();
    await markBookingRunningLate(db, { shopId: shop.id, bookingId, now });
    const sailed = new Date(trip.startsAt.getTime() + 61 * MINUTE_MS);
    expect(await clearBookingRunningLate(db, { shopId: shop.id, bookingId, now: sailed })).toEqual({
      status: "closed",
    });
    await db.update(bookings).set({ status: "checked_in" }).where(eq(bookings.id, bookingId));
    expect(await clearBookingRunningLate(db, { shopId: shop.id, bookingId, now })).toEqual({
      status: "closed",
    });
    expect(await lateAt(bookingId)).toEqual(now);
  });

  it("never reaches another shop's booking", async () => {
    const { db, shop, bookingId, now } = await context();
    await markBookingRunningLate(db, { shopId: shop.id, bookingId, now });
    const otherShop = "00000000-0000-4000-8000-000000000000";
    expect(await clearBookingRunningLate(db, { shopId: otherShop, bookingId, now })).toEqual({
      status: "closed",
    });
    expect(await lateAt(bookingId)).toEqual(now);
  });

  it("clears the party seats the organizer's tap stamped, not a member's own word", async () => {
    const { db, shop, trip, now } = await context();
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Cy Lead",
        email: "cy.lead@example.com",
      },
      {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Di Lead",
        email: "di.lead@example.com",
      },
      {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Ed Lead",
        email: "ed.lead@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`party failed: ${party.reason}`);
    const [lead, member, ownWord] = party.bookings;
    if (!lead || !member || !ownWord) throw new Error("party seats missing");
    const earlier = new Date(now.getTime() - 5 * MINUTE_MS);
    await markBookingRunningLate(db, {
      shopId: shop.id,
      bookingId: ownWord.bookingId,
      now: earlier,
    });
    await markBookingRunningLate(db, { shopId: shop.id, bookingId: lead.bookingId, now });
    expect(await lateAt(member.bookingId)).toEqual(now);

    await clearBookingRunningLate(db, { shopId: shop.id, bookingId: lead.bookingId, now });
    expect(await lateAt(lead.bookingId)).toBeNull();
    expect(await lateAt(member.bookingId)).toBeNull();
    expect(await lateAt(ownWord.bookingId)).toEqual(earlier);
  });
});

/**
 * H-126: an "Ask to move" names its booking, so the row reads that seat
 * whenever it departs, not the one the running-late window would infer.
 */
describe("a message that names its booking", () => {
  it("is about that seat even a week out, and a stranger's booking id reads nothing", async () => {
    const { db, shop, trip, bookingId, personId, now } = await context();
    const weekBefore = new Date(now.getTime() - 7 * 24 * HOUR_MS);
    const seats = await messageSeats(
      db,
      shop.id,
      [
        { id: "a", personId, receivedAt: weekBefore, bookingId },
        { id: "b", personId, receivedAt: weekBefore, bookingId: null },
      ],
      now,
    );
    expect(seats.get("a")).toMatchObject([{ bookingId, tripId: trip.id, title: trip.title }]);
    // Inferred from the window, a message from a week ago names nothing.
    expect(seats.has("b")).toBe(false);

    const otherShop = await messageSeats(
      db,
      "00000000-0000-4000-8000-000000000000",
      [{ id: "a", personId, receivedAt: now, bookingId }],
      now,
    );
    expect(otherShop.size).toBe(0);
  });
});
