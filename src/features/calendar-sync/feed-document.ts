import { type CalendarEvent, calendarDocument } from "@/lib/trip-calendar";
import { FEED_REFRESH_MINUTES } from "./feed-token";

/**
 * Turns the trips a feed covers into a subscribable calendar document. Pure:
 * every varying input — the clock, the origin, the translated labels — arrives
 * as an argument, so the whole document is testable byte for byte.
 */

/** One departure day as the feed publishes it. */
export type FeedTrip = {
  tripId: string;
  /** `null` for a single-day trip; the 1-based day number on a multi-day one. */
  dayNumber: number | null;
  title: string;
  courseTitle: string | null;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
  crew: readonly string[];
  /**
   * The trip's own `trips.revision`, published as RFC 5545 `SEQUENCE` (issue
   * #1165). Every day of a multi-day trip carries the same number, which is
   * right: moving `starts_at` shifts every one of them.
   */
  revision: number;
};

/**
 * The words in the document. Passed in rather than imported so this module
 * stays framework-free and so the feed speaks the shop's locale — a Cozumel
 * shop's captain should not get an English "Crew" line in their calendar.
 */
export type FeedLabels = {
  calendarName: string;
  crew: string;
  course: string;
  day: (dayNumber: number) => string;
};

/**
 * A UID must be stable for the life of the event and unique across the
 * subscriber's calendar. Derived from the trip's id (and day, for a multi-day
 * trip) — never from its title or times, which change.
 */
function feedEventUid(trip: FeedTrip): string {
  const day = trip.dayNumber === null ? "" : `-day-${trip.dayNumber}`;
  return `trip-${trip.tripId}${day}@diveday`;
}

function feedEvent(trip: FeedTrip, origin: string, shopSlug: string, labels: FeedLabels) {
  const summary =
    trip.dayNumber === null ? trip.title : `${trip.title} (${labels.day(trip.dayNumber)})`;
  const description = [
    trip.courseTitle ? `${labels.course}: ${trip.courseTitle}` : null,
    trip.crew.length > 0 ? `${labels.crew}: ${trip.crew.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    uid: feedEventUid(trip),
    title: summary,
    description: description || null,
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    location: trip.location,
    url: `${origin}/shop/${shopSlug}/trips/${trip.tripId}`,
    sequence: trip.revision,
  } satisfies CalendarEvent;
}

export function feedDocument(input: {
  trips: readonly FeedTrip[];
  origin: string;
  shopSlug: string;
  labels: FeedLabels;
  now: Date;
}): string {
  return calendarDocument({
    events: input.trips.map((trip) => feedEvent(trip, input.origin, input.shopSlug, input.labels)),
    stamp: input.now,
    name: input.labels.calendarName,
    refreshMinutes: FEED_REFRESH_MINUTES,
  });
}
