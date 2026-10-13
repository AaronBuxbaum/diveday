import { and, eq, inArray, isNull } from "drizzle-orm";
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
import { type NotificationProvider, publicAppUrl, recipientLocale } from "@/lib/notifications";
import { type CourtesyProvider, sendCourtesyMessage } from "@/lib/notifications/courtesy";
import {
  type SmsProvider,
  smsProviderFromEnvironment,
  smsRecipient,
} from "@/lib/notifications/sms";
import { type IssuedCapability, issueBookingCapabilities } from "./booking-capabilities";
import type { AppDb } from "./client";
import { holdSend } from "./held-sends";
import {
  notificationProviderForDb,
  recordNotificationDelivery,
  sendAndRecordNotification,
} from "./notifications";
import { bookings, heldSends, people, shops, trips } from "./schema";
import { stopListedSmsProvider } from "./sms-opt-outs";
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

/** The divers know the current time again: nothing is owed them. */
async function clearDiversTold(db: AppDb, shopId: string, tripId: string) {
  await db
    .update(trips)
    .set({ diversToldStartsAt: null })
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
    meetingPointMoved: boolean;
    actorPersonId: string | null;
    now?: Date;
  },
): Promise<HeldRescheduleNotice | null> {
  const [trip] = await db
    .select({
      startsAt: trips.startsAt,
      status: trips.status,
      diversToldStartsAt: trips.diversToldStartsAt,
    })
    .from(trips)
    // A rehearsal tells nobody anything (ADR 20261012-rehearsal-departures):
    // its moves hold no notice, so "Tell them" has nothing to send.
    .where(
      and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip(), notRehearsal()),
    )
    .limit(1);
  if (trip?.status !== "scheduled") return null;
  const toldStartsAt = trip.diversToldStartsAt ?? input.movedFrom ?? null;

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
          meetingPointMoved: input.meetingPointMoved,
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
  if (!merged) {
    if (trip.diversToldStartsAt) await clearDiversTold(db, input.shopId, input.tripId);
    return null;
  }

  const told = await rescheduleAudienceCount(db, input.shopId, input.tripId);
  // Nobody on the boat holds the old time; whoever books next sees the new one.
  if (told === 0) {
    if (trip.diversToldStartsAt) await clearDiversTold(db, input.shopId, input.tripId);
    return null;
  }
  if (trip.diversToldStartsAt?.getTime() !== toldStartsAt?.getTime()) {
    await db
      .update(trips)
      .set({ diversToldStartsAt: toldStartsAt })
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
  // Moved and moved back before the cron swept a closed tab's hold.
  if (previousStartsAt.getTime() === trip.startsAt.getTime()) return outcome;
  // Nothing to tell about a departure that has already left.
  if (trip.startsAt.getTime() <= now.getTime()) return outcome;

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

  const emailProvider = notificationProviderForDb(options.emailProvider);
  const smsProvider = stopListedSmsProvider(
    db,
    options.smsProvider ?? smsProviderFromEnvironment(),
  );
  const whatsApp =
    (options.whatsAppProviders ?? (await whatsAppProvidersForShops(db, [shop.id]))).get(shop.id) ??
    null;
  const origin = options.appOrigin === undefined ? publicAppUrl() : options.appOrigin;
  const meetingPoint = payload.meetingPointMoved
    ? meetingPointForMessage(meetingPointOfRows(shop, trip))
    : undefined;
  const courseSession = Boolean(trip.courseId);
  // **Every reachable seat's link in one insert, before the sends** (code
  // review 2026-10-13b, item 36): this loop minted one per seat, three
  // statements each, the shape `sendDepartureNote` left (item 35). The same
  // seats as before: not a held one, not one with nowhere to send it.
  const links = origin
    ? await issueBookingCapabilities(db, {
        shopId: shop.id,
        bookingIds: seats
          .filter(
            ({ booking, person }) =>
              !booking.identityUnconfirmedAt && (person.email || smsRecipient(person.phone)),
          )
          .map(({ booking }) => booking.id),
        purpose: "readiness",
        now,
      })
    : new Map<string, IssuedCapability>();

  for (const { booking, person } of seats) {
    // **A held seat waits for staff** (#2082), exactly as the reminders do.
    if (booking.identityUnconfirmedAt) {
      outcome.identityHeld += 1;
      continue;
    }
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
      outcome.failed += 1;
      continue;
    }
    const locale = recipientLocale(person.locale, shop.defaultLocale);
    const t = diverTranslator(locale);
    const capability = links.get(booking.id);
    const readinessUrl = capability
      ? new URL(readinessLinkPath(capability.token), `${origin}/`).toString()
      : undefined;
    const smsBody = [
      t("notifications.sms.rescheduled", {
        shopName: shop.name,
        tripTitle: trip.title,
        date: formatShortDate(trip.startsAt, locale, shop.timezone),
        time: formatTimeRangeTz(trip.startsAt, trip.endsAt, locale, shop.timezone),
        previous: formatDateTimeTz(previousStartsAt, locale, shop.timezone),
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
          ...(courseSession ? {} : { dockCallMinutes: shop.dockCallMinutes }),
          revision: trip.revision,
          ...(meetingPoint ? { meetingPoint } : {}),
          ...(readinessUrl ? { readinessUrl } : {}),
        },
        { provider: emailProvider },
      );
      // The courtesy text rides a delivered email, as the reminders' does; its
      // own result is not recorded over the email's.
      if (delivery.status === "sent" && courtesy) {
        await sendCourtesyMessage(courtesy, { sms: smsProvider, whatsapp: whatsApp });
      }
      if (delivery.status === "sent") outcome.told += 1;
      else outcome.failed += 1;
    } else if (courtesy) {
      const { delivery } = await sendCourtesyMessage(courtesy, {
        sms: smsProvider,
        whatsapp: whatsApp,
      });
      await recordNotificationDelivery(db, {
        shopId: shop.id,
        bookingId: booking.id,
        kind: "trip_rescheduled",
        delivery,
      });
      if (delivery.status === "sent") outcome.told += 1;
      else outcome.failed += 1;
    }
  }
  // The divers have the new time now; a later move starts from this one.
  if (outcome.told > 0) await clearDiversTold(db, shop.id, trip.id);
  return outcome;
}
