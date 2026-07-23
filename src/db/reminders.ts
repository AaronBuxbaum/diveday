import { and, eq, gt, inArray, lt, lte, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { firstTimerReassurance, forecastLine } from "@/lib/night-before-brief";
import {
  type NotificationDelivery,
  type NotificationProvider,
  notificationProviderFromEnvironment,
  notify,
  publicAppUrl,
} from "@/lib/notifications";
import {
  notifySms,
  type SmsProvider,
  smsProviderFromEnvironment,
  smsRecipient,
} from "@/lib/notifications/sms";
import { readinessLinkPath } from "@/lib/readiness-links";
import { buildDiverChecklist, reminderReadiness } from "@/lib/readiness-summary";
import {
  dueReminder,
  MAX_REMINDER_LEAD_HOURS,
  type ReminderKind,
  TRIP_REMINDER_CADENCES,
} from "@/lib/reminders";
import type { AppDb } from "./client";
import { recordNotificationDelivery } from "./notifications";
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
  smsProvider?: SmsProvider;
  /** Origin for readiness links; defaults to the configured public app URL. */
  appOrigin?: string | null;
};

/**
 * A short text; the email carries the full detail and the link. The night-before
 * (day) lead adds the plain-language conditions line and who to text, the SMS
 * half of the confidence arc — kept compact so it stays a single readable text.
 */
function reminderSmsBody(input: {
  shopName: string;
  tripTitle: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  lead: "week" | "day";
  dockCallMinutes: number;
  outstanding: string[];
  medicalReview: boolean;
  forecast?: string | null;
  whoToText?: string | null;
}): string {
  const when = input.lead === "week" ? "this week" : "tomorrow";
  const date = formatShortDate(input.startsAt, "en-US", input.timezone);
  const time = formatTimeRangeTz(input.startsAt, input.endsAt, "en-US", input.timezone);
  const conditions = input.lead === "day" && input.forecast ? ` Conditions: ${input.forecast}` : "";
  // Name the diver's own outstanding items rather than a generic nudge.
  const todo = [...input.outstanding];
  if (input.medicalReview) todo.push("check if a medical answer needs a doctor's sign-off");
  const todoText = todo.length ? ` Still to sort before you board: ${todo.join("; ")}.` : "";
  const contact =
    input.lead === "day" && input.whoToText ? ` Questions? Text us at ${input.whoToText}.` : "";
  return `${input.shopName}: ${input.tripTitle} sails ${when} — ${date}, ${time}. Please be at the dock ${input.dockCallMinutes} min early.${conditions}${todoText}${contact}`;
}

/**
 * Send every pre-trip reminder that has come due since the last run, across all
 * shops. Idempotent by construction: a booking's reminder is deduped by a
 * `notification_deliveries` row keyed on (booking, cadence kind), so re-running
 * only sends cadences not yet delivered (`src/lib/reminders.ts`). Email is the
 * tracked channel when the diver has one; a phone-only diver is tracked from
 * the SMS result instead. When email is the tracked channel, a textable phone
 * also gets a courtesy SMS on success — the reminder's dedup row then suppresses
 * both channels next run.
 *
 * There is no timer in the app: a cron caller drives `now`
 * (docs ADR 20260721-scheduled-reminder-cadence). Fully degradable — with no
 * email or SMS provider configured every send records `not_configured` and the
 * staff notification dashboard surfaces it, exactly like every other channel.
 */
export async function sendDueReminders(
  db: AppDb,
  options: SendDueRemindersOptions = {},
): Promise<ReminderRunSummary> {
  const now = options.now ?? nowDate();
  const emailProvider = options.emailProvider ?? notificationProviderFromEnvironment();
  const smsProvider = options.smsProvider ?? smsProviderFromEnvironment();
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

    const lead = cadence.kind === "trip_reminder_7d" ? "week" : "day";
    const readinessUrl = origin
      ? new URL(readinessLinkPath(booking.id), `${origin}/`).toString()
      : undefined;
    const phone = smsRecipient(person.phone);

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
      ? forecastLine({
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
          firstTimerNote: firstTimerReassurance(!returning.has(person.id)),
        }
      : undefined;

    const smsBody = reminderSmsBody({
      shopName: shop.name,
      tripTitle: trip.title,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      timezone: shop.timezone,
      lead,
      dockCallMinutes: shop.dockCallMinutes,
      outstanding,
      medicalReview,
      forecast,
      whoToText,
    });

    let delivery: NotificationDelivery;
    if (person.email) {
      delivery = await notify(
        {
          kind: cadence.kind,
          bookingId: booking.id,
          shopId: shop.id,
          to: person.email,
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
        emailProvider,
      );
      // A textable phone gets a courtesy SMS only when the email actually sent,
      // so the once-per-booking dedup row keeps it from re-firing next run.
      if (delivery.status === "sent" && phone) {
        await notifySms({ channel: "sms", to: phone, body: smsBody }, smsProvider);
      }
    } else if (phone) {
      // Phone-only diver: SMS is the tracked channel. SmsDelivery is the same
      // shape as NotificationDelivery, so it records through the same seam.
      delivery = await notifySms({ channel: "sms", to: phone, body: smsBody }, smsProvider);
    } else {
      // No reachable channel — record it so staff can see the gap.
      delivery = { status: "not_configured" };
    }

    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId: booking.id,
      kind: cadence.kind,
      delivery,
    });
    if (delivery.status === "sent") summary.sent += 1;
    else summary.failed += 1;
  }

  return summary;
}
