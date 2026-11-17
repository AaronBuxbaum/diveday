import type { TripChangeEvent } from "@/db/trip-change-events";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * **What changed, on the page that sells the seat** (issue #4389). To a
 * visitor who has not booked nothing changed: the page already shows the
 * current meeting point, and a "What changed" card on a page meant to invite
 * reads as trouble. A diver this page knows has booked (the embed's verified
 * confirmation) keeps the whole list; everyone else, whom the page cannot
 * tell apart, sees only what moved in the 24 hours before departure, when a
 * booked diver opening the public link from a message most needs it. Booked
 * divers keep every change on their own `/ready` page.
 */
export function publicChangeEvents(
  events: readonly TripChangeEvent[],
  booked: boolean,
  startsAt: Date,
): readonly TripChangeEvent[] {
  if (booked) return events;
  const from = startsAt.getTime() - DAY_MS;
  return events.filter((event) => event.occurredAt.getTime() >= from);
}
