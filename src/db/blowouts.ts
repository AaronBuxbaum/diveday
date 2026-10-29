import {
  and,
  asc,
  count,
  countDistinct,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";
import {
  BLOWOUT_OFFER_HORIZON_DAYS,
  type BlowoutCandidateTrip,
  qualifyingAlternatives,
} from "@/lib/blowout";
import { nowDate } from "@/lib/clock";
import { departureUnderway } from "@/lib/day-blowout";
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
import { releasePackageCoverageForBooking } from "./bookings";
import { listCourseSeatsInTraining } from "./certifications-in-training";
import type { AppDb, DbExecutor } from "./client";
import { flushUrgentCrewNotices } from "./crew-notices";
import { publishManifestEvent } from "./manifest-events";
import { sendAndRecordNotification } from "./notifications";
import { paymentsByBooking } from "./payments";
import { queryAll } from "./query-helpers";
import { getTripRequirements, getTripSiteRequirement } from "./readiness";
import {
  queueBookingRefundOnShopCancellation,
  refundBookingOnShopCancellation,
  shopCancellationPaymentStory,
} from "./refunds";
import type { BlowoutCause, BlowoutMessageStatus, PaymentStatus } from "./schema";
import {
  bookingPayments,
  bookings,
  certifications,
  nitroxCertifications,
  people,
  shops,
  specialtyCertifications,
  tripAssignments,
  tripBlowoutDivers,
  tripBlowouts,
  trips,
} from "./schema";
import { lockTripRevisionNotificationFence } from "./trip-revision-notification-fence";
import { liveTrip } from "./trips-live";
import { tripSellableSeatsSql } from "./trips-queries";
import { rollCallStartedOn, setTripStatus } from "./trips-record";

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
 * path behind the H-14 refund role, and the diver is told that in as many
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
      reason: "not_found" | "trip_departed" | "failed";
    };

/**
 * What happens to the money when a call-off cancels paid seats (H-139).
 * `release` sends the card captures back at once; `queue` leaves them captured
 * for a refund holder to release, because the person who called it off may not
 * move money (`canRefund`, H-14). A system caller (the head-count sweep) is
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
async function setUpTripBlowout(db: AppDb, input: CallBlowoutInput, now: Date) {
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
      .select({ id: tripBlowouts.id, cause: tripBlowouts.cause })
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
      // diver aboard (`departureMayBeAtSea`, H-133): the stricter of the two.
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

    if (trip.status === "scheduled") {
      await setTripStatus(tx, input.shopId, input.tripId, "cancelled", now, {
        actorPersonId: input.calledByPersonId,
      });
    }

    let blowoutId = existing?.id;
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
        and(
          eq(bookings.tripId, input.tripId),
          eq(bookings.shopId, input.shopId),
          ne(bookings.status, "cancelled"),
        ),
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

    return { ok: true as const, blowoutId, trip, cause, resumed: !freshCall };
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
    now,
    provider: input.provider,
    checkout: input.checkout,
    refunds: input.refunds,
    alsoCalled,
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
  const now = input.now ?? nowDate();
  const tripIds = [...new Set(input.tripIds)];
  const setups: { tripId: string; setup: Awaited<ReturnType<typeof setUpTripBlowout>> | null }[] =
    [];
  for (const tripId of tripIds) {
    try {
      setups.push({ tripId, setup: await setUpTripBlowout(db, { ...input, tripId }, now) });
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
        outcome: await finishTripBlowout(db, { ...input, tripId }, setup, now, called),
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
      and(
        eq(bookings.tripId, trips.id),
        eq(bookings.shopId, shopId),
        ne(bookings.status, "cancelled"),
      ),
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

/** One diver's cert evidence at this shop — the same rows the booking gate reads. */
async function certificationEvidence(db: DbExecutor, shopId: string, personId: string) {
  const [certificationRows, specialtyRows, nitroxRows] = await queryAll(db, [
    () =>
      db
        .select()
        .from(certifications)
        .where(
          and(
            eq(certifications.shopId, shopId),
            eq(certifications.personId, personId),
            isNull(certifications.deletedAt),
          ),
        ),
    () =>
      db
        .select()
        .from(specialtyCertifications)
        .where(
          and(
            eq(specialtyCertifications.shopId, shopId),
            eq(specialtyCertifications.personId, personId),
            isNull(specialtyCertifications.deletedAt),
          ),
        ),
    () =>
      db
        .select()
        .from(nitroxCertifications)
        .where(
          and(
            eq(nitroxCertifications.shopId, shopId),
            eq(nitroxCertifications.personId, personId),
            isNull(nitroxCertifications.deletedAt),
          ),
        ),
  ]);
  return {
    certifications: certificationRows,
    specialtyCertifications: specialtyRows,
    nitroxCertifications: nitroxRows,
  };
}

/**
 * Every departure the cascade could offer, with the requirement data the pure
 * filter needs. Gathered once per cascade, not per diver — the trips are the
 * same for everyone; only the admission answer differs.
 */
async function blowoutCandidates(
  db: DbExecutor,
  shopId: string,
  now: Date,
  alsoCalled: readonly string[] = [],
): Promise<BlowoutCandidateTrip[]> {
  const horizonEnd = new Date(now.getTime() + BLOWOUT_OFFER_HORIZON_DAYS * 24 * 60 * 60 * 1_000);
  const rows = await db
    .select({
      trip: trips,
      sellableCapacity: tripSellableSeatsSql(),
      activeBookings: count(bookings.id),
      activeDivers:
        sql<number>`count(*) filter (where ${bookings.participantType} = 'diver')`.mapWith(Number),
    })
    .from(trips)
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gt(trips.startsAt, now),
        lte(trips.startsAt, horizonEnd),
        alsoCalled.length > 0 ? notInArray(trips.id, [...alsoCalled]) : undefined,
      ),
    )
    .groupBy(trips.id);
  return queryAll(
    db,
    rows.map((row) => async () => {
      const [requirement, siteRequirement] = await queryAll(db, [
        () => getTripRequirements(db, shopId, row.trip.id),
        () => getTripSiteRequirement(db, shopId, row.trip.id),
      ]);
      return {
        id: row.trip.id,
        startsAt: row.trip.startsAt,
        status: row.trip.status,
        capacity: row.sellableCapacity,
        activeBookings: row.activeBookings,
        activeDivers: row.activeDivers,
        diverCapacity: row.trip.diverCapacity,
        snorkelerPriceCents: row.trip.snorkelerPriceCents,
        riderPriceCents: row.trip.riderPriceCents,
        courseSession: Boolean(row.trip.courseId),
        requirement,
        siteRequirement,
      };
    }),
  );
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
    .select({ diver: tripBlowoutDivers, person: people, booking: bookings })
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

  const candidates = await blowoutCandidates(db, input.shopId, input.now, input.alsoCalled);
  const candidateTitles = new Map(
    (
      await db
        .select({ id: trips.id, title: trips.title, startsAt: trips.startsAt })
        .from(trips)
        .where(
          and(
            liveTrip(),
            eq(trips.shopId, input.shopId),
            inArray(
              trips.id,
              candidates.map((candidate) => candidate.id),
            ),
          ),
        )
    ).map((row) => [row.id, row]),
  );
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
            ne(bookings.status, "cancelled"),
          ),
        );
      const [evidence, courseSeats] = await queryAll(db, [
        () => certificationEvidence(db, input.shopId, row.diver.personId),
        () => listCourseSeatsInTraining(db, input.shopId, [row.diver.personId]),
      ]);
      const offeredTripIds = qualifyingAlternatives({
        cancelledTripId: input.trip.id,
        now: input.now,
        candidates,
        diver: {
          evidence,
          identityUnconfirmed: row.booking.identityUnconfirmedAt !== null,
          bookedTripIds: activeSeats.map((seat) => seat.tripId),
          participantType: row.booking.participantType,
          courseSeats,
        },
      });

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
        alternatives: offeredTripIds.flatMap((tripId) => {
          const candidate = candidateTitles.get(tripId);
          return candidate
            ? [
                {
                  title: candidate.title,
                  startsAt: candidate.startsAt,
                  // The slug comes from the shop row, never from a caller: a
                  // link mailed to a diver must not be buildable from a
                  // tampered route param (security review of this slice).
                  bookingUrl: new URL(publicTripPath(shop.slug, tripId), `${origin}/`).toString(),
                },
              ]
            : [];
        }),
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
  /** Live: the diver holds an active seat on another upcoming scheduled trip. */
  rebooked: boolean;
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
 * whether they hold a seat on another upcoming departure. The blow-out isn't
 * over until nobody on this list is unresolved.
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
    .select({ diver: tripBlowoutDivers, person: people })
    .from(tripBlowoutDivers)
    .innerJoin(people, eq(people.id, tripBlowoutDivers.personId))
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
  const rebookedPersonIds = new Set(
    personIds.length
      ? (
          await db
            .select({ personId: bookings.personId })
            .from(bookings)
            .innerJoin(trips, eq(trips.id, bookings.tripId))
            .where(
              and(
                eq(bookings.shopId, shopId),
                inArray(bookings.personId, personIds),
                ne(bookings.status, "cancelled"),
                ne(trips.id, tripId),
                eq(trips.status, "scheduled"),
                gt(trips.startsAt, now),
              ),
            )
        ).map((row) => row.personId)
      : [],
  );
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
      rebooked: rebookedPersonIds.has(row.diver.personId),
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
            ne(bookings.status, "cancelled"),
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
