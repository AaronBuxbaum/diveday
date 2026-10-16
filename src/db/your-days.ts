import { and, asc, desc, eq, gt, isNull, lte, ne } from "drizzle-orm";
import type { DiverLocale } from "@/i18n/settings";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { publicAppUrl } from "@/lib/notifications/app-url";
import { recipientLocale } from "@/lib/notifications/kinds";
import { priorVisitStanding } from "@/lib/prior-visits";
import { RECAP_TOKEN_MAX_AGE_MS, recapLinkPath } from "@/lib/recap-links";
import { DEPARTURE_BUFFER_MS } from "@/lib/trips";
import { issueBookingCapability } from "./booking-capabilities";
import type { AppDb } from "./client";
import { diveDay } from "./dive-days";
import { sendAndRecordNotification } from "./notifications";
import { bookings, people, priorVisits, shops, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **A regular's other days with the shop, from one booking's page** (fifth-loop
 * ideas, item 38; decision H-132; ADR 20261016-fresh-link-per-booking-row).
 *
 * Each row is a day, never a door: what a row does is mail that day's own link
 * to the address on file. No URL on this page opens another booking, so a
 * forwarded or leaked link still reaches one booking and nothing else.
 *
 * `src/lib` returns codes; this returns facts and the page words them.
 */

/** How many past days a page lists, newest first. The rest stay a find-my-booking away. */
export const YOUR_DAYS_PAST_LIMIT = 6;

export type YourDay = {
  bookingId: string;
  startsAt: Date;
  title: string;
  /** The day's place in the diver's count with the shop, as the recap stamps it. Past days only. */
  dayNumber: number | null;
};

export type YourDays = { upcoming: YourDay[]; past: YourDay[] };

const NONE: YourDays = { upcoming: [], past: [] };

/**
 * The person behind `bookingId`, and every other day they hold with this shop:
 * upcoming seats still ahead of the departure buffer, and past dive days (the
 * one dive-day rule, `src/db/dive-days.ts`) newest first.
 *
 * Empty for a booking that is not in this shop, a person who has been erased
 * or has no email on file (a row would promise a send that cannot happen).
 */
export async function listYourDays(
  db: AppDb,
  input: { shopId: string; bookingId: string; now?: Date },
): Promise<YourDays> {
  const now = input.now ?? nowDate();
  const [own] = await db
    .select({ personId: bookings.personId, email: people.email, timezone: shops.timezone })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(
      and(
        eq(bookings.id, input.bookingId),
        eq(bookings.shopId, input.shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
      ),
    )
    .limit(1);
  if (!own?.email) return NONE;

  const mine = and(eq(bookings.shopId, input.shopId), eq(bookings.personId, own.personId));
  const [upcoming, divedDays, imported] = await Promise.all([
    db
      .select({ bookingId: bookings.id, startsAt: trips.startsAt, title: trips.title })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(
        and(
          mine,
          ne(bookings.id, input.bookingId),
          ne(bookings.status, "cancelled"),
          eq(trips.status, "scheduled"),
          liveTrip(),
          gt(trips.startsAt, new Date(now.getTime() - DEPARTURE_BUFFER_MS)),
        ),
      )
      .orderBy(asc(trips.startsAt), asc(trips.title), asc(bookings.id)),
    // Every dive day, this booking's included: the numbering counts them all.
    db
      .select({ bookingId: bookings.id, startsAt: trips.startsAt, title: trips.title })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(and(mine, diveDay(), liveTrip(), lte(trips.startsAt, now)))
      .orderBy(asc(trips.startsAt), asc(trips.title), asc(bookings.id)),
    db
      .select({ visitedOn: priorVisits.visitedOn, statusLabel: priorVisits.statusLabel })
      .from(priorVisits)
      .where(and(eq(priorVisits.shopId, input.shopId), eq(priorVisits.personId, own.personId))),
  ]);

  // The recap's own count (`getRecapPageData`): dive days up to and including
  // this one, plus imported visits that happened on or before its local day.
  const importedDays = imported
    .filter((visit) => priorVisitStanding(visit.statusLabel) !== "did_not_happen")
    .map((visit) => visit.visitedOn);
  const past = divedDays
    .map((day, index) => {
      const localDay = calendarDateInTimezone(day.startsAt, own.timezone);
      const before = importedDays.filter((visitedOn) => visitedOn <= localDay).length;
      return { ...day, dayNumber: index + 1 + before };
    })
    .filter((day) => day.bookingId !== input.bookingId)
    .reverse()
    .slice(0, YOUR_DAYS_PAST_LIMIT);

  return { upcoming: upcoming.map((day) => ({ ...day, dayNumber: null })), past };
}

/** What a send answers with: a code, never the address or the link. */
export type YourDayLinkOutcome = "sent" | "unavailable" | "failed";

export type YourDayLinkPlan =
  | {
      ok: true;
      kind: "upcoming" | "past";
      shopId: string;
      bookingId: string;
      email: string;
      diverName: string;
      locale: DiverLocale;
      shopName: string;
      timezone: string;
      tripTitle: string;
      origin: string;
    }
  | { ok: false; reason: Exclude<YourDayLinkOutcome, "sent"> };

/**
 * Decide whether `targetBookingId` is one of the rows `fromBookingId`'s page
 * lists, from reads alone, so a refusal spends no inbox budget.
 *
 * **The target is only ever accepted from the list.** Same shop, same person,
 * the same rules that drew the row: a hand-made post naming any other booking,
 * another diver's included, is `unavailable` and sends nothing.
 */
export async function planYourDayLink(
  db: AppDb,
  input: { shopId: string; fromBookingId: string; targetBookingId: string; now?: Date },
): Promise<YourDayLinkPlan> {
  const days = await listYourDays(db, {
    shopId: input.shopId,
    bookingId: input.fromBookingId,
    now: input.now,
  });
  const upcoming = days.upcoming.find((day) => day.bookingId === input.targetBookingId);
  const past = days.past.find((day) => day.bookingId === input.targetBookingId);
  const day = upcoming ?? past;
  if (!day) return { ok: false, reason: "unavailable" };
  return planForDay(db, input.shopId, day, upcoming ? "upcoming" : "past");
}

/**
 * The plan for a past dive day found some other way than a page's list:
 * find-my-booking's latest log entry, from `latestDiveDayBooking`.
 */
export function planLogEntryLink(
  db: AppDb,
  input: { shopId: string; day: { bookingId: string; title: string }; origin: string },
): Promise<YourDayLinkPlan> {
  return planForDay(db, input.shopId, input.day, "past", input.origin);
}

async function planForDay(
  db: AppDb,
  shopId: string,
  day: { bookingId: string; title: string },
  kind: "upcoming" | "past",
  givenOrigin?: string,
): Promise<YourDayLinkPlan> {
  const [context] = await db
    .select({
      email: people.email,
      diverName: people.fullName,
      personLocale: people.locale,
      shopName: shops.name,
      shopLocale: shops.defaultLocale,
      timezone: shops.timezone,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(and(eq(bookings.id, day.bookingId), eq(bookings.shopId, shopId)))
    .limit(1);
  if (!context?.email) return { ok: false, reason: "unavailable" };
  const origin = givenOrigin ?? publicAppUrl();
  if (!origin) return { ok: false, reason: "failed" };

  return {
    ok: true,
    kind,
    shopId,
    bookingId: day.bookingId,
    email: context.email,
    diverName: context.diverName,
    locale: recipientLocale(context.personLocale, context.shopLocale),
    shopName: context.shopName,
    timezone: context.timezone,
    tripTitle: day.title,
    origin,
  };
}

/**
 * Mail the planned day's own link to the address on file: a fresh trip-prep
 * capability for an upcoming day, a recap link for a past one. A fresh
 * capability every time, not "is one live?": the diver asking is the one who
 * cannot find it, and `issueBookingCapability` keeps the live set bounded.
 */
export async function sendYourDayLink(
  db: AppDb,
  plan: Extract<YourDayLinkPlan, { ok: true }>,
  now: Date = nowDate(),
): Promise<YourDayLinkOutcome> {
  let url: string;
  let expiresAt: Date;
  if (plan.kind === "upcoming") {
    const issued = await issueBookingCapability(db, {
      shopId: plan.shopId,
      bookingId: plan.bookingId,
      purpose: "readiness",
      now,
    });
    if (!issued) return "unavailable";
    url = readinessLinkPath(issued.token);
    expiresAt = issued.expiresAt;
  } else {
    url = recapLinkPath(plan.bookingId);
    expiresAt = new Date(now.getTime() + RECAP_TOKEN_MAX_AGE_MS);
  }
  const result = await sendAndRecordNotification(db, {
    kind: "readiness_link",
    purpose: plan.kind === "upcoming" ? "other_day" : "log_entry",
    bookingId: plan.bookingId,
    shopId: plan.shopId,
    to: plan.email,
    locale: plan.locale,
    diverName: plan.diverName,
    shopName: plan.shopName,
    tripTitle: plan.tripTitle,
    readinessUrl: new URL(url, `${plan.origin}/`).toString(),
    expiresAt,
    timezone: plan.timezone,
  });
  return result.status === "sent" ? "sent" : "failed";
}

/**
 * The most recent past dive day for a person, for find-my-booking's "only past
 * days" answer. Newest first; null when they have none.
 */
export async function latestDiveDayBooking(
  db: AppDb,
  input: { shopId: string; personId: string; now: Date },
): Promise<{ bookingId: string; title: string } | null> {
  const [row] = await db
    .select({ bookingId: bookings.id, title: trips.title })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.personId, input.personId),
        diveDay(),
        liveTrip(),
        lte(trips.startsAt, input.now),
      ),
    )
    .orderBy(desc(trips.startsAt), asc(trips.title), desc(bookings.id))
    .limit(1);
  return row ?? null;
}
