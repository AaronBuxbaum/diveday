import { and, asc, desc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import type { AppDb, DbExecutor } from "./client";
import { people, tripReviews, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **Thanks to the crew** (loop 5, row 6; glossary "Crew thanks"): the line a
 * diver can leave a crew member under their review. This file is the crew
 * side: what a crew member reads on their Today, and the staff hide.
 *
 * Three rules hold it. It is **the crew member's own**: the read is by their
 * person id and their shop, never a shop-wide list. It is **never the
 * diver's name**: the line is read without who wrote it, as a thank-you from
 * a diver. And **staff can hide one** (`crew_thanks_hidden_at`), which takes
 * it off the crew member's Today and keeps the words for the shop's record.
 * An erased diver's thanks is gone with their review (`scrubReviews`).
 */

/** How far back Today looks for a thank-you, in days. */
export const CREW_THANKS_DAYS = 14;
/** The most thank-yous Today shows at once. */
export const CREW_THANKS_SHOWN = 2;

export type CrewThanksLine = { text: string; tripTitle: string; startsAt: Date };

/** The newest visible thank-yous left for this crew member since `since`, newest first. */
export async function readCrewThanks(
  db: DbExecutor,
  shopId: string,
  crewPersonId: string,
  since: Date,
): Promise<CrewThanksLine[]> {
  const rows = await db
    .select({ text: tripReviews.crewThanks, tripTitle: trips.title, startsAt: trips.startsAt })
    .from(tripReviews)
    .innerJoin(trips, eq(trips.id, tripReviews.tripId))
    // diveday:allow-deleted-people: an erased diver's review already lost its thanks (scrubReviews).
    .innerJoin(people, eq(people.id, tripReviews.personId))
    .where(
      and(
        eq(tripReviews.shopId, shopId),
        eq(tripReviews.crewThanksPersonId, crewPersonId),
        isNotNull(tripReviews.crewThanks),
        isNull(tripReviews.crewThanksHiddenAt),
        gte(tripReviews.createdAt, since),
        isNull(people.anonymizedAt),
        liveTrip(),
      ),
    )
    .orderBy(desc(tripReviews.createdAt), asc(trips.title), desc(tripReviews.id))
    .limit(CREW_THANKS_SHOWN);
  return rows.flatMap((row) => (row.text ? [{ ...row, text: row.text }] : []));
}

export type SetCrewThanksHiddenResult = true | "not_found";

/**
 * Hide or show one review's thanks to the crew. Owner or manager only
 * (the caller's gate); the actor is recorded; the shop is the session's, so another shop's review id changes
 * nothing. A review with no thanks is `not_found`.
 */
export async function setCrewThanksHidden(
  db: AppDb,
  shopId: string,
  reviewId: string,
  hidden: boolean,
  actorPersonId: string,
  at: Date,
): Promise<SetCrewThanksHiddenResult> {
  const [row] = await db
    .update(tripReviews)
    .set({
      crewThanksHiddenAt: hidden ? at : null,
      crewThanksHiddenByPersonId: hidden ? actorPersonId : null,
    })
    .where(
      and(
        eq(tripReviews.id, reviewId),
        eq(tripReviews.shopId, shopId),
        isNotNull(tripReviews.crewThanks),
      ),
    )
    .returning({ id: tripReviews.id });
  return row ? true : "not_found";
}
