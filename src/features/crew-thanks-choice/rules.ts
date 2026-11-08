import { createHash } from "node:crypto";

/**
 * **What the recap's "thank someone" menu sends instead of a person id**
 * (issue #3912).
 *
 * The recap page is opened by anyone holding the diver's link, so it must not
 * hand out staff `people.id`s. Each crew option carries this value instead: a
 * digest of the departure and the crew member, which names one person on one
 * departure and says nothing about their id. The writer
 * (`submitTripReview`) recomputes it for each of the departure's crew and
 * takes the one that matches, so a crafted post naming a raw person id, or a
 * choice copied from another departure, matches nobody and is dropped.
 *
 * Not an index into the crew list: a crew change between the page render and
 * the post would shift an index onto someone else. Not a secret either: it is
 * an alias, and the writer's checks (same departure, same shop, not deleted)
 * stay the authority.
 */
export function crewThanksChoice(tripId: string, personId: string): string {
  return createHash("sha256")
    .update(`crew-thanks:${tripId}:${personId}`)
    .digest("base64url")
    .slice(0, 22);
}

/** A choice is 22 base64url characters; anything else is refused before any read. */
export function isCrewThanksChoice(value: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(value);
}
