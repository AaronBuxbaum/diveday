import type { DiverLocale } from "@/i18n/settings";
import { formatDayParts, formatShortDate, formatTime } from "@/lib/format";
import { publicTripPath } from "@/lib/public-routes";
import { similarDepartures } from "@/lib/similar-departures";
import { spotsRemaining } from "@/lib/trips";
import { asksNoMoreThan, worthALook } from "@/lib/worth-a-look";
import type { publicTripRecord, readTripPage } from "../_lib/page-reads";

type PublicTrip = NonNullable<Awaited<ReturnType<typeof publicTripRecord>>>;
type Board = Awaited<ReturnType<typeof readTripPage>>["board"];

/** Where the other boats' links point and how their days are worded. */
export type OtherBoatsWhere = {
  shopSlug: string;
  isEmbed: boolean;
  locale: DiverLocale;
  timeZone: string;
};

/**
 * A session of a course that asks no card of its students (Discover Scuba,
 * Open Water): its reader may hold none, so another departure is offered only
 * when it is the same course (dive-domain review F3 of layer r4-1).
 */
function opensToUncertified(trip: PublicTrip): boolean {
  return trip.course?.minimumCertificationLevel === null;
}

/**
 * **What else this shop is running, for a boat with no seats left** (issue
 * #1166, D06), off the one read of the shop's own board. Each row's day is
 * preformatted in the shop's own zone, like every other date the booking page
 * hands a client component.
 *
 * The candidate pool is the storefront's own schedule reader with `hasSpace`,
 * so a departure offered here is one a diver can actually get onto, and a
 * private charter is never offered to the public. Bounded at 50 rather than
 * paged: `similarDepartures` needs a pool, not a page, and a shop whose next
 * matching departure is past the fiftieth is a shop the "find another trip"
 * link serves better anyway.
 */
export function fullTripAlternatives(trip: PublicTrip, board: Board, where: OtherBoatsWhere) {
  const ownCourseOnly = opensToUncertified(trip);
  return similarDepartures({
    // Its run, so next week's date of a full weekly boat is offered first
    // (fourth UX review, item 31).
    full: {
      tripId: trip.id,
      courseId: trip.courseId,
      diveSiteId: trip.diveSite?.id ?? null,
      seriesId: trip.seriesId,
      startsAt: trip.startsAt,
    },
    // Never a boat that asks more than the full one (fourth UX review, item 10),
    // and a first-timer's session is only offered its own course.
    candidates: board.departures
      .filter((candidate) => asksNoMoreThan(candidate.requirement, board.ceiling))
      .filter((candidate) => !ownCourseOnly || candidate.courseId === trip.courseId)
      .map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        startsAt: candidate.startsAt,
        courseId: candidate.courseId,
        diveSiteId: candidate.diveSite?.id ?? null,
        seriesId: candidate.seriesId,
      })),
  }).map((row) => ({
    tripId: row.tripId,
    title: row.title,
    reason: row.reason,
    // Preformatted in the shop's own zone, like every other date this page
    // hands a client component, and in the header's own words ("Sat, Oct 24"),
    // so the run line and this one read as one calendar.
    when: formatShortDate(row.startsAt, where.locale, where.timeZone),
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
      diveSiteId: trip.diveSite?.id ?? null,
      difficultyLevel: trip.diveSite?.difficultyLevel ?? null,
      startsAt: trip.startsAt,
      seatsOpen: spotsRemaining(trip),
      requirement: board.ceiling,
      opensToUncertified: opensToUncertified(trip),
    },
    candidates: board.departures.map((candidate) => ({
      tripId: candidate.id,
      title: candidate.title,
      courseId: candidate.courseId,
      diveSiteId: candidate.diveSite?.id ?? null,
      difficultyLevel: candidate.diveSite?.difficultyLevel ?? null,
      startsAt: candidate.startsAt,
      seatsOpen: Math.max(candidate.capacity - candidate.booked, 0),
      requirement: candidate.requirement,
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
