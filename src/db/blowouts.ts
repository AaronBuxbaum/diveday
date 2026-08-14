import { and, count, eq, gt, inArray, isNull, lte, ne } from "drizzle-orm";
import {
  BLOWOUT_OFFER_HORIZON_DAYS,
  type BlowoutCandidateTrip,
  qualifyingAlternatives,
} from "@/lib/blowout";
import { nowDate } from "@/lib/clock";
import {
  type Notification,
  type NotificationProvider,
  publicAppUrl,
  recipientLocale,
} from "@/lib/notifications";
import type { CheckoutProvider } from "@/lib/payments/checkout";
import { publicSchedulePath, publicTripPath } from "@/lib/public-routes";
import { type AppDb, type DbExecutor, queryAll } from "./client";
import { publishManifestEvent } from "./manifest-events";
import { sendAndRecordNotification } from "./notifications";
import { paymentsByBooking } from "./payments";
import { getTripRequirements, getTripSiteRequirement } from "./readiness";
import { refundBookingOnShopCancellation, shopCancellationPaymentStory } from "./refunds";
import type { BlowoutMessageStatus, PaymentStatus } from "./schema";
import {
  bookings,
  certifications,
  nitroxCertifications,
  people,
  shops,
  specialtyCertifications,
  tripBlowoutDivers,
  tripBlowouts,
  trips,
} from "./schema";
import { setTripStatus } from "./trips-record";

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
  | { ok: false; reason: "not_found" | "trip_departed" };

export type CallBlowoutInput = {
  shopId: string;
  tripId: string;
  calledByPersonId: string;
  now?: Date;
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

  // Phase one: the durable facts — trip cancelled, blow-out recorded, roster
  // snapshotted — land together or not at all.
  const setup = await db.transaction(async (tx) => {
    const [trip] = await tx
      .select()
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId)))
      .limit(1)
      .for("update");
    if (!trip) return { ok: false as const, reason: "not_found" as const };

    const [existing] = await tx
      .select({ id: tripBlowouts.id })
      .from(tripBlowouts)
      .where(and(eq(tripBlowouts.tripId, input.tripId), eq(tripBlowouts.shopId, input.shopId)))
      .limit(1);

    // A departed trip has nothing to cancel — the boat sailed or didn't. But
    // an *existing* cascade may still be resumed after departure time: the
    // messages are about a cancellation that already happened.
    if (!existing && trip.startsAt <= now) {
      return { ok: false as const, reason: "trip_departed" as const };
    }

    if (trip.status === "scheduled") {
      await setTripStatus(tx, input.shopId, input.tripId, "cancelled");
    }

    let blowoutId = existing?.id;
    if (!blowoutId) {
      const [created] = await tx
        .insert(tripBlowouts)
        .values({
          shopId: input.shopId,
          tripId: input.tripId,
          calledByPersonId: input.calledByPersonId,
          calledAt: now,
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

    return { ok: true as const, blowoutId, trip, resumed: Boolean(existing) };
  });
  if (!setup.ok) return setup;

  // Phase two: work the pending rows. Everything below is resumable — no
  // failure past this point can undo the cancellation or the record.
  const summary = await sendPendingBlowoutMessages(db, {
    shopId: input.shopId,
    blowoutId: setup.blowoutId,
    trip: setup.trip,
    now,
    provider: input.provider,
    checkout: input.checkout,
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
): Promise<BlowoutCandidateTrip[]> {
  const horizonEnd = new Date(now.getTime() + BLOWOUT_OFFER_HORIZON_DAYS * 24 * 60 * 60 * 1_000);
  const rows = await db
    .select({ trip: trips, activeBookings: count(bookings.id) })
    .from(trips)
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gt(trips.startsAt, now),
        lte(trips.startsAt, horizonEnd),
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
        capacity: row.trip.capacity,
        activeBookings: row.activeBookings,
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
    now: Date;
    provider?: NotificationProvider;
    checkout?: CheckoutProvider;
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

  const candidates = await blowoutCandidates(db, input.shopId, input.now);
  const candidateTitles = new Map(
    (
      await db
        .select({ id: trips.id, title: trips.title, startsAt: trips.startsAt })
        .from(trips)
        .where(
          and(
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
      const refund = await refundBookingOnShopCancellation(
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
      const evidence = await certificationEvidence(db, input.shopId, row.diver.personId);
      const offeredTripIds = qualifyingAlternatives({
        cancelledTripId: input.trip.id,
        now: input.now,
        candidates,
        diver: {
          evidence,
          identityUnconfirmed: row.booking.identityUnconfirmedAt !== null,
          bookedTripIds: activeSeats.map((seat) => seat.tripId),
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
      console.error("Blow-out message could not be processed", {
        blowoutDiverId: row.diver.id,
        error: error instanceof Error ? error.message : "unknown_error",
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
        .where(and(eq(trips.shopId, shopId), inArray(trips.id, offeredIds)))
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

/** Whether this trip already has a blow-out record — the trip page's link cue. */
export async function hasTripBlowout(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: tripBlowouts.id })
    .from(tripBlowouts)
    .where(and(eq(tripBlowouts.tripId, tripId), eq(tripBlowouts.shopId, shopId)))
    .limit(1);
  return Boolean(row);
}
