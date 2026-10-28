import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { diverTranslator } from "@/i18n/messages";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { nowDate } from "@/lib/clock";
import { formatDateTimeTz, formatShortDate, formatTimeRangeTz } from "@/lib/format";
import {
  heldSendPayloadSchema,
  mergeRescheduleHolds,
  type TripRescheduledPayload,
} from "@/lib/held-sends";
import { meetingPointForMessage, meetingPointOfRows } from "@/lib/meeting-point";
import {
  type NotificationProvider,
  notificationProviderSignal,
  publicAppUrl,
  recipientLocale,
} from "@/lib/notifications";
import { type CourtesyProvider, sendCourtesyMessage } from "@/lib/notifications/courtesy";
import {
  type SmsProvider,
  smsProviderFromEnvironment,
  smsRecipient,
} from "@/lib/notifications/sms";
import { issueBookingCapability, revokeIssuedCapabilities } from "./booking-capabilities";
import type { AppDb, DbExecutor } from "./client";
import { lastDayStartsAt } from "./departure-notes";
import { withErasureCoordinatedBookingSend } from "./erasure-coordinated-send";
import { holdSend } from "./held-sends";
import {
  notificationProviderForDb,
  recordNotificationDelivery,
  sendAndRecordNotification,
} from "./notifications";
import { bookings, heldSends, people, shops, trips } from "./schema";
import { isSmsOptedOut, stopListedSmsProvider } from "./sms-opt-outs";
import { liveTrip, notRehearsal } from "./trips-live";
import { whatsAppProvidersForShops } from "./whatsapp-accounts";

/**
 * **Telling the booked divers a departure moved** (ux review 2026-10-11, item
 * 1; glossary "Reschedule notice").
 *
 * Moving a departure, on the board or on the trip page, bumped
 * `trips.revision` so every subscribed calendar re-alerted, and told no booked
 * diver: the person most likely to stand at the dock at the old time was the
 * one person nothing reached. Now the move holds one send (`held_sends`, kind
 * `trip_rescheduled`, the same eight seconds and Undo every staff send takes),
 * and when it leaves, every booked seat hears the new time by its usual
 * channel.
 *
 * **Who is addressed, and who is not.** One message per seat that is still on
 * the boat (`booked` or `checked_in`), to the email or phone on *that seat's
 * own person record* — never the booker's, never a party lead's, never an
 * address the hold carried (it carries ids only). A seat whose identity is
 * still held (#2082) is skipped: the address on that record may be somebody
 * else's, the same rule the reminders keep. A cancelled seat, a no-show, and
 * a deleted person are not on the list at all.
 */

/** Seats a reschedule notice would address: on the boat, identity settled. */
const TOLD_STATUSES = ["booked", "checked_in"] as const;

export type RescheduleNoticeOutcome = {
  /** Seats the notice reached on its tracked channel. */
  told: number;
  /** Seats whose tracked channel failed or had nowhere to go. */
  failed: number;
  /** Seats waiting for staff to confirm who the diver is (#2082). */
  identityHeld: number;
};

/** How many seats a notice for this departure would address right now. */
export async function rescheduleAudienceCount(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<number> {
  const rows = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, shopId)))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        inArray(bookings.status, [...TOLD_STATUSES]),
        isNull(bookings.identityUnconfirmedAt),
        isNull(people.deletedAt),
      ),
    );
  return rows.length;
}

export type HeldRescheduleNotice = { id: string; runAt: Date; told: number };

/**
 * Whether a held notice is about the meeting point alone (#2443): the time it
 * would tell the divers they had is the time the departure still has. The
 * staff row says "the new meeting point" for it rather than "the new time".
 */
export async function heldRescheduleIsPlaceOnly(
  db: AppDb,
  shopId: string,
  payload: TripRescheduledPayload,
): Promise<boolean> {
  if (!payload.meetingPointMoved) return false;
  const [trip] = await db
    .select({ startsAt: trips.startsAt })
    .from(trips)
    .where(and(eq(trips.id, payload.tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  return trip?.startsAt.getTime() === Date.parse(payload.previousStartsAt);
}

/**
 * Whether the departure is still ahead of the divers: its last day has not
 * started. A multi-day course is reachable between its days, so a meeting
 * point moved after day one still reaches its students (as departure notes
 * do, H-110).
 */
async function stillAhead(
  db: AppDb,
  trip: { id: string; startsAt: Date },
  now: Date,
): Promise<boolean> {
  const lastDay = await lastDayStartsAt(db, trip.id);
  const sails = lastDay && lastDay > trip.startsAt ? lastDay : trip.startsAt;
  return sails.getTime() > now.getTime();
}

/** The divers know the current time again: nothing is owed them. */
async function clearDiversTold(db: AppDb, shopId: string, tripId: string) {
  await db
    .update(trips)
    .set({ diversToldStartsAt: null, diversToldMeetingPoint: false })
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)));
}

/**
 * Hold the notice for a move. Null, and nothing held, when there is nobody to
 * tell or nothing to say: no booked seat, a departure that is not live and
 * scheduled, or a departure back where the divers were last told it was. A
 * second move inside the hold replaces the first hold
 * (`mergeRescheduleHolds`), so a staffer who drags a departure twice sends one
 * message with the time the divers actually had.
 *
 * **The "before" time is the server's own** (`trips.divers_told_starts_at`).
 * A move passes `movedFrom`, the start its own transaction replaced, and it is
 * recorded only when nothing older is: a second move before anybody was told
 * keeps the first. "Tell them" after an Undo passes nothing and reads the
 * recorded time back, so no form can put words like "It was 6am" into a
 * diver's inbox; with no record of a move, there is nothing to hold.
 */
export async function holdRescheduleNotice(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    /** The start a server-side move just replaced. Absent for "Tell them". */
    movedFrom?: Date;
    /**
     * Whether this move moved the meeting point. Absent for "Tell them", which
     * reads what was recorded (`trips.divers_told_meeting_point`) and never a
     * form (#2446).
     */
    meetingPointMoved?: boolean;
    actorPersonId: string | null;
    now?: Date;
  },
): Promise<HeldRescheduleNotice | null> {
  const [trip] = await db
    .select({
      id: trips.id,
      startsAt: trips.startsAt,
      status: trips.status,
      diversToldStartsAt: trips.diversToldStartsAt,
      diversToldMeetingPoint: trips.diversToldMeetingPoint,
    })
    .from(trips)
    // A rehearsal tells nobody anything (ADR 20261012-rehearsal-departures):
    // its moves hold no notice, so "Tell them" has nothing to send.
    .where(
      and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip(), notRehearsal()),
    )
    .limit(1);
  if (trip?.status !== "scheduled") return null;
  // A departure that has sailed hears nothing, so the staffer is told nothing
  // is on its way rather than "Telling 11 divers".
  if (!(await stillAhead(db, trip, input.now ?? nowDate()))) return null;
  const toldStartsAt = trip.diversToldStartsAt ?? input.movedFrom ?? null;
  // The place has moved if an earlier move said so or this one does.
  const placeMoved = trip.diversToldMeetingPoint || (input.meetingPointMoved ?? false);

  const pendingRows = await db
    .select({ id: heldSends.id, payload: heldSends.payload })
    .from(heldSends)
    .where(and(eq(heldSends.shopId, input.shopId), eq(heldSends.kind, "trip_rescheduled")));
  const pending: { id: string; payload: TripRescheduledPayload }[] = [];
  for (const row of pendingRows) {
    const parsed = heldSendPayloadSchema.safeParse(row.payload);
    if (parsed.success && parsed.data.kind === "trip_rescheduled") {
      if (parsed.data.tripId === input.tripId) pending.push({ id: row.id, payload: parsed.data });
    }
  }
  const merged = toldStartsAt
    ? mergeRescheduleHolds(
        pending.map((held) => held.payload),
        {
          kind: "trip_rescheduled",
          tripId: input.tripId,
          previousStartsAt: toldStartsAt.toISOString(),
          meetingPointMoved: placeMoved,
        },
        trip.startsAt,
      )
    : null;
  // The earlier holds are folded into this one, or there is nothing left to
  // say; either way they must not leave on their own.
  if (pending.length > 0) {
    await db.delete(heldSends).where(
      and(
        eq(heldSends.shopId, input.shopId),
        inArray(
          heldSends.id,
          pending.map((held) => held.id),
        ),
      ),
    );
  }
  // Back where the divers were told (or never moved): they know the time.
  const hasRecord = Boolean(trip.diversToldStartsAt) || trip.diversToldMeetingPoint;
  if (!merged) {
    if (hasRecord) await clearDiversTold(db, input.shopId, input.tripId);
    return null;
  }

  const told = await rescheduleAudienceCount(db, input.shopId, input.tripId);
  // Nobody on the boat holds the old time; whoever books next sees the new one.
  if (told === 0) {
    if (hasRecord) await clearDiversTold(db, input.shopId, input.tripId);
    return null;
  }
  if (
    trip.diversToldStartsAt?.getTime() !== toldStartsAt?.getTime() ||
    trip.diversToldMeetingPoint !== merged.meetingPointMoved
  ) {
    await db
      .update(trips)
      .set({ diversToldStartsAt: toldStartsAt, diversToldMeetingPoint: merged.meetingPointMoved })
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId)));
  }
  const held = await holdSend(db, {
    shopId: input.shopId,
    payload: merged,
    actorPersonId: input.actorPersonId,
    now: input.now,
  });
  return { ...held, told };
}

export type SendRescheduleNoticesOptions = {
  now?: Date;
  emailProvider?: NotificationProvider;
  smsProvider?: SmsProvider;
  whatsAppProviders?: Map<string, CourtesyProvider>;
  /** Origin for readiness links; defaults to the configured public app URL. */
  appOrigin?: string | null;
};

/** The held send itself: one message per booked seat, by its usual channel. */
export async function sendRescheduleNotices(
  db: AppDb,
  shopId: string,
  payload: TripRescheduledPayload,
  options: SendRescheduleNoticesOptions = {},
): Promise<RescheduleNoticeOutcome> {
  const outcome: RescheduleNoticeOutcome = { told: 0, failed: 0, identityHeld: 0 };
  const now = options.now ?? nowDate();
  const [row] = await db
    .select({ trip: trips, shop: shops })
    .from(trips)
    .innerJoin(shops, eq(shops.id, trips.shopId))
    // The text path below goes straight to the courtesy primitive, so the
    // rehearsal guard sits on this read rather than at the email chokepoint.
    .where(and(eq(trips.id, payload.tripId), eq(trips.shopId, shopId), liveTrip(), notRehearsal()))
    .limit(1);
  if (row?.trip.status !== "scheduled") return outcome;
  const { trip, shop } = row;
  const previousStartsAt = new Date(payload.previousStartsAt);
  const timeMoved = previousStartsAt.getTime() !== trip.startsAt.getTime();
  // Moved and moved back before the cron swept a closed tab's hold. A save
  // that moved only the meeting point still has that to say (#2443).
  if (!timeMoved && !payload.meetingPointMoved) return outcome;
  // Nothing to tell about a departure that has already left: for a
  // multi-day course, once its last day has.
  if (!(await stillAhead(db, trip, now))) return outcome;

  const seats = await db
    .select({ booking: bookings, person: people })
    .from(bookings)
    // The seat's own person, and only within this shop: the one record whose
    // address this message may use.
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, shopId)))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, trip.id),
        inArray(bookings.status, [...TOLD_STATUSES]),
        isNull(people.deletedAt),
      ),
    );
  if (seats.length === 0) return outcome;

  const meetingPoint = payload.meetingPointMoved
    ? meetingPointForMessage(meetingPointOfRows(shop, trip))
    : undefined;
  const channels = await seatChannels(db, shop.id, options);
  // Each seat's current STOP state is re-read inside its erasure send fence.
  for (const { booking, person } of seats) {
    if (booking.identityUnconfirmedAt) {
      outcome.identityHeld += 1;
      // Nothing re-sends this when staff confirm who the diver is unless the
      // skip is remembered (#2445): the earliest start the seat last knew, and
      // whether the place moved.
      await db
        .update(bookings)
        .set({
          rescheduleMissedFrom: sql`coalesce(${bookings.rescheduleMissedFrom}, ${previousStartsAt.toISOString()}::timestamptz)`,
          rescheduleMissedPlace: payload.meetingPointMoved
            ? true
            : sql`${bookings.rescheduleMissedPlace}`,
        })
        .where(and(eq(bookings.id, booking.id), eq(bookings.shopId, shopId)));
      continue;
    }
    const told = await tellSeat(db, {
      shop,
      trip,
      booking,
      person,
      previousStartsAt,
      meetingPoint,
      channels,
      now,
    });
    if (told === "identity-held") outcome.identityHeld += 1;
    else if (told !== "skipped") outcome[told] += 1;
  }
  // The divers have the new time now; a later move starts from this one.
  if (outcome.told > 0) await clearDiversTold(db, shop.id, trip.id);
  return outcome;
}

type SeatChannels = {
  emailProvider: NotificationProvider;
  smsProvider: SmsProvider;
  whatsApp: CourtesyProvider | null;
  origin: string | null;
};

async function seatChannels(
  db: AppDb,
  shopId: string,
  options: SendRescheduleNoticesOptions,
): Promise<SeatChannels> {
  return {
    emailProvider: notificationProviderForDb(options.emailProvider),
    smsProvider: stopListedSmsProvider(db, options.smsProvider ?? smsProviderFromEnvironment()),
    whatsApp:
      (options.whatsAppProviders ?? (await whatsAppProvidersForShops(db, [shopId]))).get(shopId) ??
      null,
    origin: options.appOrigin === undefined ? publicAppUrl() : options.appOrigin,
  };
}

/**
 * Tell one seat its new time, by its usual channel: the email on the seat's own
 * person record with the courtesy text riding a delivered email, or the
 * courtesy text alone when there is no email. `seatMovedAt` marks a seat that
 * moved to another departure rather than a departure that moved. `capability`
 * is the seat's readiness link when the caller minted it ahead (a whole
 * departure's, in one insert); left out, one is minted here.
 */
async function tellSeat(
  db: AppDb,
  input: {
    shop: typeof shops.$inferSelect;
    trip: typeof trips.$inferSelect;
    booking: typeof bookings.$inferSelect;
    person: typeof people.$inferSelect;
    previousStartsAt: Date;
    meetingPoint: ReturnType<typeof meetingPointForMessage> | undefined;
    channels: SeatChannels;
    now: Date;
    seatMovedAt?: Date;
  },
): Promise<"told" | "failed" | "identity-held" | "skipped"> {
  const { shop, trip, booking, person } = input;
  const result = await withErasureCoordinatedBookingSend(
    db,
    {
      shopId: shop.id,
      bookingId: booking.id,
      expectedPersonId: person.id,
      expectedTripId: trip.id,
      expectedEmail: person.email,
      expectedPhone: person.phone,
    },
    async (tx) => {
      const [current] = await tx
        .select({ identityUnconfirmedAt: bookings.identityUnconfirmedAt, status: bookings.status })
        .from(bookings)
        .where(and(eq(bookings.id, booking.id), eq(bookings.shopId, shop.id)))
        .limit(1);
      if (!current || !TOLD_STATUSES.includes(current.status as (typeof TOLD_STATUSES)[number]))
        return "skipped" as const;
      if (current.identityUnconfirmedAt) {
        await tx
          .update(bookings)
          .set({
            rescheduleMissedFrom: sql`coalesce(${bookings.rescheduleMissedFrom}, ${input.previousStartsAt.toISOString()}::timestamptz)`,
            rescheduleMissedPlace: input.meetingPoint
              ? true
              : sql`${bookings.rescheduleMissedPlace}`,
          })
          .where(and(eq(bookings.id, booking.id), eq(bookings.shopId, shop.id)));
        return "identity-held" as const;
      }
      return tellSeatWithinFence(tx, input);
    },
  );
  return result ?? "skipped";
}

async function tellSeatWithinFence(
  db: DbExecutor,
  input: {
    shop: typeof shops.$inferSelect;
    trip: typeof trips.$inferSelect;
    booking: typeof bookings.$inferSelect;
    person: typeof people.$inferSelect;
    previousStartsAt: Date;
    meetingPoint: ReturnType<typeof meetingPointForMessage> | undefined;
    channels: SeatChannels;
    now: Date;
    seatMovedAt?: Date;
  },
): Promise<"told" | "failed"> {
  const {
    shop,
    trip,
    booking,
    person,
    previousStartsAt,
    meetingPoint,
    channels,
    now,
    seatMovedAt,
  } = input;
  const phone = smsRecipient(person.phone);
  // Nowhere to send it: recorded, and no readiness capability minted for a
  // link nobody will receive (the order `src/db/reminders.ts` keeps).
  if (!person.email && !phone) {
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId: booking.id,
      kind: "trip_rescheduled",
      delivery: { status: "not_configured" },
    });
    return "failed";
  }
  const locale = recipientLocale(person.locale, shop.defaultLocale);
  const t = diverTranslator(locale);
  // A STOP-listed phone-only seat mints nothing (#2451); the one-seat path
  // checks here what the whole-departure path checks in a batch.
  const refusedText =
    !person.email && Boolean(phone) && !channels.whatsApp && (await isSmsOptedOut(db, phone ?? ""));
  const capability =
    channels.origin && !refusedText
      ? await issueBookingCapability(db, {
          shopId: shop.id,
          bookingId: booking.id,
          purpose: "readiness",
          expectedPersonId: person.id,
          expectedTripId: trip.id,
          now,
          delivered: true,
        })
      : null;
  // The link was minted ahead of the send; when the send did not go nobody
  // holds it, so it is taken back (#2451).
  const settle = async (told: "told" | "failed"): Promise<"told" | "failed"> => {
    if (told === "failed" && capability) {
      await revokeIssuedCapabilities(db, { shopId: shop.id, tokens: [capability.token], now });
    }
    return told;
  };
  const readinessUrl = capability
    ? new URL(readinessLinkPath(capability.token), `${channels.origin}/`).toString()
    : undefined;
  // A save that moved only the meeting point says the place alone (#2443).
  const timeMoved = previousStartsAt.getTime() !== trip.startsAt.getTime();
  const date = formatShortDate(trip.startsAt, locale, shop.timezone);
  const time = formatTimeRangeTz(trip.startsAt, trip.endsAt, locale, shop.timezone);
  const smsBody = [
    seatMovedAt || timeMoved
      ? t(seatMovedAt ? "notifications.sms.rescheduledSeat" : "notifications.sms.rescheduled", {
          shopName: shop.name,
          tripTitle: trip.title,
          date,
          time,
          previous: formatDateTimeTz(previousStartsAt, locale, shop.timezone),
        })
      : t("notifications.sms.meetingPointMoved", {
          shopName: shop.name,
          tripTitle: trip.title,
          date,
          time,
        }),
    meetingPoint
      ? t("trip.calendarMeetingPoint", {
          place: [meetingPoint.label, meetingPoint.address].filter(Boolean).join(", "),
        })
      : null,
    readinessUrl ? t("notifications.sms.readyLink", { url: readinessUrl }) : null,
  ]
    .filter(Boolean)
    .join(" ");
  const courtesy = phone
    ? {
        to: phone,
        body: smsBody,
        smsStopLine: t("notifications.sms.stopLine"),
        shopName: shop.name,
      }
    : null;

  if (person.email) {
    const delivery = await sendAndRecordNotification(
      db,
      {
        kind: "trip_rescheduled",
        bookingId: booking.id,
        shopId: shop.id,
        to: person.email,
        locale,
        diverName: person.fullName,
        shopName: shop.name,
        tripTitle: trip.title,
        previousStartsAt,
        startsAt: trip.startsAt,
        endsAt: trip.endsAt,
        timezone: shop.timezone,
        ...(trip.courseId ? {} : { dockCallMinutes: shop.dockCallMinutes }),
        ...(seatMovedAt ? { seatMovedAt } : {}),
        revision: trip.revision,
        ...(meetingPoint ? { meetingPoint } : {}),
        ...(readinessUrl ? { readinessUrl } : {}),
      },
      { provider: channels.emailProvider, signal: notificationProviderSignal() },
    );
    // The courtesy text rides a delivered email, as the reminders' does; its
    // own result is not recorded over the email's.
    if (delivery.status === "sent" && courtesy) {
      await sendCourtesyMessage(courtesy, {
        sms: channels.smsProvider,
        whatsapp: channels.whatsApp,
      });
    }
    return settle(delivery.status === "sent" ? "told" : "failed");
  } else if (courtesy) {
    const { delivery } = await sendCourtesyMessage(courtesy, {
      sms: channels.smsProvider,
      whatsapp: channels.whatsApp,
    });
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId: booking.id,
      kind: "trip_rescheduled",
      delivery,
    });
    return settle(delivery.status === "sent" ? "told" : "failed");
  }
  return settle("failed");
}

/**
 * **One seat moved to another departure** (ADR 20261013-staff-move-a-seat):
 * the same reschedule notice, to that seat alone, with the old departure's
 * start as "It was". Sent at once rather than held, because the staffer who
 * moved the seat is the person the diver asked; nothing is sent when the time
 * did not change, the departure is a rehearsal, or the seat's identity is held.
 */
export async function sendSeatMoveNotice(
  db: AppDb,
  input: { shopId: string; bookingId: string; fromTripId: string; movedAt: Date },
  options: SendRescheduleNoticesOptions = {},
): Promise<"told" | "failed" | "skipped"> {
  const now = options.now ?? nowDate();
  const [row] = await db
    .select({ trip: trips, shop: shops, booking: bookings, person: people })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, input.shopId)))
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, input.shopId)))
    .where(
      and(
        eq(bookings.id, input.bookingId),
        eq(bookings.shopId, input.shopId),
        eq(bookings.status, "booked"),
        isNull(bookings.identityUnconfirmedAt),
        isNull(people.deletedAt),
        liveTrip(),
        notRehearsal(),
      ),
    )
    .limit(1);
  if (row?.trip.status !== "scheduled") return "skipped";
  // Read regardless of state: a seat moved off a departure that was since
  // stood down still left from that time and place.
  const [from] = await db
    .select()
    .from(trips)
    // diveday:allow-deleted-trips: the seat left this departure's time, taken off the board since or not.
    .where(and(eq(trips.id, input.fromTripId), eq(trips.shopId, input.shopId)))
    .limit(1);
  if (!from) return "skipped";
  if (row.trip.startsAt.getTime() === from.startsAt.getTime()) return "skipped";
  if (row.trip.startsAt.getTime() <= now.getTime()) return "skipped";
  const meetingPoint = meetingPointForMessage(meetingPointOfRows(row.shop, row.trip));
  const meetingPointMoved =
    JSON.stringify(meetingPoint) !==
    JSON.stringify(meetingPointForMessage(meetingPointOfRows(row.shop, from)));
  const result = await tellSeat(db, {
    ...row,
    previousStartsAt: from.startsAt,
    // Only when it differs: the email says "We meet somewhere new, too."
    meetingPoint: meetingPointMoved ? meetingPoint : undefined,
    channels: await seatChannels(db, input.shopId, options),
    now,
    seatMovedAt: input.movedAt,
  });
  return result === "identity-held" ? "skipped" : result;
}

/**
 * **The notice a held seat missed, sent once staff confirm the diver** (#2445).
 *
 * `sendRescheduleNotices` skips a seat whose identity is held, and leaves the
 * start the seat last knew on the booking (`reschedule_missed_from`). When the
 * hold clears (`confirmBookingIdentity`, or a split that gives the seat its own
 * record) this sends the same notice that seat would have had, to the address
 * on the person it now belongs to.
 *
 * **Exactly once, and not lost.** The columns are claimed and cleared in one statement before
 * anything is sent, so a second confirm, a retry or a race finds nothing owed. A send that
 * does not go puts the claim back, so the next confirm tries again.
 * A seat still held, no longer on the boat, on a departure that has left or is
 * a rehearsal, or back at the start it knew with the place unmoved, sends
 * nothing; the claim is cleared in each case because nothing is owed.
 */
export async function sendMissedRescheduleNotice(
  db: AppDb,
  input: { shopId: string; bookingId: string },
  options: SendRescheduleNoticesOptions = {},
): Promise<"told" | "failed" | "nothing"> {
  const now = options.now ?? nowDate();
  const owed = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ from: bookings.rescheduleMissedFrom, place: bookings.rescheduleMissedPlace })
      .from(bookings)
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          isNotNull(bookings.rescheduleMissedFrom),
          isNull(bookings.identityUnconfirmedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!row?.from) return null;
    await tx
      .update(bookings)
      .set({ rescheduleMissedFrom: null, rescheduleMissedPlace: false })
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)));
    return { from: row.from, place: row.place };
  });
  if (!owed) return "nothing";

  const [row] = await db
    .select({ trip: trips, shop: shops, booking: bookings, person: people })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, input.shopId)))
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, input.shopId)))
    .where(
      and(
        eq(bookings.id, input.bookingId),
        eq(bookings.shopId, input.shopId),
        inArray(bookings.status, [...TOLD_STATUSES]),
        isNull(people.deletedAt),
        liveTrip(),
        notRehearsal(),
      ),
    )
    .limit(1);
  if (row?.trip.status !== "scheduled") return "nothing";
  const timeMoved = owed.from.getTime() !== row.trip.startsAt.getTime();
  // Moved and moved back while the seat was held, with the place unmoved.
  if (!timeMoved && !owed.place) return "nothing";
  if (!(await stillAhead(db, row.trip, now))) return "nothing";
  // A notice that did not go, by a refusal or a throw, is still owed: put the
  // claim back, keeping any earlier start a later skip has recorded since (#2445).
  const putBack = () =>
    db
      .update(bookings)
      .set({
        rescheduleMissedFrom: sql`coalesce(${bookings.rescheduleMissedFrom}, ${owed.from.toISOString()}::timestamptz)`,
        rescheduleMissedPlace: owed.place ? true : sql`${bookings.rescheduleMissedPlace}`,
      })
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)));
  let told: "told" | "failed" | "identity-held" | "skipped";
  try {
    told = await tellSeat(db, {
      ...row,
      previousStartsAt: owed.from,
      meetingPoint: owed.place
        ? meetingPointForMessage(meetingPointOfRows(row.shop, row.trip))
        : undefined,
      channels: await seatChannels(db, input.shopId, options),
      now,
    });
  } catch (error) {
    await putBack();
    throw error;
  }
  if (told !== "told") await putBack();
  return told === "told" ? "told" : "failed";
}
