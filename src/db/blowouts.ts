import { and, asc, count, countDistinct, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { cache } from "react";
import { parseBlowoutPreferences } from "@/lib/blowout-preferences";
import { nowDate } from "@/lib/clock";
import { dayBlowoutCallable, departureUnderway } from "@/lib/day-blowout";
import type { RecoveryEvent } from "@/lib/disruption-recovery";
import { log } from "@/lib/log";
import {
  type Notification,
  type NotificationProvider,
  publicAppUrl,
  recipientLocale,
} from "@/lib/notifications";
import type { CheckoutProvider } from "@/lib/payments/checkout";
import { publicSchedulePath, publicTripPath } from "@/lib/public-routes";
import { departureMayBeAtSea } from "./aboard-at-sea";
import { canPersonCallDayBlowout, canPersonRefund } from "./authz";
import {
  currentBlowoutOffers,
  listNonBoatOfferOptions,
  scopedNonBoatPreferenceIds,
  scopedWeatherCallTripIds,
} from "./blowout-alternatives";
import { bookingRecipient } from "./booking-address";
import { releasePackageCoverageForBooking } from "./bookings";
import { readCertificationEvidence } from "./certification-evidence";
import { listCourseSeatsInTraining } from "./certifications-in-training";
import type { AppDb, DbExecutor } from "./client";
import { flushUrgentCrewNotices } from "./crew-notices";
import { publishManifestEvent } from "./manifest-events";
import { sendAndRecordNotification } from "./notifications";
import { paymentsByBooking } from "./payments";
import { queryAll } from "./query-helpers";
import {
  queueBookingRefundOnShopCancellation,
  refundBookingOnShopCancellation,
  shopCancellationPaymentStory,
} from "./refunds";
import type { BlowoutCause, BlowoutMessageStatus, PaymentStatus } from "./schema";
import {
  bookingPayments,
  bookings,
  disruptionRecoveryEvents,
  people,
  shops,
  tripAssignments,
  tripBlowoutDivers,
  tripBlowouts,
  trips,
} from "./schema";
import { lockTripRevisionNotificationFence } from "./trip-revision-notification-fence";
import { liveTrip } from "./trips-live";
import { getTripRoster } from "./trips-manifest";
import { seatHeld, seatNotCancelled } from "./trips-queries";
import { getTripWithBooked, rollCallStartedOn, setTripStatus } from "./trips-record";

/**
 * The blow-out cascade (docs ADR 20260804-blowout-cascade, glossary
 * **Blow-out**): a shop-called weather cancellation of one departure, plus the
 * per-diver follow-through — one message each with the cancellation, their
 * money story, and the alternatives they qualify for — and the staff-readable
 * record of where every diver stands.
 *
 * **Send once, resume always.** The cascade is two phases. Phase one is a
 * transaction: cancel the trip through the same `setTripStatus` the plain
 * cancel uses, create the blow-out record, and snapshot every active booking
 * into a `pending` diver row. Phase two walks the pending rows *outside* the
 * transaction, sending one message per row and settling each row's status as
 * it goes. A crash, a timeout, or a provider failure mid-walk leaves the
 * unsent rows `pending` — calling the blow-out again picks up exactly those
 * rows and no others, and the notification's idempotency key (the diver row's
 * own id) means even a racing double-tap converges on one send per diver.
 *
 * **Money moves here, in phase two.** Each claimed row is refunded before its
 * message is composed, through `refundBookingOnShopCancellation` — the same
 * Stripe path as a diver-initiated cancel with the window/forfeit arithmetic
 * removed, because a window is a rule about a diver changing their mind and the
 * shop just cancelled the trip (ADR 20260813-shop-cancellation-refunds-itself).
 * The message then says what actually happened rather than that the money is
 * safe. A counter payment or a disconnected account still lands on the staff
 * path behind the H-20260724-staff-role-reach refund role, and the diver is told that in as many
 * words. Refunding inside the claim keeps it once-per-diver, and a booking that
 * already reads `refunded` is a no-op, so a resume never reverses twice.
 */

export type CallBlowoutOutcome =
  | {
      ok: true;
      blowoutId: string;
      /** True when the blow-out already existed and this call only resumed the sends. */
      resumed: boolean;
      /** Divers in the cascade, however their messages settled. */
      total: number;
      sent: number;
      /** Handed to the durable retry queue — it owns these sends now. */
      queued: number;
      failed: number;
      noEmail: number;
    }
  | {
      ok: false;
      /**
       * `trip_departed`: underway — past its start time or boarding begun
       * (`departureUnderway`). `failed`: a day call's setup for this departure
       * threw; it was not cancelled (`callDayBlowout`).
       */
      reason: "not_found" | "trip_departed" | "failed" | "invalid_alternatives";
    };

/**
 * What happens to the money when a call-off cancels paid seats (H-20261013-call-off-queues-refunds).
 * `release` sends the card captures back at once; `queue` leaves them captured
 * for a refund holder to release, because the person who called it off may not
 * move money (`canRefund`, H-20260724-staff-role-reach). A system caller (the head-count sweep) is
 * never a person with a role and releases.
 */
export type BlowoutRefundMode = "release" | "queue";

export type CallBlowoutInput = {
  shopId: string;
  tripId: string;
  calledByPersonId: string;
  now?: Date;
  /**
   * Why it is off, which is what each diver is told. Weather unless said
   * otherwise; a repeating trip's "Cancel every upcoming date" passes
   * `run_ended` (`cancelFutureSeriesTrips`). Read when the record is created,
   * and when a reinstated trip is called off again; a resume of a trip still
   * cancelled keeps the cause the call was made with.
   */
  cause?: BlowoutCause;
  /** Whether the refunds go back now or wait for a refund holder. Release unless said. */
  preferredAlternativeTripIds?: readonly string[];
  refunds?: BlowoutRefundMode;
  /** Injectable for tests; defaults to the environment-configured provider. */
  provider?: NotificationProvider;
  /** Injectable for tests; defaults to the environment-configured Stripe seam. */
  checkout?: CheckoutProvider;
};

export async function callTripBlowout(
  db: AppDb,
  input: CallBlowoutInput,
): Promise<CallBlowoutOutcome> {
  const selected = parseBlowoutPreferences(input.preferredAlternativeTripIds ?? []);
  if (!selected) return { ok: false, reason: "invalid_alternatives" };
  const now = input.now ?? nowDate();
  const setup = await setUpTripBlowout(db, input, now);
  if (!setup.ok) return setup;
  const outcome = await finishTripBlowout(db, input, setup, now);
  // Its crew hear it is off now (ADR 20261009-crew-hear-about-their-boats).
  await flushUrgentCrewNotices(db, { shopId: input.shopId, tripIds: [input.tripId], now });
  return outcome;
}

type BlowoutSetup = Extract<Awaited<ReturnType<typeof setUpTripBlowout>>, { ok: true }>;

/**
 * Phase one: the durable facts (trip canceled, blow-out recorded, roster
 * snapshotted) land together or not at all.
 */
async function setUpTripBlowout(
  db: AppDb,
  input: CallBlowoutInput,
  now: Date,
  alsoCalled: readonly string[] = [],
) {
  return db.transaction(async (tx) => {
    // Match reschedule dispatch ordering: fence before taking the trip row.
    await lockTripRevisionNotificationFence(tx, input.shopId, input.tripId, "revision-write");
    const [trip] = await tx
      .select()
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
      .limit(1)
      .for("update");
    if (!trip) return { ok: false as const, reason: "not_found" as const };

    const [existing] = await tx
      .select({
        id: tripBlowouts.id,
        cause: tripBlowouts.cause,
        preferredAlternativeTripIds: tripBlowouts.preferredAlternativeTripIds,
        sameCallTripIds: tripBlowouts.sameCallTripIds,
      })
      .from(tripBlowouts)
      .where(and(eq(tripBlowouts.tripId, input.tripId), eq(tripBlowouts.shopId, input.shopId)))
      .limit(1);

    // **A boat that may be on the water is never called off** (dive-domain
    // review, 2026-10-09): from its start time, or from the first boarding or
    // roll-call event, it is underway (`departureUnderway`) — cancelling it then
    // would hand roll call a cancelled trip with people aboard. An *existing*
    // cascade may still be resumed afterwards: its messages are about a
    // cancellation that already happened. A *scheduled* trip with a record is
    // not a resume but a fresh call — it was blown out, then reinstated — so
    // it is asked the same question (security review D2, 2026-10-12).
    const freshCall = !existing || trip.status === "scheduled";
    if (freshCall) {
      const [started] = await tx
        // The id as a value, not the column: in a single-table select the
        // column renders unqualified and would bind inside the subquery.
        .select({ started: rollCallStartedOn(trip.id) })
        .from(trips)
        .where(and(eq(trips.id, trip.id), liveTrip()));
      // The crew may also have taken the boat out before its time, or hold a
      // diver aboard (`departureMayBeAtSea`, H-20261015-aboard-diver-removal-at): the stricter of the two.
      if (
        departureUnderway(
          { startsAt: trip.startsAt, rollCallStarted: Boolean(started?.started) },
          now,
        ) ||
        (await departureMayBeAtSea(tx, {
          shopId: input.shopId,
          tripId: input.tripId,
          startsAt: trip.startsAt,
          now,
        }))
      ) {
        return { ok: false as const, reason: "trip_departed" as const };
      }
    }

    let blowoutId = existing?.id;
    // A recorded call keeps its original preference intent, even when resumed with different form data.
    const preferredAlternativeTripIds =
      existing?.preferredAlternativeTripIds ??
      (await scopedNonBoatPreferenceIds(tx, input.shopId, input.preferredAlternativeTripIds ?? [], [
        input.tripId,
        ...alsoCalled,
      ]));
    if (preferredAlternativeTripIds === null)
      return { ok: false as const, reason: "invalid_alternatives" as const };
    const sameCallTripIds =
      existing?.sameCallTripIds ?? (await scopedWeatherCallTripIds(tx, input.shopId, alsoCalled));
    if (trip.status === "scheduled") {
      await setTripStatus(tx, input.shopId, input.tripId, "cancelled", now, {
        actorPersonId: input.calledByPersonId,
      });
    }

    // A resume keeps the cause the call was made with; a fresh call on a
    // reinstated date says why it is off *now* (a run cancel after an old
    // weather call is `run_ended`, never the weather).
    const cause: BlowoutCause =
      existing && !freshCall ? existing.cause : (input.cause ?? "weather");
    if (existing && freshCall && existing.cause !== cause) {
      await tx.update(tripBlowouts).set({ cause }).where(eq(tripBlowouts.id, existing.id));
    }
    if (!blowoutId) {
      const [created] = await tx
        .insert(tripBlowouts)
        .values({
          shopId: input.shopId,
          tripId: input.tripId,
          calledByPersonId: input.calledByPersonId,
          calledAt: now,
          cause,
          preferredAlternativeTripIds,
          sameCallTripIds,
        })
        .returning({ id: tripBlowouts.id });
      blowoutId = created.id;
    }

    // Snapshot every seat the cancellation strands. `onConflictDoNothing`
    // over the booking-unique index makes a resume additive-only: rows that
    // already settled keep their status, and a booking seated between call
    // and resume (staff undo, walk-in on the cancelled trip) joins the list.
    const active = await tx
      .select({ bookingId: bookings.id, personId: bookings.personId })
      .from(bookings)
      .where(
        and(eq(bookings.tripId, input.tripId), eq(bookings.shopId, input.shopId), seatNotCancelled),
      );
    if (active.length > 0) {
      for (const row of active) {
        await releasePackageCoverageForBooking(tx, input.shopId, row.bookingId);
      }
      await tx
        .insert(tripBlowoutDivers)
        .values(
          active.map((row) => ({
            shopId: input.shopId,
            blowoutId: blowoutId as string,
            bookingId: row.bookingId,
            personId: row.personId,
          })),
        )
        .onConflictDoNothing({ target: tripBlowoutDivers.bookingId });
    }

    return {
      ok: true as const,
      blowoutId,
      trip,
      cause,
      preferredAlternativeTripIds,
      sameCallTripIds,
      resumed: !freshCall,
    };
  });
}

/**
 * Phase two: work the pending rows. Everything here is resumable — no failure
 * past phase one can undo the cancellation or the record.
 *
 * `alsoCalled` names the sister departures a day call is canceling in the same
 * act, which no diver may be offered as an alternative. They are already
 * canceled by the time this runs (`callDayBlowout` sets every one up first),
 * so the scheduled-only candidate read drops them anyway; naming them is the
 * rule said where it is relied on, not a second guess at it.
 */
async function finishTripBlowout(
  db: AppDb,
  input: CallBlowoutInput,
  setup: BlowoutSetup,
  now: Date,
  alsoCalled: readonly string[] = [],
): Promise<CallBlowoutOutcome> {
  const summary = await sendPendingBlowoutMessages(db, {
    shopId: input.shopId,
    blowoutId: setup.blowoutId,
    trip: setup.trip,
    cause: setup.cause,
    preferredAlternativeTripIds: setup.preferredAlternativeTripIds,
    now,
    provider: input.provider,
    checkout: input.checkout,
    refunds: input.refunds,
    alsoCalled: [...new Set([...setup.sameCallTripIds, ...alsoCalled])],
  });

  const [{ total }] = await db
    .select({ total: count() })
    .from(tripBlowoutDivers)
    .where(eq(tripBlowoutDivers.blowoutId, setup.blowoutId));

  // The departure was just cancelled — the largest manifest change there is,
  // and the one a captain most needs off their phone rather than from a
  // colleague at the dock (ADR 20260804-manifest-web-push). After both phases,
  // so a device that refreshes on this signal reads a trip already marked
  // cancelled rather than one mid-cascade.
  await publishManifestEvent(db, input.shopId, input.tripId);

  return { ok: true, blowoutId: setup.blowoutId, resumed: setup.resumed, total, ...summary };
}

export type DayBlowoutInput = Omit<CallBlowoutInput, "tripId"> & { tripIds: readonly string[] };

/** One departure's answer inside a day call, in the order it was asked for. */
export type DayBlowoutResult = { tripId: string; outcome: CallBlowoutOutcome };

/**
 * **One weather call for several departures** (ADR 20261009-day-weather-call).
 *
 * Each departure goes through exactly the single-trip blow-out — its own
 * transaction, its own record, its own refunds and messages — so a day call
 * can never behave differently from five calls in a row. What it adds is the
 * order: **every departure is set up (canceled) before any message is
 * written**, so no diver on the 08:00 boat is offered the 10:30 one that the
 * same call is about to cancel. A departure that cannot be called (underway,
 * not this shop's) is answered for and the others go ahead.
 *
 * **Nothing set up is ever stranded** (security review M1): each departure's
 * setup and each one's send run in their own `try`, so one that throws is
 * answered `failed` and every departure that *was* canceled still has its
 * refunds and messages worked. A send that throws part-way leaves its rows
 * `pending`/`failed` for the cascade's own resume, which the day page shows.
 */
export async function callDayBlowout(
  db: AppDb,
  input: DayBlowoutInput,
): Promise<DayBlowoutResult[]> {
  const selected = parseBlowoutPreferences(input.preferredAlternativeTripIds ?? []);
  if (!selected)
    return input.tripIds.map((tripId) => ({
      tripId,
      outcome: { ok: false, reason: "invalid_alternatives" },
    }));
  const now = input.now ?? nowDate();
  const tripIds = [...new Set(input.tripIds)];
  const setups: { tripId: string; setup: Awaited<ReturnType<typeof setUpTripBlowout>> | null }[] =
    [];
  for (const tripId of tripIds) {
    try {
      setups.push({
        tripId,
        setup: await setUpTripBlowout(db, { ...input, tripId }, now, tripIds),
      });
    } catch (error) {
      log("blowout.day_setup_failed", "error", {
        tripId,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
      setups.push({ tripId, setup: null });
    }
  }
  const called = setups.flatMap((row) => (row.setup?.ok ? [row.tripId] : []));
  const results: DayBlowoutResult[] = [];
  for (const { tripId, setup } of setups) {
    if (!setup) {
      results.push({ tripId, outcome: { ok: false, reason: "failed" } });
      continue;
    }
    if (!setup.ok) {
      results.push({ tripId, outcome: setup });
      continue;
    }
    try {
      results.push({
        tripId,
        outcome: await finishTripBlowout(db, { ...input, tripId }, setup, now, tripIds),
      });
    } catch (error) {
      // Canceled and recorded; its unsent rows are the cascade's to resume.
      log("blowout.day_finish_failed", "error", {
        tripId,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
      results.push({
        tripId,
        outcome: {
          ok: true,
          blowoutId: setup.blowoutId,
          resumed: setup.resumed,
          total: 0,
          sent: 0,
          queued: 0,
          failed: 0,
          noEmail: 0,
        },
      });
    }
  }
  // The crews of every boat called off hear it now, in one message each.
  await flushUrgentCrewNotices(db, { shopId: input.shopId, tripIds: called, now });
  return results;
}

/** The day review reads its departures and optional offers through one surface reader. */
export async function getDayBlowoutPage(
  db: AppDb,
  shopId: string,
  input: {
    bounds: { from: Date; to: Date };
    submitted: readonly string[];
    reviewing: boolean;
    now: Date;
  },
) {
  const departures = await listDayBlowoutDepartures(db, shopId, input.bounds);
  const reviewed = input.reviewing
    ? dayBlowoutCallable(departures, input.submitted, input.now).callable
    : [];
  const nonBoatOffers = reviewed.length
    ? await listNonBoatOfferOptions(db, shopId, input.now, reviewed)
    : [];
  return { departures, nonBoatOffers };
}

/** One departure of a shop day, as the day call's page lists it. */
export type DayBlowoutDepartureRow = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  status: "scheduled" | "cancelled";
  /** Seats held by anybody (divers, snorkelers, riders), canceled ones excluded. */
  booked: number;
  calledOff: boolean;
  /** Anybody has a boarding or roll-call event on it: it is underway. */
  rollCallStarted: boolean;
  /** A called departure's diver messages still pending, sending or failed: resume it. */
  unsent: number;
  /** Who is crewing it, by name. */
  crew: string[];
};

/** Every live departure leaving inside `[from, to)`, with who is on it. */
export async function listDayBlowoutDepartures(
  db: DbExecutor,
  shopId: string,
  bounds: { from: Date; to: Date },
): Promise<DayBlowoutDepartureRow[]> {
  const rows = await db
    .select({
      id: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      status: trips.status,
      booked: count(bookings.id),
      calledOff:
        sql<boolean>`exists (select 1 from ${tripBlowouts} where ${tripBlowouts.tripId} = ${trips.id} and ${tripBlowouts.shopId} = ${shopId})`.mapWith(
          Boolean,
        ),
      rollCallStarted: rollCallStartedOn(trips.id),
      unsent:
        sql<number>`(select count(*) from ${tripBlowoutDivers} inner join ${tripBlowouts} on ${tripBlowouts.id} = ${tripBlowoutDivers.blowoutId} where ${tripBlowouts.tripId} = ${trips.id} and ${tripBlowouts.shopId} = ${shopId} and ${tripBlowoutDivers.messageStatus} in ('pending', 'sending', 'failed'))`.mapWith(
          Number,
        ),
    })
    .from(trips)
    .leftJoin(
      bookings,
      and(eq(bookings.tripId, trips.id), eq(bookings.shopId, shopId), seatNotCancelled),
    )
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        gte(trips.startsAt, bounds.from),
        lt(trips.startsAt, bounds.to),
      ),
    )
    .groupBy(trips.id)
    .orderBy(asc(trips.startsAt), asc(trips.title), asc(trips.id));
  if (rows.length === 0) return [];
  const crewRows = await db
    .select({ tripId: tripAssignments.tripId, fullName: people.fullName })
    .from(tripAssignments)
    .innerJoin(people, eq(people.id, tripAssignments.personId))
    .where(
      and(
        eq(people.shopId, shopId),
        inArray(
          tripAssignments.tripId,
          rows.map((row) => row.id),
        ),
      ),
    )
    .orderBy(asc(people.fullName), asc(people.id));
  return rows.map((row) => ({
    ...row,
    crew: crewRows.filter((crew) => crew.tripId === row.id).map((crew) => crew.fullName),
  }));
}

type SendSummary = { sent: number; queued: number; failed: number; noEmail: number };

/**
 * Walk this blow-out's `pending` rows and send each diver their one message.
 * Per-row failures are contained: an exception settles nothing (the row stays
 * `pending` for the next resume) and never stops the rest of the roster.
 */
async function sendPendingBlowoutMessages(
  db: AppDb,
  input: {
    shopId: string;
    blowoutId: string;
    trip: typeof trips.$inferSelect;
    cause: BlowoutCause;
    preferredAlternativeTripIds: readonly string[];
    now: Date;
    provider?: NotificationProvider;
    checkout?: CheckoutProvider;
    refunds?: BlowoutRefundMode;
    /** Sister departures canceled by the same day call; never offered. */
    alsoCalled?: readonly string[];
  },
): Promise<SendSummary> {
  const summary: SendSummary = { sent: 0, queued: 0, failed: 0, noEmail: 0 };
  const pending = await db
    .select({ diver: tripBlowoutDivers, person: bookingRecipient, booking: bookings })
    .from(tripBlowoutDivers)
    .innerJoin(people, eq(people.id, tripBlowoutDivers.personId))
    .innerJoin(bookings, eq(bookings.id, tripBlowoutDivers.bookingId))
    .where(
      and(
        eq(tripBlowoutDivers.blowoutId, input.blowoutId),
        eq(tripBlowoutDivers.shopId, input.shopId),
        eq(tripBlowoutDivers.messageStatus, "pending"),
      ),
    );
  if (pending.length === 0) return summary;

  const [shop] = await db.select().from(shops).where(eq(shops.id, input.shopId)).limit(1);
  const origin = publicAppUrl();
  if (!shop || !origin) {
    // No shop row (impossible in practice) or no public origin to build
    // booking links from: nothing can be sent, and marking rows failed would
    // hide that this is a configuration problem, not a delivery one. Leave
    // everything pending for a resume once APP_HOST is set.
    summary.failed = pending.length;
    return summary;
  }

  for (const row of pending) {
    // Claim the row before doing anything with it: pending → sending,
    // conditionally. A concurrent second call ("did you call it?" — "I'll
    // call it") selects the same pending rows, but only one caller wins each
    // claim, so no diver's message is ever handed to the provider twice by
    // two live passes.
    const [claimed] = await db
      .update(tripBlowoutDivers)
      .set({ messageStatus: "sending" })
      .where(
        and(eq(tripBlowoutDivers.id, row.diver.id), eq(tripBlowoutDivers.messageStatus, "pending")),
      )
      .returning({ id: tripBlowoutDivers.id });
    if (!claimed) continue;
    try {
      // Money first, then the message that describes it. Inside the claim, so
      // one diver is refunded once; a booking already `refunded` reads back as
      // `unpaid` and no second reversal is attempted, which is what makes a
      // resume safe (ADR 20260813-shop-cancellation-refunds-itself).
      const refund =
        input.refunds === "queue"
          ? await queueBookingRefundOnShopCancellation(db, {
              shopId: input.shopId,
              bookingId: row.diver.bookingId,
            })
          : await refundBookingOnShopCancellation(
              db,
              { shopId: input.shopId, bookingId: row.diver.bookingId },
              input.checkout,
            );
      // The diver's other active seats — never offer a boat they're already on.
      const activeSeats = await db
        .select({ tripId: bookings.tripId })
        .from(bookings)
        .where(
          and(
            eq(bookings.shopId, input.shopId),
            eq(bookings.personId, row.diver.personId),
            seatNotCancelled,
          ),
        );
      const [evidence, courseSeats] = await queryAll(db, [
        // The same rows the booking gate reads.
        () => readCertificationEvidence(db, input.shopId, row.diver.personId),
        () => listCourseSeatsInTraining(db, input.shopId, [row.diver.personId]),
      ]);
      const offers = await currentBlowoutOffers(db, {
        shopId: input.shopId,
        tripId: input.trip.id,
        now: input.now,
        preferredTripIds: input.preferredAlternativeTripIds,
        alsoCalled: input.alsoCalled ?? [],
        diver: {
          evidence,
          identityUnconfirmed: row.booking.identityUnconfirmedAt !== null,
          bookedTripIds: activeSeats.map((seat) => seat.tripId),
          participantType: row.booking.participantType,
          courseSeats,
        },
      });
      const offeredTripIds = offers.map((offer) => offer.id);

      if (!row.person.email) {
        await db
          .update(tripBlowoutDivers)
          .set({ messageStatus: "no_email", offeredTripIds })
          .where(eq(tripBlowoutDivers.id, row.diver.id));
        summary.noEmail += 1;
        continue;
      }

      const notification: Notification = {
        kind: "trip_blowout",
        blowoutDiverId: row.diver.id,
        bookingId: row.diver.bookingId,
        shopId: input.shopId,
        to: row.person.email,
        // The diver reads this, so their own recorded locale outranks the
        // shop's default (docs ADR 20260731-per-person-notification-locale).
        locale: recipientLocale(row.person.locale, shop.defaultLocale),
        diverName: row.person.fullName,
        shopName: shop.name,
        tripTitle: input.trip.title,
        startsAt: input.trip.startsAt,
        timezone: shop.timezone,
        cause: input.cause,
        paymentStory: shopCancellationPaymentStory(refund),
        alternatives: offers.map((offer) => ({
          title: offer.title,
          startsAt: offer.startsAt,
          bookingUrl: new URL(publicTripPath(shop.slug, offer.id), `${origin}/`).toString(),
        })),
        scheduleUrl: new URL(publicSchedulePath(shop.slug), `${origin}/`).toString(),
      };

      const delivery = await sendAndRecordNotification(db, notification, {
        provider: input.provider,
      });
      // How each outcome settles the row: `sent` is done; a retryable failure
      // is `queued` — the durable retry queue owns it now, and a resume must
      // not race it with a second direct send; anything else is `failed`,
      // which a resume retries.
      const messageStatus: BlowoutMessageStatus =
        delivery.status === "sent"
          ? "sent"
          : delivery.status === "failed" && delivery.retryable
            ? "queued"
            : "failed";
      await db
        .update(tripBlowoutDivers)
        .set({
          messageStatus,
          offeredTripIds,
          notifiedAt: delivery.status === "sent" ? input.now : null,
        })
        .where(eq(tripBlowoutDivers.id, row.diver.id));
      if (messageStatus === "sent") summary.sent += 1;
      else if (messageStatus === "queued") summary.queued += 1;
      else summary.failed += 1;
    } catch (error) {
      // Settle the claimed row as failed so the surface shows it honestly and
      // "Retry unsent messages" picks it up. If even this write fails the row
      // stays `sending`, which resume also reclaims.
      log("blowout.message_failed", "error", {
        blowoutDiverId: row.diver.id,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
      try {
        await db
          .update(tripBlowoutDivers)
          .set({ messageStatus: "failed" })
          .where(eq(tripBlowoutDivers.id, row.diver.id));
      } catch {
        // Leave it `sending`; resume reclaims it.
      }
      summary.failed += 1;
    }
  }
  return summary;
}

/**
 * Retry the rows a previous pass left `failed` — and reclaim `sending` rows a
 * *crashed* pass abandoned mid-claim — by flipping them back to `pending`,
 * then walking the pending set as usual. Never touches `sent` or `queued`
 * rows. This is the staff "resend" affordance on the cascade surface; the
 * `sending` reclaim makes a crash-abandoned diver reachable again at the cost
 * of an at-most-once-per-retry duplicate if the crashed pass had in fact
 * handed the message to the provider before dying — a duplicate informational
 * email, weighed against a diver never told their trip was cancelled.
 */
export async function resumeTripBlowout(
  db: AppDb,
  input: CallBlowoutInput,
): Promise<CallBlowoutOutcome> {
  await db
    .update(tripBlowoutDivers)
    .set({ messageStatus: "pending" })
    .where(
      and(
        eq(tripBlowoutDivers.shopId, input.shopId),
        inArray(tripBlowoutDivers.messageStatus, ["failed", "sending"]),
        inArray(
          tripBlowoutDivers.blowoutId,
          db
            .select({ id: tripBlowouts.id })
            .from(tripBlowouts)
            .where(
              and(eq(tripBlowouts.tripId, input.tripId), eq(tripBlowouts.shopId, input.shopId)),
            ),
        ),
      ),
    );
  return callTripBlowout(db, input);
}

export type BlowoutDiverState = {
  id: string;
  bookingId: string;
  personId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  messageStatus: BlowoutMessageStatus;
  notifiedAt: Date | null;
  paymentStatus: PaymentStatus | null;
  /** The alternatives this diver's message carried, resolved to display facts. */
  offeredTrips: { id: string; title: string; startsAt: Date }[];
  /** Explicitly linked recovery booking, still active on an upcoming departure. */
  rebooked: boolean;
  recoveryEvents: RecoveryEvent[];
  recoveryBookings: { id: string; title: string; startsAt: Date }[];
  recoveryActors: Record<string, string>;
  replacementBookingId: string | null;
  canRecordRecovery: boolean;
};

export type TripBlowoutRecord = {
  id: string;
  calledAt: Date;
  cause: BlowoutCause;
  calledByName: string | null;
  divers: BlowoutDiverState[];
};

/**
 * The cascade record a staff surface renders: who was in the blast, what each
 * diver's message did, their money position, and — live, not snapshotted —
 * whether staff explicitly linked an existing replacement booking. Delivery,
 * payment and recovery remain separate facts; unrelated seats resolve nothing.
 */
export async function getTripBlowout(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  now = nowDate(),
): Promise<TripBlowoutRecord | null> {
  const [blowout] = await db
    .select({ blowout: tripBlowouts, calledBy: people })
    .from(tripBlowouts)
    .leftJoin(people, eq(people.id, tripBlowouts.calledByPersonId))
    .where(and(eq(tripBlowouts.tripId, tripId), eq(tripBlowouts.shopId, shopId)))
    .limit(1);
  if (!blowout) return null;

  const rows = await db
    .select({ diver: tripBlowoutDivers, person: people, source: bookings })
    .from(tripBlowoutDivers)
    .innerJoin(people, and(eq(people.id, tripBlowoutDivers.personId), eq(people.shopId, shopId)))
    .innerJoin(
      bookings,
      and(eq(bookings.id, tripBlowoutDivers.bookingId), eq(bookings.shopId, shopId)),
    )
    .where(
      and(
        eq(tripBlowoutDivers.blowoutId, blowout.blowout.id),
        eq(tripBlowoutDivers.shopId, shopId),
      ),
    )
    .orderBy(people.fullName);

  const offeredIds = [...new Set(rows.flatMap((row) => row.diver.offeredTripIds))];
  const offeredTrips = offeredIds.length
    ? await db
        .select({ id: trips.id, title: trips.title, startsAt: trips.startsAt })
        .from(trips)
        .where(and(eq(trips.shopId, shopId), inArray(trips.id, offeredIds), liveTrip()))
    : [];
  const offeredById = new Map(offeredTrips.map((trip) => [trip.id, trip]));

  const personIds = rows.map((row) => row.diver.personId);
  const recoveryBookings = personIds.length
    ? await db
        .select({
          id: bookings.id,
          personId: bookings.personId,
          title: trips.title,
          startsAt: trips.startsAt,
        })
        .from(bookings)
        .innerJoin(trips, eq(trips.id, bookings.tripId))
        .where(
          and(
            eq(bookings.shopId, shopId),
            eq(trips.shopId, shopId),
            inArray(bookings.personId, personIds),
            seatHeld,
            isNull(bookings.identityUnconfirmedAt),
            ne(trips.id, tripId),
            eq(trips.status, "scheduled"),
            liveTrip(),
          ),
        )
        .orderBy(asc(trips.startsAt), asc(trips.title), asc(bookings.id))
    : [];
  const recoveryEvents = rows.length
    ? (
        await db
          .select()
          .from(disruptionRecoveryEvents)
          .where(
            and(
              eq(disruptionRecoveryEvents.shopId, shopId),
              inArray(
                disruptionRecoveryEvents.blowoutDiverId,
                rows.map((row) => row.diver.id),
              ),
            ),
          )
          .orderBy(asc(disruptionRecoveryEvents.seq))
      ).map((event) => ({
        ...event,
        attemptId: event.id,
        recordedAt: event.recordedAt.toISOString(),
      }))
    : [];
  const eventsFor = (id: string) => recoveryEvents.filter((event) => event.blowoutDiverId === id);
  const actorIds = [...new Set(recoveryEvents.map((event) => event.actorPersonId))];
  const actors = actorIds.length
    ? await db
        .select({ id: people.id, name: people.fullName })
        .from(people)
        // diveday:allow-deleted-people: audit actors resolve live, including the anonymized name after erasure.
        .where(and(eq(people.shopId, shopId), inArray(people.id, actorIds)))
    : [];
  const recoveryActors = Object.fromEntries(actors.map((actor) => [actor.id, actor.name]));
  const payments = await paymentsByBooking(
    db,
    shopId,
    rows.map((row) => row.diver.bookingId),
  );

  return {
    id: blowout.blowout.id,
    calledAt: blowout.blowout.calledAt,
    cause: blowout.blowout.cause,
    calledByName: blowout.calledBy?.fullName ?? null,
    divers: rows.map((row) => ({
      id: row.diver.id,
      bookingId: row.diver.bookingId,
      personId: row.diver.personId,
      fullName: row.person.fullName,
      email: row.person.email,
      phone: row.person.phone,
      messageStatus: row.diver.messageStatus,
      notifiedAt: row.diver.notifiedAt,
      paymentStatus: payments.get(row.diver.bookingId)?.status ?? null,
      offeredTrips: row.diver.offeredTripIds.flatMap((id) => {
        const trip = offeredById.get(id);
        return trip ? [trip] : [];
      }),
      recoveryEvents: eventsFor(row.diver.id),
      recoveryBookings: recoveryBookings.filter(
        (booking) =>
          booking.personId === row.diver.personId &&
          booking.startsAt > now &&
          row.source.personId === row.diver.personId &&
          row.source.identityUnconfirmedAt === null &&
          row.person.deletedAt === null,
      ),
      recoveryActors,
      replacementBookingId: eventsFor(row.diver.id).at(-1)?.replacementBookingId ?? null,
      canRecordRecovery: row.person.deletedAt === null,
      rebooked:
        row.person.deletedAt === null &&
        row.source.personId === row.diver.personId &&
        row.source.identityUnconfirmedAt === null &&
        eventsFor(row.diver.id).at(-1)?.outcome === "rebooked" &&
        recoveryBookings.some(
          (booking) =>
            booking.id === eventsFor(row.diver.id).at(-1)?.replacementBookingId &&
            booking.personId === row.diver.personId,
        ),
    })),
  };
}

/**
 * Why this trip's cascade was called, or null when it has none — the trip
 * page's link cue, and the word on it.
 */
export async function tripBlowoutCause(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<BlowoutCause | null> {
  const [row] = await db
    .select({ cause: tripBlowouts.cause })
    .from(tripBlowouts)
    .where(and(eq(tripBlowouts.tripId, tripId), eq(tripBlowouts.shopId, shopId)))
    .limit(1);
  return row?.cause ?? null;
}

/** What the weather called off in a window, for Reports (fifth loop, item 27). */
export type WeatherCalls = {
  /** Departures the weather called off. */
  departures: number;
  /** Shop-local days with at least one of them. */
  days: number;
  /** Divers who held a seat on them when the call was made. */
  divers: number;
  /** What went back to those divers' cards, in minor units. */
  refundedCents: number;
  /** Of those divers, how many booked another departure after the call. */
  moved: number;
};

/**
 * **The weather's share of a month or a year** (fifth loop, item 27): every
 * blow-out whose cause is the weather (`run_ended` is a schedule decision, not
 * a weather day) on a departure that was due to leave in `[startUtc, endUtc)`,
 * anchored like every other Reports figure to the departure, not to the call.
 *
 * Only departures still called off count: one reinstated and sailed is not
 * the weather's (dive-domain review F2). `days` is shop-local days with at
 * least one weather call, not days the whole fleet stayed in (N4: the words
 * say "days with a weather call").
 *
 * Divers are the cascade's own snapshot (`trip_blowout_divers`), so a booking
 * cancelled by the call still counts. "Refunded" is the money now standing as
 * refunded on those seats; "moved" is a diver who holds a live seat on
 * another departure with the shop, booked within 30 days of the call (N3), so
 * next season's booking is not this call's make-up dive. A walk-up who comes
 * back gets a fresh person row and is not counted: an undercount.
 */
export async function weatherCallsInWindow(
  db: DbExecutor,
  shopId: string,
  window: { startUtc: Date; endUtc: Date; timeZone: string },
): Promise<WeatherCalls> {
  const called = and(
    eq(tripBlowouts.shopId, shopId),
    eq(tripBlowouts.cause, "weather"),
    eq(trips.shopId, shopId),
    // A call the shop took back and sailed keeps its blow-out row; it was not
    // a departure the weather took (dive-domain review F2).
    eq(trips.status, "cancelled"),
    gte(trips.startsAt, window.startUtc),
    lt(trips.startsAt, window.endUtc),
  );
  const [departureRows, diverRows, refundRows, movedRows] = await queryAll(db, [
    () =>
      db
        .select({
          departures: count(tripBlowouts.id),
          days: sql<number>`count(distinct to_char(${trips.startsAt} at time zone ${window.timeZone}::text, 'YYYY-MM-DD'))`,
        })
        .from(tripBlowouts)
        .innerJoin(trips, eq(trips.id, tripBlowouts.tripId))
        .where(and(called, liveTrip())),
    () =>
      db
        .select({ divers: count(tripBlowoutDivers.id) })
        .from(tripBlowoutDivers)
        .innerJoin(tripBlowouts, eq(tripBlowouts.id, tripBlowoutDivers.blowoutId))
        .innerJoin(trips, eq(trips.id, tripBlowouts.tripId))
        .where(and(called, liveTrip(), eq(tripBlowoutDivers.shopId, shopId))),
    () =>
      db
        .select({ cents: sql<string>`coalesce(sum(${bookingPayments.amountCents}), 0)` })
        .from(tripBlowoutDivers)
        .innerJoin(tripBlowouts, eq(tripBlowouts.id, tripBlowoutDivers.blowoutId))
        .innerJoin(trips, eq(trips.id, tripBlowouts.tripId))
        .innerJoin(
          bookingPayments,
          and(
            eq(bookingPayments.bookingId, tripBlowoutDivers.bookingId),
            eq(bookingPayments.shopId, shopId),
            eq(bookingPayments.status, "refunded"),
          ),
        )
        .where(and(called, liveTrip(), eq(tripBlowoutDivers.shopId, shopId))),
    () =>
      db
        .select({ moved: countDistinct(tripBlowoutDivers.id) })
        .from(tripBlowoutDivers)
        .innerJoin(tripBlowouts, eq(tripBlowouts.id, tripBlowoutDivers.blowoutId))
        .innerJoin(trips, eq(trips.id, tripBlowouts.tripId))
        .innerJoin(
          bookings,
          and(
            eq(bookings.personId, tripBlowoutDivers.personId),
            eq(bookings.shopId, shopId),
            ne(bookings.tripId, tripBlowouts.tripId),
            seatNotCancelled,
            gte(bookings.createdAt, tripBlowouts.calledAt),
            lt(bookings.createdAt, sql`${tripBlowouts.calledAt} + interval '30 days'`),
          ),
        )
        .where(and(called, liveTrip(), eq(tripBlowoutDivers.shopId, shopId))),
  ]);
  return {
    departures: Number(departureRows[0]?.departures ?? 0),
    days: Number(departureRows[0]?.days ?? 0),
    divers: Number(diverRows[0]?.divers ?? 0),
    refundedCents: Number(refundRows[0]?.cents ?? 0),
    moved: Number(movedRows[0]?.moved ?? 0),
  };
}

/** Who may call a whole day off: the day blow-out page's gate (`requireShopSurface`'s `allow`). */
export { canPersonCallDayBlowout } from "./authz";

/** One read per request: the blow-out page's tab title and its body ask for the same record. */
export const readTripBlowout = cache(getTripBlowout);

/**
 * **The blow-out page** in one call (issue #2757): the departure, its blow-out
 * record if one was called, and what this staffer may do there (call the whole
 * day off; release refunds). Before the call the page is the confirmation, so
 * only then is the roster read (empty after it). `null` when the departure is
 * not this shop's.
 */
export async function getBlowoutPage(db: AppDb, shopId: string, tripId: string, personId: string) {
  const [trip, blowout, callDay, refund] = await Promise.all([
    getTripWithBooked(db, shopId, tripId),
    readTripBlowout(db, shopId, tripId),
    canPersonCallDayBlowout(db, shopId, personId),
    canPersonRefund(db, shopId, personId),
  ]);
  if (!trip) return null;
  const [roster, nonBoatOffers] = blowout
    ? [[], []]
    : await Promise.all([
        getTripRoster(db, shopId, tripId),
        listNonBoatOfferOptions(db, shopId, nowDate(), [tripId]),
      ]);
  return { trip, blowout, roster, nonBoatOffers, can: { callDay, refund } };
}
