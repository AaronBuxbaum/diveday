import { and, eq, gt, inArray, lt, lte, ne } from "drizzle-orm";
import { diverTranslator } from "@/i18n/messages";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { nowDate } from "@/lib/clock";
import { firstTimerReassuranceText, forecastText } from "@/lib/night-before-brief";
import {
  type Notification,
  type NotificationProvider,
  publicAppUrl,
  recipientLocale,
} from "@/lib/notifications";
import { buildDiverChecklist, reminderReadiness } from "@/lib/readiness-summary";
import {
  dueReminder,
  MAX_REMINDER_LEAD_HOURS,
  type ReminderKind,
  TRIP_REMINDER_CADENCES,
} from "@/lib/reminders";
import { issueBookingCapability } from "./booking-capabilities";
import type { AppDb } from "./client";
import {
  notificationProviderForDb,
  recordNotificationDelivery,
  sendNotificationBatch,
} from "./notifications";
import { getBookingReadinessDetail } from "./readiness";
import { bookings, notificationDeliveries, people, shops, trips } from "./schema";

const REMINDER_KINDS: ReminderKind[] = TRIP_REMINDER_CADENCES.map((c) => c.kind);
const HOUR_MS = 60 * 60 * 1000;

/**
 * The subset of these people who have dived with the shop before — anyone with a
 * prior non-cancelled booking on a trip that has already departed. A diver NOT
 * in this set is a first-timer, and the night-before brief speaks to them in a
 * softer, what-happens-on-the-boat voice (brainstorm C's first-timer track).
 * Batched to a single query so the cron scan stays flat regardless of party size.
 */
async function returningDiverIds(db: AppDb, personIds: string[], now: Date): Promise<Set<string>> {
  if (personIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ personId: bookings.personId })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        inArray(bookings.personId, personIds),
        ne(bookings.status, "cancelled"),
        lt(trips.startsAt, now),
      ),
    );
  return new Set(rows.map((r) => r.personId));
}

export type ReminderRunSummary = {
  /** Active bookings on trips inside the reminder horizon. */
  scanned: number;
  /** Reminders whose tracked channel reported a real send. */
  sent: number;
  /** Bookings with no cadence due this run. */
  skipped: number;
  /** Reminders whose tracked channel failed or was not configured. */
  failed: number;
};

export type SendDueRemindersOptions = {
  /** Injectable clock; defaults to now. */
  now?: Date;
  emailProvider?: NotificationProvider;
  /** Origin for readiness links; defaults to the configured public app URL. */
  appOrigin?: string | null;
};

/**
 * Send every pre-trip reminder that has come due since the last run, across all
 * shops. Idempotent by construction: a booking's reminder is deduped by a
 * `notification_deliveries` row keyed on (booking, cadence kind), so re-running
 * only sends cadences not yet delivered (`src/lib/reminders.ts`). Email is the
 * only tracked channel; a diver with no email address on file gets no reminder
 * at all and the gap is recorded as `not_configured` so staff can see it.
 *
 * There is no timer in the app: a cron caller drives `now`
 * (docs ADR 20260721-scheduled-reminder-cadence). Fully degradable — with no
 * email provider configured every send records `not_configured` and the staff
 * notification dashboard surfaces it, exactly like every other channel.
 */
export async function sendDueReminders(
  db: AppDb,
  options: SendDueRemindersOptions = {},
): Promise<ReminderRunSummary> {
  const now = options.now ?? nowDate();
  const emailProvider = notificationProviderForDb(db, options.emailProvider);
  const origin = options.appOrigin === undefined ? publicAppUrl() : options.appOrigin;
  const horizon = new Date(now.getTime() + MAX_REMINDER_LEAD_HOURS * HOUR_MS);

  const rows = await db
    .select({ booking: bookings, person: people, trip: trips, shop: shops })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(
      and(
        ne(bookings.status, "cancelled"),
        eq(trips.status, "scheduled"),
        gt(trips.startsAt, now),
        lte(trips.startsAt, horizon),
      ),
    );

  const summary: ReminderRunSummary = { scanned: rows.length, sent: 0, skipped: 0, failed: 0 };
  if (rows.length === 0) return summary;

  // Which reminder cadences have already landed for these bookings.
  const bookingIds = rows.map((r) => r.booking.id);
  const delivered = await db
    .select({ bookingId: notificationDeliveries.bookingId, kind: notificationDeliveries.kind })
    .from(notificationDeliveries)
    .where(
      and(
        inArray(notificationDeliveries.bookingId, bookingIds),
        inArray(notificationDeliveries.kind, REMINDER_KINDS),
        eq(notificationDeliveries.status, "sent"),
      ),
    );
  const sentByBooking = new Map<string, Set<string>>();
  for (const row of delivered) {
    const set = sentByBooking.get(row.bookingId) ?? new Set<string>();
    set.add(row.kind);
    sentByBooking.set(row.bookingId, set);
  }

  // Who has dived with the shop before — a night-before brief speaks to a
  // first-timer (anyone NOT in this set) in a softer voice (brainstorm C).
  const returning = await returningDiverIds(db, [...new Set(rows.map((r) => r.person.id))], now);

  const emailWork: Array<{
    bookingId: string;
    shopId: string;
    kind: ReminderKind;
    notification: Notification;
  }> = [];

  for (const { booking, person, trip, shop } of rows) {
    const cadence = dueReminder({
      startsAt: trip.startsAt,
      now,
      sentKinds: sentByBooking.get(booking.id) ?? new Set(),
    });
    if (!cadence) {
      summary.skipped += 1;
      continue;
    }

    // There is no request to negotiate `Accept-Language` from at a cron fire,
    // so this reads whatever the diver's own past requests already recorded,
    // and falls back to the shop's stored locale when there is nothing — same
    // fallback the calendar feed uses, for the same reason (docs ADR
    // 20260731-per-person-notification-locale).
    const locale = recipientLocale(person.locale, shop.defaultLocale);
    const t = diverTranslator(locale);
    const readinessCapability = origin
      ? await issueBookingCapability(db, {
          shopId: shop.id,
          bookingId: booking.id,
          purpose: "readiness",
          now,
        })
      : null;
    const readinessUrl = readinessCapability
      ? new URL(readinessLinkPath(readinessCapability.token), `${origin}/`).toString()
      : undefined;

    // Name the diver's own outstanding items from the same checklist the diver
    // page shows, so the reminder never diverges from the readiness engine.
    const detail = await getBookingReadinessDetail(db, booking.id);
    const { outstanding, medicalReview } = detail
      ? reminderReadiness(buildDiverChecklist(detail.requirement, detail.readiness))
      : { outstanding: [], medicalReview: false };

    // The night-before (day) lead becomes the full brief: plain-language
    // conditions from the crew, what to bring, who to text, and a softer voice
    // for a first-timer. The 7-day nudge carries none of it.
    const isDay = cadence.kind === "trip_reminder_24h";
    const forecast = isDay
      ? forecastText(t, locale, {
          conditionsSummary: trip.conditionsSummary,
          waterTemperatureC: trip.waterTemperatureC,
          visibilityMeters: trip.visibilityMeters,
          surfaceConditions: trip.surfaceConditions,
        })
      : null;
    const whoToText = isDay ? shop.contactPhone?.trim() || null : null;
    const brief = isDay
      ? {
          forecast,
          bring: shop.packingList,
          whoToText,
          firstTimerNote: firstTimerReassuranceText(t, !returning.has(person.id)),
        }
      : undefined;

    if (person.email) {
      emailWork.push({
        bookingId: booking.id,
        shopId: shop.id,
        kind: cadence.kind,
        notification: {
          kind: cadence.kind,
          bookingId: booking.id,
          shopId: shop.id,
          to: person.email,
          locale,
          diverName: person.fullName,
          shopName: shop.name,
          tripTitle: trip.title,
          startsAt: trip.startsAt,
          endsAt: trip.endsAt,
          timezone: shop.timezone,
          dockCallMinutes: shop.dockCallMinutes,
          outstanding,
          medicalReview,
          readinessUrl,
          ...(brief ? { brief } : {}),
        },
      });
    } else {
      // No reachable channel — record it so staff can see the gap.
      await recordNotificationDelivery(db, {
        shopId: shop.id,
        bookingId: booking.id,
        kind: cadence.kind,
        delivery: { status: "not_configured" },
      });
      summary.failed += 1;
    }
  }

  const emailDeliveries = await sendNotificationBatch(
    db,
    emailWork.map((work) => work.notification),
    emailProvider,
  );
  for (let index = 0; index < emailWork.length; index += 1) {
    const work = emailWork[index];
    const delivery = emailDeliveries[index] ?? { status: "failed" as const, retryable: true };
    await recordNotificationDelivery(db, {
      shopId: work.shopId,
      bookingId: work.bookingId,
      kind: work.kind,
      delivery,
    });
    if (delivery.status === "sent") summary.sent += 1;
    else summary.failed += 1;
  }

  return summary;
}
