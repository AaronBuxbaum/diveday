import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate, nowMs } from "@/lib/clock";
import { tripRescheduledEmail } from "@/lib/notifications/email";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail, fakeSms } from "@/test/fakes";
import { createBooking, listSeatMoveTargets, moveBooking } from "./bookings";
import { formBuddyTeam } from "./buddy-pairs";
import type { AppDb } from "./client";
import { listDeskEventsSince, markTripCaughtUp } from "./desk-events";
import { recordFlySafeTold } from "./fly-safe-correction";
import { hasMoveAsk, recordMoveAsk } from "./inbound-messages";
import { addInterest } from "./interest-dates-fixtures";
import { associateDateRequestOfferBooking } from "./interests";
import { listTripActivity } from "./operations";
import {
  activityEvents,
  bookings,
  certifications,
  courses,
  dateRequestOfferBookings,
  inboundMessages,
  interests,
  people,
  tripDeskEvents,
  tripHelpRequests,
  tripRequirements,
  trips,
} from "./schema";
import { moveSeat } from "./seat-diver";
import { initializeTodayCatchUp, readTodayCatchUp } from "./today-catch-up";
import {
  createTrip,
  getTripRoster,
  listStaff,
  setTripCrew,
  upcomingTripsWithCounts,
} from "./trips";

/**
 * **A staffer moves a booked seat to another departure** (ADR
 * 20261013-staff-move-a-seat). The same row changes trip, so everything keyed
 * on the booking travels; the new seat is measured as a new staff seat is; and
 * what belongs to the old departure is refused rather than rewritten.
 */

const ctx = fileScopedShopContext();
const DAY_MS = 24 * 60 * 60 * 1000;

async function setup(targetCapacity = 6) {
  const { db, shop } = ctx;
  const upcoming = await upcomingTripsWithCounts(db, shop.id);
  const from = upcoming.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  if (!from) throw new Error("seeded trip missing");
  const to = await createTrip(db, {
    shopId: shop.id,
    title: "Two-Tank Reef — next week",
    startsAt: new Date(nowMs() + 40 * DAY_MS),
    endsAt: new Date(nowMs() + 40 * DAY_MS + 4 * 60 * 60 * 1000),
    capacity: targetCapacity,
    plannedDives: 2,
    priceCents: 12_000,
  });
  if (!to) throw new Error("target trip failed");
  const seat = await seatOn(db, shop.id, from.id, "Nora Quinn");
  return { db, shop, from, to, seat };
}

async function seatOn(db: AppDb, shopId: string, tripId: string, fullName: string) {
  const booked = await createBooking(db, {
    actor: "staff",
    shopId,
    tripId,
    fullName,
    email: `${fullName.toLowerCase().replace(/\W+/g, "-")}@example.com`,
  });
  if (!booked.ok) throw new Error(`seating ${fullName} failed: ${booked.reason}`);
  return booked;
}

function move(db: AppDb, shopId: string, fromTripId: string, toTripId: string, bookingId: string) {
  return moveBooking(db, { shopId, fromTripId, toTripId, bookingId });
}

async function tripOf(db: AppDb, bookingId: string) {
  const [row] = await db
    .select({ tripId: bookings.tripId })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row?.tripId;
}

describe("moveBooking", () => {
  it("moves a linked solo booking and its request association together", async () => {
    const { db, shop, from, to, seat } = await setup();
    const requestId = await addInterest(db, shop.id, { interest: "reef dive" });
    const offers = await db
      .insert(interests)
      .values(
        [from.id, to.id].map((tripId) => ({
          shopId: shop.id,
          scope: "departure" as const,
          askedBy: "diver" as const,
          tripId,
          parentInterestId: requestId,
          partySize: 1,
          offeredAt: nowDate(),
        })),
      )
      .returning({ id: interests.id, tripId: interests.tripId });
    const sourceOffer = offers.find((offer) => offer.tripId === from.id);
    const targetOffer = offers.find((offer) => offer.tripId === to.id);
    if (!sourceOffer || !targetOffer) throw new Error("setup: date request offers missing");
    expect(
      await associateDateRequestOfferBooking(db, {
        shopId: shop.id,
        tripId: from.id,
        requestId,
        bookingId: seat.bookingId,
      }),
    ).toBe(true);

    expect(await move(db, shop.id, from.id, to.id, seat.bookingId)).toMatchObject({ ok: true });
    const [link] = await db
      .select({ interestId: dateRequestOfferBookings.interestId })
      .from(dateRequestOfferBookings)
      .where(eq(dateRequestOfferBookings.bookingId, seat.bookingId));
    expect(link?.interestId).toBe(targetOffer.id);
  });

  it("moves the same booking row, and both crews read it on the catch-up strip", async () => {
    const { db, shop, from, to, seat } = await setup();
    await db.insert(tripHelpRequests).values({
      shopId: shop.id,
      tripId: from.id,
      bookingId: seat.bookingId,
      kind: "carry_gear",
    });

    const moved = await move(db, shop.id, from.id, to.id, seat.bookingId);
    expect(moved).toMatchObject({
      ok: true,
      personName: "Nora Quinn",
      fromTripId: from.id,
      toTripId: to.id,
      owedCents: 0,
    });
    expect(await tripOf(db, seat.bookingId)).toBe(to.id);
    const fromRoster = await getTripRoster(db, shop.id, from.id);
    const toRoster = await getTripRoster(db, shop.id, to.id);
    expect(fromRoster.map((r) => r.booking.id)).not.toContain(seat.bookingId);
    expect(toRoster.map((r) => r.booking.id)).toContain(seat.bookingId);

    const desk = await db
      .select({ tripId: tripDeskEvents.tripId, kind: tripDeskEvents.kind })
      .from(tripDeskEvents)
      .where(eq(tripDeskEvents.bookingId, seat.bookingId));
    expect(desk).toEqual(
      expect.arrayContaining([
        { tripId: from.id, kind: "seat_released" },
        { tripId: to.id, kind: "seat_taken" },
      ]),
    );
    const [help] = await db
      .select({ tripId: tripHelpRequests.tripId })
      .from(tripHelpRequests)
      .where(eq(tripHelpRequests.bookingId, seat.bookingId));
    expect(help?.tripId).toBe(to.id);
  });

  it("excludes a staff mover from catch-up while both crews see the move", async () => {
    const { db, shop } = ctx;
    const now = nowDate();
    const staff = await listStaff(db, shop.id);
    const actor = staff[0]?.person.id;
    const observer = staff.find((entry) => entry.person.id !== actor)?.person.id;
    if (!actor || !observer) throw new Error("expected two staff");
    const from = await createTrip(db, {
      shopId: shop.id,
      title: "Move source today",
      startsAt: new Date(nowMs() + 60 * 60 * 1000),
      endsAt: new Date(nowMs() + 3 * 60 * 60 * 1000),
      capacity: 6,
    });
    const to = await createTrip(db, {
      shopId: shop.id,
      title: "Move target today",
      startsAt: new Date(nowMs() + 2 * 60 * 60 * 1000),
      endsAt: new Date(nowMs() + 4 * 60 * 60 * 1000),
      capacity: 6,
    });
    if (!from || !to) throw new Error("expected two trips");
    const seat = await seatOn(db, shop.id, from.id, "Moving Diver");
    for (const personId of [actor, observer]) {
      const input = { shopId: shop.id, personId, now, timeZone: shop.timezone };
      const initial = await readTodayCatchUp(db, input);
      await initializeTodayCatchUp(db, { ...input, eventIds: initial.snapshotIds });
      for (const tripId of [from.id, to.id]) {
        await markTripCaughtUp(db, { shopId: shop.id, tripId, personId });
      }
    }
    const moved = await moveBooking(db, {
      shopId: shop.id,
      fromTripId: from.id,
      toTripId: to.id,
      bookingId: seat.bookingId,
      actorPersonId: actor,
    });
    expect(moved.ok).toBe(true);
    const actorToday = await readTodayCatchUp(db, {
      shopId: shop.id,
      personId: actor,
      now,
      timeZone: shop.timezone,
    });
    const otherToday = await readTodayCatchUp(db, {
      shopId: shop.id,
      personId: observer,
      now,
      timeZone: shop.timezone,
    });
    expect(
      actorToday.events.filter((event) => event.tripId === from.id || event.tripId === to.id),
    ).toEqual([]);
    expect(
      otherToday.events
        .filter((event) => event.tripId === from.id || event.tripId === to.id)
        .map((event) => event.kind),
    ).toEqual(["seat_released", "seat_taken"]);
    for (const [tripId, kind] of [
      [from.id, "seat_released"],
      [to.id, "seat_taken"],
    ] as const) {
      expect((await listDeskEventsSince(db, shop.id, tripId, actor)).events).toEqual([]);
      expect(
        (await listDeskEventsSince(db, shop.id, tripId, observer)).events.map(
          (event) => event.kind,
        ),
      ).toEqual([kind]);
    }
  });

  it("refuses a full departure and leaves the seat where it was", async () => {
    const { db, shop, from, to, seat } = await setup(1);
    await seatOn(db, shop.id, to.id, "Fill Seat");
    expect(await move(db, shop.id, from.id, to.id, seat.bookingId)).toEqual({
      ok: false,
      reason: "trip_full",
    });
    expect(await tripOf(db, seat.bookingId)).toBe(from.id);
  });

  it("refuses a departure the diver cannot qualify for, naming what it asks", async () => {
    const { db, shop, from, to, seat } = await setup();
    // A diver with no card on file is admitted blind (H-08); one with an Open
    // Water card is measured against it.
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: seat.personId,
      agency: "padi",
      level: "open_water",
      identifier: "C-MOVE-1",
      status: "verified",
    });
    await db.delete(tripRequirements).where(eq(tripRequirements.tripId, to.id));
    await db.insert(tripRequirements).values({
      tripId: to.id,
      shopId: shop.id,
      minimumCertificationLevel: "rescue",
    });
    const moved = await move(db, shop.id, from.id, to.id, seat.bookingId);
    expect(moved).toMatchObject({ ok: false, reason: "trip_prerequisite" });
    expect(await tripOf(db, seat.bookingId)).toBe(from.id);
  });

  it("refuses moving a dive seat onto a course session", async () => {
    const { db, shop, from, seat } = await setup();
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Discover Scuba Diving")));
    if (!course) throw new Error("course missing");
    const session = await createTrip(db, {
      shopId: shop.id,
      courseId: course.id,
      title: "Discover Scuba — move test",
      startsAt: new Date(nowMs() + 180 * DAY_MS),
      endsAt: new Date(nowMs() + 180 * DAY_MS + 4 * 60 * 60 * 1000),
      capacity: 12,
      plannedDives: 2,
    });
    if (!session) throw new Error("session failed");
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (instructor) await setTripCrew(db, shop.id, session.id, [instructor.person.id]);
    expect(await move(db, shop.id, from.id, session.id, seat.bookingId)).toEqual({
      ok: false,
      reason: "course_mismatch",
    });
  });

  it("refuses a diver who already holds, or once held, a seat there", async () => {
    const { db, shop, from, to, seat } = await setup();
    const there = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: to.id,
      personId: seat.personId,
    });
    if (!there.ok) throw new Error("second seat failed");
    expect(await move(db, shop.id, from.id, to.id, seat.bookingId)).toEqual({
      ok: false,
      reason: "already_booked",
    });
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, there.bookingId));
    expect(await move(db, shop.id, from.id, to.id, seat.bookingId)).toEqual({
      ok: false,
      reason: "earlier_seat",
    });
  });

  it("refuses a seat that is checked in, or whose departure has sailed", async () => {
    const { db, shop, from, to, seat } = await setup();
    expect(
      await moveBooking(db, {
        shopId: shop.id,
        fromTripId: from.id,
        toTripId: to.id,
        bookingId: seat.bookingId,
        now: new Date(from.startsAt.getTime() + 2 * 60 * 60 * 1000),
      }),
    ).toEqual({ ok: false, reason: "departed" });
    await db.update(bookings).set({ status: "checked_in" }).where(eq(bookings.id, seat.bookingId));
    expect(await move(db, shop.id, from.id, to.id, seat.bookingId)).toEqual({
      ok: false,
      reason: "not_movable",
    });
  });

  it("refuses a party lead with live seats behind it", async () => {
    const { db, shop, from, to, seat } = await setup();
    const guest = await seatOn(db, shop.id, from.id, "Party Guest");
    await db
      .update(bookings)
      .set({ partyLeadBookingId: seat.bookingId })
      .where(eq(bookings.id, guest.bookingId));
    expect(await move(db, shop.id, from.id, to.id, seat.bookingId)).toEqual({
      ok: false,
      reason: "leads_party",
    });
    // The guest moving alone leaves the party.
    expect(await move(db, shop.id, from.id, to.id, guest.bookingId)).toMatchObject({ ok: true });
    const [row] = await db
      .select({ lead: bookings.partyLeadBookingId })
      .from(bookings)
      .where(eq(bookings.id, guest.bookingId));
    expect(row?.lead).toBeNull();
  });

  it("refuses a seat on a buddy team until the team is taken apart", async () => {
    const { db, shop, from, to, seat } = await setup();
    const buddy = await seatOn(db, shop.id, from.id, "Buddy Diver");
    const staff = await listStaff(db, shop.id);
    const owner = staff.find((entry) => entry.roles.includes("owner"));
    if (!owner) throw new Error("owner missing");
    const team = await formBuddyTeam(db, {
      shopId: shop.id,
      tripId: from.id,
      members: [
        { kind: "diver", bookingId: seat.bookingId },
        { kind: "diver", bookingId: buddy.bookingId },
      ],
      recordedByPersonId: owner.person.id,
    });
    expect(team).toMatchObject({ ok: true });
    expect(await move(db, shop.id, from.id, to.id, seat.bookingId)).toEqual({
      ok: false,
      reason: "on_buddy_team",
    });
  });

  it("refuses the same departure, and one that is not this shop's", async () => {
    const { db, shop, from, seat } = await setup();
    expect(await move(db, shop.id, from.id, from.id, seat.bookingId)).toEqual({
      ok: false,
      reason: "target_unavailable",
    });
    expect(
      await move(db, shop.id, from.id, "00000000-0000-4000-8000-000000000000", seat.bookingId),
    ).toEqual({ ok: false, reason: "target_unavailable" });
  });

  it("forgets what was said about the old departure: briefing, facts check, pickup, lateness", async () => {
    const { db, shop, from, to, seat } = await setup();
    // The new departure's conditions were posted before the diver had any
    // reason to read them: a stamp carried over would say they had.
    await db
      .update(trips)
      .set({ conditionsUpdatedAt: new Date(nowMs() - DAY_MS) })
      .where(eq(trips.id, to.id));
    await db
      .update(bookings)
      .set({
        conditionsBriefedAt: new Date(nowMs() - 60_000),
        carriedFactsConfirmedAt: new Date(nowMs() - 60_000),
        pickupTime: "07:15",
        runningLateAt: new Date(nowMs() - 60_000),
      })
      .where(eq(bookings.id, seat.bookingId));

    expect(await move(db, shop.id, from.id, to.id, seat.bookingId)).toMatchObject({ ok: true });
    const [row] = await db
      .select({
        conditionsBriefedAt: bookings.conditionsBriefedAt,
        carriedFactsConfirmedAt: bookings.carriedFactsConfirmedAt,
        pickupTime: bookings.pickupTime,
        runningLateAt: bookings.runningLateAt,
      })
      .from(bookings)
      .where(eq(bookings.id, seat.bookingId));
    expect(row).toEqual({
      conditionsBriefedAt: null,
      carriedFactsConfirmedAt: null,
      pickupTime: null,
      runningLateAt: null,
    });
  });

  /**
   * Dive-domain review F1 of layer r4-1: an "Ask to move" is about the old
   * departure. The move answers it, so the new date's page offers the ask
   * again and the Inbox row stops waiting.
   */
  it("answers the diver's standing Ask to move", async () => {
    const { db, shop, from, to, seat } = await setup();
    const asked = await recordMoveAsk(db, {
      shopId: shop.id,
      bookingId: seat.bookingId,
      now: new Date(nowMs() - 60_000),
    });
    if (asked.status !== "recorded") throw new Error(`expected recorded, got ${asked.status}`);
    expect(await hasMoveAsk(db, shop.id, seat.bookingId)).toBe(true);

    expect(await move(db, shop.id, from.id, to.id, seat.bookingId)).toMatchObject({ ok: true });
    const [row] = await db
      .select({ answeredAt: inboundMessages.answeredAt })
      .from(inboundMessages)
      .where(eq(inboundMessages.id, asked.id));
    expect(row?.answeredAt).not.toBeNull();
    expect(await hasMoveAsk(db, shop.id, seat.bookingId)).toBe(false);
  });

  it("leaves a help request the old crew already handled on the old departure", async () => {
    const { db, shop, from, to, seat } = await setup();
    await db.insert(tripHelpRequests).values({
      shopId: shop.id,
      tripId: from.id,
      bookingId: seat.bookingId,
      kind: "carry_gear",
      status: "handled",
      handledAt: new Date(nowMs() - 60_000),
    });

    expect(await move(db, shop.id, from.id, to.id, seat.bookingId)).toMatchObject({ ok: true });
    const [help] = await db
      .select({ tripId: tripHelpRequests.tripId })
      .from(tripHelpRequests)
      .where(eq(tripHelpRequests.bookingId, seat.bookingId));
    expect(help?.tripId).toBe(from.id);
  });
});

describe("moveSeat (the consequence path)", () => {
  it("corrects only the moved diver when the destination already requires decompression", async () => {
    const { db, shop, from, to, seat } = await setup();
    const owner = (await listStaff(db, shop.id)).find((entry) => entry.roles.includes("owner"));
    if (!owner) throw new Error("owner missing");
    const other = await seatOn(db, shop.id, to.id, "Ada Other");
    await recordFlySafeTold(db, {
      shopId: shop.id,
      bookingId: seat.bookingId,
      hours: 24,
      recipientEmail: "nora-quinn@example.com",
    });
    await recordFlySafeTold(db, {
      shopId: shop.id,
      bookingId: other.bookingId,
      hours: 24,
      recipientEmail: "ada-other@example.com",
    });
    await db.update(trips).set({ exceedsNoDecoLimits: true }).where(eq(trips.id, to.id));
    const email = fakeEmail();
    const moved = await moveSeat(
      db,
      {
        shopId: shop.id,
        fromTripId: from.id,
        toTripId: to.id,
        bookingId: seat.bookingId,
        actorPersonId: owner.person.id,
      },
      { emailProvider: email.provider, appOrigin: null },
    );
    expect(moved.ok).toBe(true);
    expect(email.sent.filter((item) => item.kind === "fly_safe_correction")).toMatchObject([
      { seatId: seat.bookingId, to: "nora-quinn@example.com" },
    ]);
    const [untouched] = await db
      .select({ corrected: bookings.flySafeCorrectedAt })
      .from(bookings)
      .where(eq(bookings.id, other.bookingId));
    expect(untouched?.corrected).toBeNull();
  });

  it("corrects an 18-hour reminder when a seat moves to a two-dive departure", async () => {
    const { db, shop, from, to, seat } = await setup();
    const owner = (await listStaff(db, shop.id)).find((entry) => entry.roles.includes("owner"));
    if (!owner) throw new Error("owner missing");
    await recordFlySafeTold(db, {
      shopId: shop.id,
      bookingId: seat.bookingId,
      hours: 18,
      recipientEmail: "nora-quinn@example.com",
    });
    const email = fakeEmail();
    const moved = await moveSeat(
      db,
      {
        shopId: shop.id,
        fromTripId: from.id,
        toTripId: to.id,
        bookingId: seat.bookingId,
        actorPersonId: owner.person.id,
      },
      { emailProvider: email.provider, appOrigin: null },
    );
    expect(moved.ok).toBe(true);
    expect(
      email.sent.some(
        (item) => item.kind === "fly_safe_correction" && item.seatId === seat.bookingId,
      ),
    ).toBe(true);
  });

  it("tells the diver at their own address, and writes both trails", async () => {
    const { db, shop, from, to, seat } = await setup();
    const staff = await listStaff(db, shop.id);
    const owner = staff.find((entry) => entry.roles.includes("owner"));
    if (!owner) throw new Error("owner missing");
    const email = fakeEmail();
    const sms = fakeSms();
    const moved = await moveSeat(
      db,
      {
        shopId: shop.id,
        fromTripId: from.id,
        toTripId: to.id,
        bookingId: seat.bookingId,
        actorPersonId: owner.person.id,
      },
      {
        emailProvider: email.provider,
        smsProvider: sms.provider,
        whatsAppProviders: new Map(),
        appOrigin: "https://diveday.example",
      },
    );
    expect(moved).toMatchObject({ ok: true, notice: "told" });
    expect(email.sent).toHaveLength(1);
    const [sent] = email.sent;
    if (sent?.kind !== "trip_rescheduled") throw new Error("expected a reschedule notice");
    expect(sent).toMatchObject({
      bookingId: seat.bookingId,
      to: "nora-quinn@example.com",
      tripTitle: "Two-Tank Reef — next week",
      previousStartsAt: from.startsAt,
      startsAt: to.startsAt,
    });
    expect(sent.seatMovedAt).toBeInstanceOf(Date);
    expect(tripRescheduledEmail(sent).text).toContain("We moved your seat to Two-Tank Reef");

    const codes = async (tripId: string) =>
      (await listTripActivity(db, shop.id, tripId)).map((entry) => entry.code);
    expect(await codes(from.id)).toContain("seat_moved_away");
    expect(await codes(to.id)).toContain("seat_moved_here");
    // Both lines name whose seat by record, written with the move (security
    // review 2026-10-16, F1).
    const subjects = await db
      .select({ subject: activityEvents.subjectPersonId })
      .from(activityEvents)
      .where(
        and(
          inArray(activityEvents.tripId, [from.id, to.id]),
          inArray(activityEvents.code, ["seat_moved_away", "seat_moved_here"]),
        ),
      );
    expect(subjects).toHaveLength(2);
    if (!moved.ok) throw new Error("expected a move");
    expect(subjects.every((row) => row.subject === moved.personId)).toBe(true);
  });
});

describe("listSeatMoveTargets", () => {
  it("lists later dive departures, never this one or a course session", async () => {
    const { db, shop, from, to } = await setup();
    const targets = await listSeatMoveTargets(db, shop.id, from.id);
    const ids = targets.map((target) => target.id);
    expect(ids).toContain(to.id);
    expect(ids).not.toContain(from.id);
    const sessions = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), isNotNull(trips.courseId)));
    for (const session of sessions) expect(ids).not.toContain(session.id);
    expect(targets.map((target) => target.startsAt.getTime())).toEqual(
      [...targets.map((target) => target.startsAt.getTime())].sort((a, b) => a - b),
    );
  });
});

describe("listSeatMoveTargets, with the seats each has left", () => {
  // "Carry the wait list" offered boats with no seat as if they could help
  // (dive-domain review r4-4, N9): each target says what it has left.
  it("counts the seats a target still sells", async () => {
    const { db, shop, from, to } = await setup(2);
    await seatOn(db, shop.id, to.id, "Ola Seated");
    const target = (await listSeatMoveTargets(db, shop.id, from.id)).find(
      (row) => row.id === to.id,
    );
    expect(target?.seatsLeft).toBe(1);
    await seatOn(db, shop.id, to.id, "Pia Seated");
    const full = (await listSeatMoveTargets(db, shop.id, from.id)).find((row) => row.id === to.id);
    expect(full?.seatsLeft).toBe(0);
  });
});

describe("moveBooking between sessions of one course", () => {
  /**
   * Age is measured on the day the session runs (H-08), so the same student
   * can be old enough for the later session and too young for an earlier one.
   * The move measures the session it lands on.
   */
  it("refuses an earlier session the student is still too young for", async () => {
    const { db, shop } = ctx;
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Discover Scuba Diving")));
    if (!course) throw new Error("course missing");
    const minimumAge = course.minimumAge ?? 10;
    if (course.minimumAge === null) {
      await db.update(courses).set({ minimumAge }).where(eq(courses.id, course.id));
    }
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!instructor) throw new Error("instructor missing");
    const session = async (days: number, title: string) => {
      const trip = await createTrip(db, {
        shopId: shop.id,
        courseId: course.id,
        title,
        startsAt: new Date(nowMs() + days * DAY_MS),
        endsAt: new Date(nowMs() + days * DAY_MS + 4 * 60 * 60 * 1000),
        capacity: 12,
        plannedDives: 2,
      });
      if (!trip) throw new Error("session failed");
      await setTripCrew(db, shop.id, trip.id, [instructor.person.id]);
      return trip;
    };
    const later = await session(200, "Discover Scuba — later");
    const earlier = await session(180, "Discover Scuba — earlier");
    // Their birthday falls between the two sessions.
    const birthday = new Date(nowMs() + 190 * DAY_MS);
    const dateOfBirth = `${birthday.getUTCFullYear() - minimumAge}-${String(
      birthday.getUTCMonth() + 1,
    ).padStart(2, "0")}-${String(birthday.getUTCDate()).padStart(2, "0")}`;
    const student = await seatOn(db, shop.id, later.id, "Young Student");
    await db.update(people).set({ dateOfBirth }).where(eq(people.id, student.personId));

    expect(await move(db, shop.id, later.id, earlier.id, student.bookingId)).toEqual({
      ok: false,
      reason: "course_min_age",
    });
    expect(await tripOf(db, student.bookingId)).toBe(later.id);
  });
});
