import type { DiverLocale } from "@/i18n/settings";
import { formatDayParts, formatTime } from "@/lib/format";
import { publicTripPath } from "@/lib/public-routes";
import { similarDepartures } from "@/lib/similar-departures";
import { spotsRemaining } from "@/lib/trips";
import { worthALook } from "@/lib/worth-a-look";
import type { publicTripRecord, readBookingPageWave } from "./booking-page-wave";

type PublicTrip = NonNullable<Awaited<ReturnType<typeof publicTripRecord>>>;
type Board = Awaited<ReturnType<typeof readBookingPageWave>>["board"];

/** Where the other boats' links point and how their days are worded. */
export type OtherBoatsWhere = {
  shopSlug: string;
  isEmbed: boolean;
  locale: DiverLocale;
  timeZone: string;
};

/**
 * **What else this shop is running, for a boat with no seats left** (issue
 * #1166, D06), off the one read of the shop's own board. Each row's day is
 * preformatted in the shop's own zone, like every other date the booking page
 * hands a client component.
 */
export function fullTripAlternatives(trip: PublicTrip, board: Board, where: OtherBoatsWhere) {
  return similarDepartures({
    full: { tripId: trip.id, courseId: trip.courseId, diveSiteId: trip.diveSiteId },
    candidates: board.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      startsAt: candidate.startsAt,
      courseId: candidate.courseId,
      diveSiteId: candidate.diveSiteId,
    })),
  }).map((row) => ({
    tripId: row.tripId,
    title: row.title,
    reason: row.reason,
    // Preformatted in the shop's own zone, like every other date this page
    // hands a client component.
    when: formatDayParts(row.startsAt, where.locale, where.timeZone),
    href: `${publicTripPath(where.shopSlug, row.tripId)}${where.isEmbed ? "?embed=1" : ""}`,
  }));
}

/**
 * **The right departure, not just the next open seat** (issue #1161, D01).
 *
 * Only for a boat a diver can still get on: a full one already stands
 * `TripFullSection` with D06's own list, and two lists of other boats on one
 * page is exactly the accretion ADR 20260904-reef-all-the-way-down bounds.
 */
export function worthALookList(
  trip: PublicTrip,
  board: Board,
  where: OtherBoatsWhere & { now: Date },
) {
  return worthALook({
    subject: {
      tripId: trip.id,
      courseId: trip.courseId,
      diveSiteId: trip.diveSiteId,
      difficultyLevel: trip.diveSite?.difficultyLevel ?? null,
      startsAt: trip.startsAt,
      seatsOpen: spotsRemaining(trip),
    },
    candidates: board.map((candidate) => ({
      tripId: candidate.id,
      title: candidate.title,
      courseId: candidate.courseId,
      diveSiteId: candidate.diveSiteId,
      difficultyLevel: candidate.diveSite?.difficultyLevel ?? null,
      startsAt: candidate.startsAt,
      seatsOpen: Math.max(candidate.capacity - candidate.booked, 0),
    })),
    timeZone: where.timeZone,
    now: where.now,
  }).map((row) => ({
    tripId: row.tripId,
    title: row.title,
    seatsOpen: row.seatsOpen,
    reason: row.reason,
    partOfDay: row.partOfDay,
    when: `${formatDayParts(row.startsAt, where.locale, where.timeZone).weekday} ${formatTime(row.startsAt, where.locale, where.timeZone)}`,
    href: `${publicTripPath(where.shopSlug, row.tripId)}${where.isEmbed ? "?embed=1" : ""}`,
  }));
}
