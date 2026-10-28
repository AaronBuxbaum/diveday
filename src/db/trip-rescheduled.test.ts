import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail, fakeSms } from "@/test/fakes";
import { confirmBookingIdentity, createBookingParty, splitBookingIdentity } from "./bookings";
import { claimDueHeldSends } from "./held-sends";
import {
  bookingCapabilities,
  bookings,
  heldSends,
  notificationDeliveries,
  people,
  tripScheduleDays,
  trips,
} from "./schema";
import { recordSmsKeyword } from "./sms-opt-outs";
import {
  holdRescheduleNotice,
  sendMissedRescheduleNotice,
  sendRescheduleNotices,
} from "./trip-rescheduled";
import { createTrip, listStaff, moveTrip, upcomingTripsWithCounts } from "./trips";

/**
 * **The reschedule notice** (ux review 2026-10-11, item 1). The security
 * property first: one message per seat, to the address on *that seat's own*
 * person record, and to nobody else — not the party lead who booked it, not a
 * held seat's matched record, not a cancelled seat, not another shop's divers.
 */

const ORIGIN = "https://diveday.example";
const ctx = fileScopedShopContext();

async function movedTrip() {
  const { db, shop } = ctx;
  const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = upcoming.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  // Everybody the seed already put on this departure is somebody else's
  // test: cancel them so the audience is exactly the seats made below.
  await db
    .update(bookings)
    .set({ status: "cancelled" })
    .where(and(eq(bookings.tripId, reef.id), eq(bookings.shopId, shop.id)));
  const party = await createBookingParty(db, [
    {
      actor: "public",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Priya Shah",
      email: "reschedule-priya@example.com",
    },
    {
      actor: "public",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Sam Shah",
      email: "reschedule-sam@example.com",
    },
    { actor: "public", shopId: shop.id, tripId: reef.id, fullName: "Kid Shah" },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const [priya, sam, kid] = party.bookings.map((b) => b.bookingId);
  const previousStartsAt = reef.startsAt;
  const moved = await moveTrip(
    db,
    shop.id,
    reef.id,
    new Date(reef.startsAt.getTime() + 24 * 60 * 60 * 1000),
  );
  if (!moved.ok) throw new Error("move failed");
  const now = new Date(previousStartsAt.getTime() - 5 * 24 * 60 * 60 * 1000);
  return { db, shop, reef, priya, sam, kid, previousStartsAt, moved: moved.trip, now };
}

function providers() {
  const email = fakeEmail();
  const sms = fakeSms();
  return {
    email,
    sms,
    options: {
      emailProvider: email.provider,
      smsProvider: sms.provider,
      whatsAppProviders: new Map(),
      appOrigin: ORIGIN,
    },
  };
}

async function deliveriesFor(db: typeof ctx.db, bookingIds: string[]) {
  return db
    .select()
    .from(notificationDeliveries)
    .where(
      and(
        inArray(notificationDeliveries.bookingId, bookingIds),
        eq(notificationDeliveries.kind, "trip_rescheduled"),
      ),
    );
}

const HOUR = 3_600_000;

/**
 * A three-day course with two booked seats, booked while it was ahead and
 * then put `dayOneAgo` hours after day one sailed. Each day is four hours,
 * a day apart. The meeting point is set, as a save that moved it leaves it.
 */
async function courseUnderway(dayOneAgo: number) {
  const { db, shop } = ctx;
  const now = nowDate();
  const days = (dayOne: Date) =>
    [0, 1, 2].map((day) => ({
      dayNumber: day + 1,
      startsAt: new Date(dayOne.getTime() + day * 24 * HOUR),
      endsAt: new Date(dayOne.getTime() + day * 24 * HOUR + 4 * HOUR),
    }));
  const ahead = new Date(now.getTime() + 6 * HOUR);
  const course = await createTrip(db, {
    shopId: shop.id,
    title: "Three-day course",
    startsAt: ahead,
    endsAt: new Date(ahead.getTime() + 52 * HOUR),
    capacity: 8,
    scheduleDays: days(ahead),
  });
  if (!course) throw new Error("course not created");
  const party = await createBookingParty(db, [
    {
      actor: "public",
      shopId: shop.id,
      tripId: course.id,
      fullName: "Ana Course",
      email: `course-ana-${randomUUID()}@example.com`,
    },
    {
      actor: "public",
      shopId: shop.id,
      tripId: course.id,
      fullName: "Ben Course",
      email: `course-ben-${randomUUID()}@example.com`,
    },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const dayOne = new Date(now.getTime() - dayOneAgo * HOUR);
  await db
    .update(trips)
    .set({
      startsAt: dayOne,
      endsAt: new Date(dayOne.getTime() + 52 * HOUR),
      meetingPointLabel: "North Pier",
      meetingPointAddress: "1 Dock St",
    })
    .where(eq(trips.id, course.id));
  for (const day of days(dayOne)) {
    await db
      .update(tripScheduleDays)
      .set({ startsAt: day.startsAt, endsAt: day.endsAt })
      .where(
        and(eq(tripScheduleDays.tripId, course.id), eq(tripScheduleDays.dayNumber, day.dayNumber)),
      );
  }
  return { db, shop, course, dayOne, now };
}

describe("sendRescheduleNotices", () => {
  it("tells each seat at its own address, and never the party lead about someone else's seat", async () => {
    const { db, shop, reef, priya, sam, kid, previousStartsAt, moved, now } = await movedTrip();
    const { email, options } = providers();
    const outcome = await sendRescheduleNotices(
      db,
      shop.id,
      {
        kind: "trip_rescheduled",
        tripId: reef.id,
        previousStartsAt: previousStartsAt.toISOString(),
        meetingPointMoved: false,
      },
      { ...options, now },
    );
    expect(outcome).toEqual({ told: 2, failed: 1, identityHeld: 0 });

    // Every message's address is the address on its own booking's person.
    const addressed = await db
      .select({ bookingId: bookings.id, email: people.email })
      .from(bookings)
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(inArray(bookings.id, [priya, sam, kid]));
    const own = new Map(addressed.map((row) => [row.bookingId, row.email]));
    expect(email.sent).toHaveLength(2);
    for (const sent of email.sent) {
      if (sent.kind !== "trip_rescheduled") throw new Error(`unexpected ${sent.kind}`);
      expect(sent.to).toBe(own.get(sent.bookingId));
      expect(sent.previousStartsAt).toEqual(previousStartsAt);
      expect(sent.startsAt).toEqual(moved.startsAt);
      expect(sent.revision).toBe(moved.revision);
      expect(sent.readinessUrl).toMatch(/^https:\/\/diveday\.example\/ready\//);
      // The meeting point did not move, so the message does not restate it.
      expect(sent.meetingPoint).toBeUndefined();
    }
    // The kid has no address of their own: the gap is recorded against the
    // kid's seat, and nothing about it went to the lead who booked it.
    expect(email.sent.map((n) => ("bookingId" in n ? n.bookingId : null)).sort()).toEqual(
      [priya, sam].sort(),
    );
    const rows = await deliveriesFor(db, [priya, sam, kid]);
    expect(Object.fromEntries(rows.map((row) => [row.bookingId, row.status]))).toEqual({
      [priya]: "sent",
      [sam]: "sent",
      [kid]: "not_configured",
    });
  });

  it("skips a held seat, a cancelled seat and a no-show", async () => {
    const { db, shop, reef, priya, sam, kid, previousStartsAt, now } = await movedTrip();
    await db.update(bookings).set({ identityUnconfirmedAt: now }).where(eq(bookings.id, priya));
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, sam));
    await db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, kid));
    const { email, sms, options } = providers();
    const outcome = await sendRescheduleNotices(
      db,
      shop.id,
      {
        kind: "trip_rescheduled",
        tripId: reef.id,
        previousStartsAt: previousStartsAt.toISOString(),
        meetingPointMoved: false,
      },
      { ...options, now },
    );
    expect(outcome).toEqual({ told: 0, failed: 0, identityHeld: 1 });
    expect(email.sent).toHaveLength(0);
    expect(sms.sent).toHaveLength(0);
    expect(await deliveriesFor(db, [priya, sam, kid])).toHaveLength(0);
  });

  it("sends nothing for a trip id that is not this shop's", async () => {
    const { db, reef, previousStartsAt, now } = await movedTrip();
    const { email, sms, options } = providers();
    const outcome = await sendRescheduleNotices(
      db,
      randomUUID(),
      {
        kind: "trip_rescheduled",
        tripId: reef.id,
        previousStartsAt: previousStartsAt.toISOString(),
        meetingPointMoved: false,
      },
      { ...options, now },
    );
    expect(outcome.told + outcome.failed).toBe(0);
    expect(email.sent).toHaveLength(0);
    expect(sms.sent).toHaveLength(0);
  });

  it("tells nobody about a rehearsal departure, by email or by text", async () => {
    const { db, shop, reef, previousStartsAt, now } = await movedTrip();
    await db.update(trips).set({ isRehearsal: true, isPrivate: true }).where(eq(trips.id, reef.id));
    const { email, sms, options } = providers();
    const outcome = await sendRescheduleNotices(
      db,
      shop.id,
      {
        kind: "trip_rescheduled",
        tripId: reef.id,
        previousStartsAt: previousStartsAt.toISOString(),
        meetingPointMoved: false,
      },
      { ...options, now },
    );
    expect(outcome.told + outcome.failed).toBe(0);
    expect(email.sent).toHaveLength(0);
    expect(sms.sent).toHaveLength(0);
  });

  it("says nothing when the departure is back at the time the divers were told", async () => {
    const { db, shop, reef, moved, now } = await movedTrip();
    const { email, options } = providers();
    const outcome = await sendRescheduleNotices(
      db,
      shop.id,
      {
        kind: "trip_rescheduled",
        tripId: reef.id,
        previousStartsAt: moved.startsAt.toISOString(),
        meetingPointMoved: false,
      },
      { ...options, now },
    );
    expect(outcome.told).toBe(0);
    expect(email.sent).toHaveLength(0);
  });
  // #2443: the meeting point moved and the time did not. Booked divers
  // would otherwise turn up at the old dock.
  it("tells each seat where to meet when only the meeting point moved", async () => {
    const { db, shop, reef, kid, moved, now } = await movedTrip();
    const [kidRow] = await db.select().from(bookings).where(eq(bookings.id, kid));
    await db.update(people).set({ phone: "+13055550143" }).where(eq(people.id, kidRow.personId));
    await db
      .update(trips)
      .set({ meetingPointLabel: "North Pier", meetingPointAddress: "1 Dock St" })
      .where(eq(trips.id, reef.id));
    const { email, sms, options } = providers();
    const outcome = await sendRescheduleNotices(
      db,
      shop.id,
      {
        kind: "trip_rescheduled",
        tripId: reef.id,
        previousStartsAt: moved.startsAt.toISOString(),
        meetingPointMoved: true,
      },
      { ...options, now },
    );
    expect(outcome.told).toBe(3);
    expect(email.sent).toHaveLength(2);
    const [first] = email.sent;
    if (first?.kind !== "trip_rescheduled") throw new Error("wrong kind");
    expect(first.meetingPoint).toMatchObject({ label: "North Pier" });
    const text = sms.sent.find((m) => m.to === "+13055550143");
    expect(text?.body).toContain(`${shop.name}: we moved where we meet for ${reef.title}`);
    expect(text?.body).toContain("Meet at North Pier, 1 Dock St.");
  });

  it("tells a course's seats where to meet after day one sails, until its last day does", async () => {
    const { db, shop, course, dayOne, now } = await courseUnderway(30);
    const payload = {
      kind: "trip_rescheduled" as const,
      tripId: course.id,
      previousStartsAt: dayOne.toISOString(),
      meetingPointMoved: true,
    };
    const { email, options } = providers();
    const outcome = await sendRescheduleNotices(db, shop.id, payload, { ...options, now });
    expect(outcome.told).toBe(2);
    expect(email.sent).toHaveLength(2);

    const late = providers();
    const afterLastDay = new Date(dayOne.getTime() + 53 * HOUR);
    const none = await sendRescheduleNotices(db, shop.id, payload, {
      ...late.options,
      now: afterLastDay,
    });
    expect(none.told).toBe(0);
    expect(late.email.sent).toHaveLength(0);
  });

  it("mints no trip-prep link for a seat with no email and no phone", async () => {
    const { db, shop, reef, kid, previousStartsAt, now } = await movedTrip();
    const { options } = providers();
    await sendRescheduleNotices(
      db,
      shop.id,
      {
        kind: "trip_rescheduled",
        tripId: reef.id,
        previousStartsAt: previousStartsAt.toISOString(),
        meetingPointMoved: false,
      },
      { ...options, now },
    );
    expect(
      await db.select().from(bookingCapabilities).where(eq(bookingCapabilities.bookingId, kid)),
    ).toEqual([]);
    expect((await deliveriesFor(db, [kid])).map((row) => row.status)).toEqual(["not_configured"]);
  });
});

describe("holdRescheduleNotice", () => {
  it("holds one notice for the seats on board, and two moves inside the hold are one", async () => {
    const { db, shop, reef, previousStartsAt, moved, now } = await movedTrip();
    const first = await holdRescheduleNotice(db, {
      shopId: shop.id,
      tripId: reef.id,
      movedFrom: previousStartsAt,
      meetingPointMoved: false,
      actorPersonId: null,
      now,
    });
    expect(first?.told).toBe(3);

    const again = await moveTrip(
      db,
      shop.id,
      reef.id,
      new Date(moved.startsAt.getTime() + 60 * 60 * 1000),
    );
    if (!again.ok) throw new Error("second move failed");
    const second = await holdRescheduleNotice(db, {
      shopId: shop.id,
      tripId: reef.id,
      movedFrom: again.previousStartsAt,
      meetingPointMoved: false,
      actorPersonId: null,
      now,
    });
    const held = await db.select().from(heldSends).where(eq(heldSends.shopId, shop.id));
    expect(held.map((row) => row.id)).toEqual([second?.id]);
    // The divers were told the original time, so that is what the one notice says.
    expect(held[0].payload).toMatchObject({ previousStartsAt: previousStartsAt.toISOString() });

    // Drained by the sweep, it sends once per seat with an address.
    const { email, options } = providers();
    const due = await claimDueHeldSends(db, new Date(now.getTime() + 60_000));
    const mine = due.filter((row) => row.id === second?.id);
    expect(mine).toHaveLength(1);
    const payload = mine[0].payload;
    if (payload.kind !== "trip_rescheduled") throw new Error("wrong kind");
    await sendRescheduleNotices(db, shop.id, payload, { ...options, now });
    expect(email.sent).toHaveLength(2);
  });

  it("holds nothing when the move put the departure back where the divers were told", async () => {
    const { db, shop, reef, previousStartsAt, now } = await movedTrip();
    await holdRescheduleNotice(db, {
      shopId: shop.id,
      tripId: reef.id,
      movedFrom: previousStartsAt,
      meetingPointMoved: false,
      actorPersonId: null,
      now,
    });
    const back = await moveTrip(db, shop.id, reef.id, previousStartsAt);
    if (!back.ok) throw new Error("move back failed");
    const held = await holdRescheduleNotice(db, {
      shopId: shop.id,
      tripId: reef.id,
      movedFrom: back.previousStartsAt,
      meetingPointMoved: false,
      actorPersonId: null,
      now,
    });
    expect(held).toBeNull();
    expect(await db.select().from(heldSends).where(eq(heldSends.shopId, shop.id))).toHaveLength(0);
  });

  it("holds one notice for a save that moved only the meeting point (#2443)", async () => {
    const { db, shop, reef, moved, now } = await movedTrip();
    const held = await holdRescheduleNotice(db, {
      shopId: shop.id,
      tripId: reef.id,
      movedFrom: moved.startsAt,
      meetingPointMoved: true,
      actorPersonId: null,
      now,
    });
    expect(held?.told).toBe(3);
    const rows = await db.select().from(heldSends).where(eq(heldSends.shopId, shop.id));
    expect(rows.map((row) => row.payload)).toEqual([
      {
        kind: "trip_rescheduled",
        tripId: reef.id,
        previousStartsAt: moved.startsAt.toISOString(),
        meetingPointMoved: true,
      },
    ]);
  });

  it("holds a course's meeting-point notice after day one sails, and nothing once its last day has", async () => {
    const { db, shop, course, dayOne, now } = await courseUnderway(30);
    const held = await holdRescheduleNotice(db, {
      shopId: shop.id,
      tripId: course.id,
      movedFrom: dayOne,
      meetingPointMoved: true,
      actorPersonId: null,
      now,
    });
    expect(held?.told).toBe(2);

    await db.delete(heldSends).where(eq(heldSends.shopId, shop.id));
    const sailed = await holdRescheduleNotice(db, {
      shopId: shop.id,
      tripId: course.id,
      movedFrom: dayOne,
      meetingPointMoved: true,
      actorPersonId: null,
      now: new Date(dayOne.getTime() + 53 * HOUR),
    });
    expect(sailed).toBeNull();
    expect(await db.select().from(heldSends).where(eq(heldSends.shopId, shop.id))).toEqual([]);
  });

  it("holds nothing for a rehearsal departure", async () => {
    const { db, shop, reef, previousStartsAt, now } = await movedTrip();
    await db.update(trips).set({ isRehearsal: true, isPrivate: true }).where(eq(trips.id, reef.id));
    expect(
      await holdRescheduleNotice(db, {
        shopId: shop.id,
        tripId: reef.id,
        movedFrom: previousStartsAt,
        meetingPointMoved: false,
        actorPersonId: null,
        now,
      }),
    ).toBeNull();
  });

  it("holds nothing for a departure nobody is booked on", async () => {
    const { db, shop, reef, previousStartsAt, now } = await movedTrip();
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.tripId, reef.id));
    expect(
      await holdRescheduleNotice(db, {
        shopId: shop.id,
        tripId: reef.id,
        movedFrom: previousStartsAt,
        meetingPointMoved: false,
        actorPersonId: null,
        now,
      }),
    ).toBeNull();
  });

  it("records the time the divers were told, and Tell them reads it back", async () => {
    const { db, shop, reef, previousStartsAt, moved, now } = await movedTrip();
    const first = await holdRescheduleNotice(db, {
      shopId: shop.id,
      tripId: reef.id,
      movedFrom: previousStartsAt,
      meetingPointMoved: false,
      actorPersonId: null,
      now,
    });
    const [trip] = await db.select().from(trips).where(eq(trips.id, reef.id));
    expect(trip.diversToldStartsAt).toEqual(previousStartsAt);

    // Undo, then "Tell them": no time comes with it, the record supplies one.
    await db.delete(heldSends).where(eq(heldSends.id, first?.id ?? ""));
    const tell = await holdRescheduleNotice(db, {
      shopId: shop.id,
      tripId: reef.id,
      meetingPointMoved: false,
      actorPersonId: null,
      now,
    });
    const [held] = await db
      .select()
      .from(heldSends)
      .where(eq(heldSends.id, tell?.id ?? ""));
    expect(held.payload).toMatchObject({ previousStartsAt: previousStartsAt.toISOString() });

    // Once sent, the divers know the time: nothing more to tell.
    await db.delete(heldSends).where(eq(heldSends.id, tell?.id ?? ""));
    const { options } = providers();
    await sendRescheduleNotices(
      db,
      shop.id,
      held.payload as Parameters<typeof sendRescheduleNotices>[2],
      { ...options, now },
    );
    const [after] = await db.select().from(trips).where(eq(trips.id, reef.id));
    expect(after.diversToldStartsAt).toBeNull();
    expect(after.startsAt).toEqual(moved.startsAt);
    expect(
      await holdRescheduleNotice(db, {
        shopId: shop.id,
        tripId: reef.id,
        meetingPointMoved: false,
        actorPersonId: null,
        now,
      }),
    ).toBeNull();
  });

  it("records that the meeting point moved beside the time, ORs later moves in, and clears it on send (#2446)", async () => {
    const { db, shop, reef, previousStartsAt, now } = await movedTrip();
    const read = async () =>
      (await db.select().from(trips).where(eq(trips.id, reef.id)))[0]?.diversToldMeetingPoint;
    expect(await read()).toBe(false);

    const first = await holdRescheduleNotice(db, {
      shopId: shop.id,
      tripId: reef.id,
      movedFrom: previousStartsAt,
      meetingPointMoved: true,
      actorPersonId: null,
      now,
    });
    expect(await read()).toBe(true);

    // Undo, then Tell them with nothing posted: the record says the place moved.
    await db.delete(heldSends).where(eq(heldSends.id, first?.id ?? ""));
    const tell = await holdRescheduleNotice(db, {
      shopId: shop.id,
      tripId: reef.id,
      actorPersonId: null,
      now,
    });
    const [held] = await db
      .select()
      .from(heldSends)
      .where(eq(heldSends.id, tell?.id ?? ""));
    expect(held.payload).toMatchObject({ meetingPointMoved: true });

    // A later move that did not touch the place keeps the earlier one's word.
    const again = await holdRescheduleNotice(db, {
      shopId: shop.id,
      tripId: reef.id,
      movedFrom: previousStartsAt,
      meetingPointMoved: false,
      actorPersonId: null,
      now,
    });
    expect(await read()).toBe(true);
    expect(again).not.toBeNull();

    // Sent: the divers know both.
    await sendRescheduleNotices(
      db,
      shop.id,
      held.payload as Parameters<typeof sendRescheduleNotices>[2],
      { ...providers().options, now },
    );
    expect(await read()).toBe(false);
  });

  it("holds nothing for Tell them when no move was ever recorded", async () => {
    const { db, shop, reef, now } = await movedTrip();
    expect(
      await holdRescheduleNotice(db, {
        shopId: shop.id,
        tripId: reef.id,
        meetingPointMoved: false,
        actorPersonId: null,
        now,
      }),
    ).toBeNull();
    expect(await db.select().from(heldSends).where(eq(heldSends.shopId, shop.id))).toHaveLength(0);
  });
});

/**
 * Issue #2451: the link is minted ahead of the send, so a notice that does not
 * go must not leave a live capability behind.
 */
describe("the trip-prep link on a notice that does not go", () => {
  async function send() {
    const moved = await movedTrip();
    const { options } = providers();
    return { moved, options };
  }

  const payload = (moved: Awaited<ReturnType<typeof movedTrip>>) => ({
    kind: "trip_rescheduled" as const,
    tripId: moved.reef.id,
    previousStartsAt: moved.previousStartsAt.toISOString(),
    meetingPointMoved: false,
  });

  it("mints nothing for a phone-only seat on the STOP list", async () => {
    const { moved, options } = await send();
    const { db, shop, kid, now } = moved;
    const [kidRow] = await db.select().from(bookings).where(eq(bookings.id, kid));
    await db.update(people).set({ phone: "+13055550143" }).where(eq(people.id, kidRow.personId));
    await recordSmsKeyword(db, { phone: "+13055550143", optedOut: true, keywordAt: now });
    await sendRescheduleNotices(db, shop.id, payload(moved), { ...options, now });
    expect(
      await db.select().from(bookingCapabilities).where(eq(bookingCapabilities.bookingId, kid)),
    ).toEqual([]);
  });

  it("revokes the link when the email bounces", async () => {
    const { moved } = await send();
    const { db, shop, priya, now } = moved;
    await sendRescheduleNotices(db, shop.id, payload(moved), {
      emailProvider: fakeEmail({ status: "failed", retryable: false, errorCode: "rejected" })
        .provider,
      smsProvider: fakeSms().provider,
      whatsAppProviders: new Map(),
      appOrigin: ORIGIN,
      now,
    });
    const rows = await db
      .select()
      .from(bookingCapabilities)
      .where(eq(bookingCapabilities.bookingId, priya));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it("keeps the link live when the email goes", async () => {
    const { moved, options } = await send();
    const { db, shop, priya, now } = moved;
    await sendRescheduleNotices(db, shop.id, payload(moved), { ...options, now });
    const rows = await db
      .select()
      .from(bookingCapabilities)
      .where(eq(bookingCapabilities.bookingId, priya));
    expect(rows.filter((row) => row.revokedAt === null)).toHaveLength(1);
  });
});

/**
 * Issue #2445: a held seat is skipped by the reschedule notice, and nothing
 * re-sent it when staff confirmed who the diver is, so that diver never learned
 * the departure moved. The skip is remembered on the seat; the confirm sends it.
 */
describe("a held seat's missed reschedule notice", () => {
  async function heldSeat() {
    const moved = await movedTrip();
    const { db, priya } = moved;
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: moved.now })
      .where(eq(bookings.id, priya));
    const [staffer] = await listStaff(db, moved.shop.id);
    if (!staffer) throw new Error("no staff in the demo shop");
    return { ...moved, actorPersonId: staffer.person.id };
  }

  const payload = (moved: Awaited<ReturnType<typeof movedTrip>>, meetingPointMoved = false) => ({
    kind: "trip_rescheduled" as const,
    tripId: moved.reef.id,
    previousStartsAt: moved.previousStartsAt.toISOString(),
    meetingPointMoved,
  });

  const seatRow = async (db: typeof ctx.db, id: string) =>
    (await db.select().from(bookings).where(eq(bookings.id, id)))[0];

  const priyaMail = (email: ReturnType<typeof fakeEmail>) =>
    email.sent.filter((n) => "to" in n && n.to === "reschedule-priya@example.com");

  it("sends one notice when the hold clears, and none on a second confirm", async () => {
    const held = await heldSeat();
    const { db, shop, priya, now, actorPersonId } = held;
    const { email, options } = providers();
    const outcome = await sendRescheduleNotices(db, shop.id, payload(held), { ...options, now });
    expect(outcome.identityHeld).toBe(1);
    expect(priyaMail(email)).toHaveLength(0);
    expect((await seatRow(db, priya))?.rescheduleMissedFrom).toEqual(held.previousStartsAt);

    const confirmed = await confirmBookingIdentity(
      db,
      { shopId: shop.id, bookingId: priya, actorPersonId },
      { ...options, now },
    );
    expect(confirmed).toBe(true);
    expect(priyaMail(email)).toHaveLength(1);
    expect((await deliveriesFor(db, [priya])).map((row) => row.status)).toEqual(["sent"]);
    expect((await seatRow(db, priya))?.rescheduleMissedFrom).toBeNull();

    await confirmBookingIdentity(
      db,
      { shopId: shop.id, bookingId: priya, actorPersonId },
      { ...options, now },
    );
    expect(priyaMail(email)).toHaveLength(1);
  });

  it("keeps the notice owed when the send fails, and sends it on the next confirm", async () => {
    const held = await heldSeat();
    const { db, shop, priya, now, actorPersonId } = held;
    const { email, options } = providers();
    await sendRescheduleNotices(db, shop.id, payload(held), { ...options, now });

    const failing = {
      ...options,
      emailProvider: fakeEmail({ status: "failed", retryable: false, errorCode: "rejected" })
        .provider,
      now,
    };
    await confirmBookingIdentity(db, { shopId: shop.id, bookingId: priya, actorPersonId }, failing);
    // The notice never went, so it is still owed (#2445).
    expect((await seatRow(db, priya))?.rescheduleMissedFrom).toEqual(held.previousStartsAt);
    expect(priyaMail(email)).toHaveLength(0);

    const retried = await sendMissedRescheduleNotice(
      db,
      { shopId: shop.id, bookingId: priya },
      { ...options, now },
    );
    expect(retried).toBe("told");
    expect(priyaMail(email)).toHaveLength(1);
    expect((await seatRow(db, priya))?.rescheduleMissedFrom).toBeNull();
  });

  it("sends nothing on confirm when the trip never moved", async () => {
    const { db, shop, priya, actorPersonId, now } = await heldSeat();
    const { email, options } = providers();
    expect((await seatRow(db, priya))?.rescheduleMissedFrom).toBeNull();
    await confirmBookingIdentity(
      db,
      { shopId: shop.id, bookingId: priya, actorPersonId },
      { ...options, now },
    );
    expect(priyaMail(email)).toHaveLength(0);
  });

  it("sends nothing when the trip is back at the start the seat knew", async () => {
    const held = await heldSeat();
    const { db, shop, reef, priya, actorPersonId, now, previousStartsAt } = held;
    const { email, options } = providers();
    await sendRescheduleNotices(db, shop.id, payload(held), { ...options, now });
    await moveTrip(db, shop.id, reef.id, previousStartsAt);
    await confirmBookingIdentity(
      db,
      { shopId: shop.id, bookingId: priya, actorPersonId },
      { ...options, now },
    );
    expect(priyaMail(email)).toHaveLength(0);
    expect((await seatRow(db, priya))?.rescheduleMissedFrom).toBeNull();
  });

  it("keeps the earliest start the seat knew across two skipped moves", async () => {
    const held = await heldSeat();
    const { db, shop, priya, now, previousStartsAt } = held;
    const { options } = providers();
    await sendRescheduleNotices(db, shop.id, payload(held), { ...options, now });
    const later = new Date(previousStartsAt.getTime() + 24 * HOUR);
    await sendRescheduleNotices(
      db,
      shop.id,
      { ...payload(held), previousStartsAt: later.toISOString() },
      { ...options, now },
    );
    expect((await seatRow(db, priya))?.rescheduleMissedFrom).toEqual(previousStartsAt);
  });

  it("tells a held seat where to meet when only the place moved", async () => {
    const held = await heldSeat();
    const { db, shop, reef, priya, actorPersonId, now } = held;
    const { email, options } = providers();
    await db
      .update(trips)
      .set({ meetingPointLabel: "North Pier", meetingPointAddress: "1 Dock St" })
      .where(eq(trips.id, reef.id));
    const placeOnly = {
      ...payload(held, true),
      previousStartsAt: held.moved.startsAt.toISOString(),
    };
    await sendRescheduleNotices(db, shop.id, placeOnly, { ...options, now });
    expect((await seatRow(db, priya))?.rescheduleMissedPlace).toBe(true);
    await confirmBookingIdentity(
      db,
      { shopId: shop.id, bookingId: priya, actorPersonId },
      { ...options, now },
    );
    const [mail] = priyaMail(email);
    if (mail?.kind !== "trip_rescheduled") throw new Error("expected a reschedule notice");
    expect(mail.meetingPoint).toMatchObject({ label: "North Pier" });
  });

  it("tells the new record's own address when the held seat is split off", async () => {
    const held = await heldSeat();
    const { db, shop, priya, actorPersonId, now } = held;
    const { email, options } = providers();
    await sendRescheduleNotices(db, shop.id, payload(held), { ...options, now });
    const result = await splitBookingIdentity(
      db,
      {
        shopId: shop.id,
        bookingId: priya,
        actorPersonId,
        fullName: "Pia Shah",
        email: "reschedule-pia@example.com",
        adultAttested: true,
      },
      { ...options, now },
    );
    if (!result.ok) throw new Error(`split refused: ${result.reason}`);
    const toPia = email.sent.filter((n) => "to" in n && n.to === "reschedule-pia@example.com");
    expect(toPia).toHaveLength(1);
    expect(priyaMail(email)).toHaveLength(0);
  });
});
