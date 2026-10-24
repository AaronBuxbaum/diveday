import type { Trip } from "../_components/types";

/**
 * **The departure as the booking form sees it**: the facts the client
 * component reads (its seats, its dives, and its course's age and gas rules, and whether its fee includes the gear), and nothing else (security review, code review 2026-10-13
 * layer C, item 2).
 *
 * `getTripWithBooked` answers with the whole trip row joined to its dive site
 * and course: internal notes, crew-only fields, the boat's certificate. Handed
 * to a `"use client"` component, every one of those is serialized into the
 * public page's payload, whether or not the form draws it. Built field by
 * field, never by spread, so a column added to `trips` or `courses` later stays
 * on the server unless somebody names it here.
 */
export type BookingFormTrip = {
  capacity: number;
  booked: number;
  plannedDives: number;
  course: { minimumAge: number | null; nitroxCompatible: boolean; gearIncluded: boolean } | null;
};

export function bookingFormTrip(
  trip: Pick<Trip, "capacity" | "booked" | "plannedDives" | "course">,
): BookingFormTrip {
  return {
    capacity: trip.capacity,
    booked: trip.booked,
    plannedDives: trip.plannedDives,
    course: trip.course
      ? {
          minimumAge: trip.course.minimumAge,
          nitroxCompatible: trip.course.nitroxCompatible,
          gearIncluded: trip.course.gearIncluded,
        }
      : null,
  };
}
