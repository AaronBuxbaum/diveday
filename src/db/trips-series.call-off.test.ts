import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { calendarDateWeekday } from "@/lib/calendar-date";
import { weekdaySetFrom } from "@/lib/recurrence";
import { fileScopedShopContext, type seededShopContext } from "@/test/db";
import { fakeCheckout, fakeEmail } from "@/test/fakes";
import { getTripBlowout } from "./blowouts";
import { createBookingParty } from "./bookings";
import { getBookingPayment, setBookingPayment } from "./payments";
import { crewNotices, people, rollCallEvents, trips } from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import {
  cancelFutureSeriesTrips,
  cancelOffCadenceSeriesTrips,
  createTripSeries,
  getTripWithBooked,
  listOffCadenceSeriesTrips,
  listStaff,
  type NewTripSeries,
  setTripCrew,
  updateSeriesCadence,
} from "./trips";

const TZ = "America/New_York";
const WED = 3;
const SAT = 6;

const at = (iso: string) => new Date(iso);

function seriesInput(overrides: Partial<NewTripSeries> & { shopId: string }): NewTripSeries {
  return {
    title: "Saturday Two-Tank",
    capacity: 12,
    plannedDives: 2,
    frequency: "weekly",
    intervalWeeks: 1,
    weekdays: weekdaySetFrom([SAT]),
    anchorDate: "2030-09-07",
    endsOn: null,
    timeZone: TZ,
    template: {
      startsAt: at("2030-09-07T11:00:00.000Z"),
      endsAt: at("2030-09-07T15:00:00.000Z"),
    },
    ...overrides,
  };
}

async function ownerId(db: Awaited<ReturnType<typeof seededShopContext>>["db"], shopId: string) {
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.fullName, "Dana Reyes")))
    .limit(1);
  if (!owner) throw new Error("seeded owner missing");
  return owner.id;
}

/** Live rows only: what is *on the board* for the series, deleted departures excluded. */
async function occurrenceDatesOf(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  seriesId: string,
) {
  const rows = await db
    .select({ date: trips.seriesOccurrenceDate })
    .from(trips)
    .where(and(eq(trips.seriesId, seriesId), isNull(trips.deletedAt)));
  return rows
    .map((row) => row.date)
    .filter((date): date is string => date !== null)
    .sort();
}

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

describe("calling a run's dates off (in-memory PGlite)", () => {
  // Issue #2453: the narrowing cancel treats a paid diver like the run-wide one.
  describe("narrowing a run's cadence (issue #2453)", () => {
    async function narrowedRun() {
      const { db, shop } = ctx;
      const now = at("2030-08-15T00:00:00.000Z");
      const result = await createTripSeries(
        db,
        seriesInput({
          shopId: shop.id,
          title: "Wed and Sat Wreck",
          endsOn: "2030-09-21",
          weekdays: weekdaySetFrom([WED, SAT]),
        }),
      );
      if (!result) throw new Error("series not created");
      await updateSeriesCadence(
        db,
        shop.id,
        result.series.id,
        { intervalWeeks: 1, weekdays: weekdaySetFrom([SAT]), endsOn: "2030-09-21" },
        now,
      );
      const [dropped] = await listOffCadenceSeriesTrips(db, shop.id, result.series.id, now);
      if (!dropped) throw new Error("expected a dropped date");
      const party = await createBookingParty(db, [
        {
          actor: "staff" as const,
          shopId: shop.id,
          tripId: dropped.id,
          fullName: "Wes Dropped",
          email: "wes.dropped@example.com",
        },
      ]);
      if (!party.ok) throw new Error("could not book the dropped date");
      await upsertShopStripeAccount(db, shop.id, "acct_narrow_cancel");
      await setShopStripeAccountStatus(db, "acct_narrow_cancel", {
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      });
      const bookingId = party.bookings[0]?.bookingId as string;
      await setBookingPayment(db, {
        shopId: shop.id,
        bookingId,
        status: "paid",
        amountCents: 15_000,
        currency: "usd",
        provider: "stripe",
        providerRef: "cs_narrow_paid",
      });
      return { db, shop, now, result, dropped, bookingId };
    }

    it("refunds a paid diver on a dropped weekday and sends them exactly one run_ended message", async () => {
      const run = await narrowedRun();
      const email = fakeEmail();
      const outcome = await cancelOffCadenceSeriesTrips(run.db, {
        shopId: run.shop.id,
        seriesId: run.result.series.id,
        calledByPersonId: await ownerId(run.db, run.shop.id),
        now: run.now,
        provider: email.provider,
        checkout: fakeCheckout(),
      });
      expect(outcome.divers).toBe(1);
      expect(outcome.tripIds).toContain(run.dropped.id);
      const told = email.sent.filter(
        (sent) => sent.kind === "trip_blowout" && sent.to === "wes.dropped@example.com",
      );
      expect(told).toHaveLength(1);
      expect(told[0]?.kind === "trip_blowout" && told[0].cause).toBe("run_ended");
      expect(told[0]?.kind === "trip_blowout" && told[0].paymentStory).toBe("refunded");
      expect((await getBookingPayment(run.db, run.shop.id, run.bookingId))?.status).toBe(
        "refunded",
      );
      expect((await getTripBlowout(run.db, run.shop.id, run.dropped.id))?.cause).toBe("run_ended");
      // A second tap finds nothing left to call and sends nobody a second message.
      const again = await cancelOffCadenceSeriesTrips(run.db, {
        shopId: run.shop.id,
        seriesId: run.result.series.id,
        calledByPersonId: await ownerId(run.db, run.shop.id),
        now: run.now,
        provider: email.provider,
        checkout: fakeCheckout(),
      });
      expect(again.cancelled).toBe(0);
      expect(email.sent.filter((sent) => sent.kind === "trip_blowout")).toHaveLength(1);
    });

    it("leaves a dropped date whose boarding has begun on the board", async () => {
      const run = await narrowedRun();
      const [staff] = await listStaff(run.db, run.shop.id);
      if (!staff) throw new Error("seed staff missing");
      await run.db.insert(rollCallEvents).values({
        shopId: run.shop.id,
        tripId: run.dropped.id,
        bookingId: run.bookingId,
        recordedByPersonId: staff.person.id,
        status: "boarded",
        checkpoint: "after_dive_2",
        occurredAt: run.now,
      });
      const outcome = await cancelOffCadenceSeriesTrips(run.db, {
        shopId: run.shop.id,
        seriesId: run.result.series.id,
        calledByPersonId: await ownerId(run.db, run.shop.id),
        now: run.now,
        provider: fakeEmail().provider,
        checkout: fakeCheckout(),
      });
      // An after-dive mark is the crew's word the boat is out (H-20261015-aboard-diver-removal-at), so the
      // date is never offered as off-cadence, and so never reaches the cascade.
      expect(outcome.tripIds).not.toContain(run.dropped.id);
      expect((await getTripWithBooked(run.db, run.shop.id, run.dropped.id))?.status).toBe(
        "scheduled",
      );
      expect((await getBookingPayment(run.db, run.shop.id, run.bookingId))?.status).toBe("paid");
    });
  });

  // Issue #2284: cancelling a run is a staffer's act, not a system pass, so
  // its call-off news names them, and (like every crew notice) the staffer
  // who did it is not told about their own act.
  it("names the staffer who cancelled the run, in both of a series' call-offs", async () => {
    const { db, shop } = ctx;
    const now = at("2030-09-30T12:00:00.000Z");
    const staffIds = [...new Set((await listStaff(db, shop.id)).map((row) => row.person.id))];
    const [actorId, otherId] = staffIds;
    if (!actorId || !otherId) throw new Error("seed staff missing");
    const actor = { id: actorId };
    const other = { id: otherId };
    const calledOff = async (tripId: string) =>
      db
        .select({ personId: crewNotices.personId, actorPersonId: crewNotices.actorPersonId })
        .from(crewNotices)
        .where(and(eq(crewNotices.tripId, tripId), eq(crewNotices.change, "called_off")));

    const offCadence = await createTripSeries(
      db,
      seriesInput({ shopId: shop.id, weekdays: weekdaySetFrom([WED, SAT]) }),
    );
    if (!offCadence) throw new Error("series not created");
    await updateSeriesCadence(
      db,
      shop.id,
      offCadence.series.id,
      { intervalWeeks: 1, weekdays: weekdaySetFrom([SAT]), endsOn: null },
      now,
    );
    const [orphan] = await listOffCadenceSeriesTrips(db, shop.id, offCadence.series.id, now);
    if (!orphan) throw new Error("expected an off-cadence date");
    await setTripCrew(db, shop.id, orphan.id, [actor.id, other.id]);
    await cancelOffCadenceSeriesTrips(db, {
      shopId: shop.id,
      seriesId: offCadence.series.id,
      calledByPersonId: actor.id,
      now,
    });
    expect(await calledOff(orphan.id)).toEqual([{ personId: other.id, actorPersonId: actor.id }]);

    const whole = await createTripSeries(db, seriesInput({ shopId: shop.id }));
    if (!whole) throw new Error("series not created");
    const upcoming = whole.trips.find((trip) => trip.startsAt > now);
    if (!upcoming) throw new Error("expected an upcoming date");
    await setTripCrew(db, shop.id, upcoming.id, [actor.id, other.id]);
    await cancelFutureSeriesTrips(db, {
      shopId: shop.id,
      seriesId: whole.series.id,
      calledByPersonId: actor.id,
      now,
    });
    expect(await calledOff(upcoming.id)).toEqual([{ personId: other.id, actorPersonId: actor.id }]);
  });

  it("cancels the orphaned dates only when asked, and leaves the ones that sailed", async () => {
    const { db, shop } = ctx;
    const now = at("2030-09-30T12:00:00.000Z");
    const result = await createTripSeries(
      db,
      seriesInput({ shopId: shop.id, weekdays: weekdaySetFrom([WED, SAT]) }),
    );
    if (!result) throw new Error("series not created");
    // A Wednesday that has already departed by `now` — history, never a
    // schedule edit to make.
    const pastWednesday = result.trips.find(
      (trip) =>
        trip.startsAt < now &&
        trip.seriesOccurrenceDate &&
        calendarDateWeekday(trip.seriesOccurrenceDate) === WED,
    );
    if (!pastWednesday) throw new Error("expected a departed Wednesday");

    await updateSeriesCadence(
      db,
      shop.id,
      result.series.id,
      { intervalWeeks: 1, weekdays: weekdaySetFrom([SAT]), endsOn: null },
      now,
    );
    const cancelled = await cancelOffCadenceSeriesTrips(db, {
      shopId: shop.id,
      seriesId: result.series.id,
      calledByPersonId: await ownerId(db, shop.id),
      now,
    });
    expect(cancelled.cancelled).toBeGreaterThan(0);
    expect(cancelled.skipped).toBe(0);
    expect(await listOffCadenceSeriesTrips(db, shop.id, result.series.id, now)).toEqual([]);
    expect((await getTripWithBooked(db, shop.id, pastWednesday.id))?.status).toBe("scheduled");
    // Cancelled, not deleted: every one is reinstatable from its own page.
    expect(await occurrenceDatesOf(db, result.series.id)).toContain(
      pastWednesday.seriesOccurrenceDate,
    );
  });
});
