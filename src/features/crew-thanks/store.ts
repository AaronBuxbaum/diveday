import { and, asc, desc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { liveTrip } from "@/db/trips";
import type { AppDb, DbExecutor } from "../../db/client";
import { people, tripReviews, trips } from "../../db/schema/index";
import type { CrewThanksRuling } from "../../lib/reviews";

/**
 * **Thanks to the crew** (loop 5, row 6; glossary "Crew thanks"): the line a
 * diver can leave a crew member under their review. This file is the crew
 * side: what a crew member reads on their Today, and the staff hide.
 *
 * Three rules hold it. It is **the crew member's own**: the read is by their
 * person id and their shop, never a shop-wide list. It is **never the
 * diver's name**: the line is read without who wrote it, as a thank-you from
 * a diver. And **staff pass each one on first** (issue #4261,
 * `crew_thanks_ruling`): a thanks reaches the crew member's Today only once
 * staff passed it on from the review moderation queue, and one they held
 * stays with the shop's record. An erased diver's thanks is gone with their
 * review (`scrubReviews`).
 */

/** How far back Today looks for a thank-you, in days. */
export const CREW_THANKS_DAYS = 14;
/** The most thank-yous Today shows at once. */
export const CREW_THANKS_SHOWN = 2;

/** One thank-you as the crew member reads it; `text` is null for a one-tap thanks with no line. */
export type CrewThanksLine = { text: string | null; tripTitle: string; startsAt: Date };

/** The newest thank-yous staff passed on to this crew member since `since`, newest first. */
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
        eq(tripReviews.crewThanksRuling, "passed"),
        gte(tripReviews.createdAt, since),
        isNull(people.anonymizedAt),
        liveTrip(),
      ),
    )
    .orderBy(desc(tripReviews.createdAt), asc(trips.title), desc(tripReviews.id))
    .limit(CREW_THANKS_SHOWN);
  return rows;
}

export type RuleCrewThanksResult = true | "not_found";

/**
 * Pass one review's thanks on to the crew member it names, or hold it back.
 * Owner or manager only (the caller's gate); the actor and the moment are
 * recorded; the shop is the session's, so another shop's review id changes
 * nothing. A review with no thanks is `not_found`.
 */
export async function ruleCrewThanks(
  db: AppDb,
  shopId: string,
  reviewId: string,
  ruling: CrewThanksRuling,
  actorPersonId: string,
  at: Date,
): Promise<RuleCrewThanksResult> {
  const [row] = await db
    .update(tripReviews)
    .set({
      crewThanksRuling: ruling,
      crewThanksRuledAt: at,
      crewThanksRuledByPersonId: actorPersonId,
    })
    .where(
      and(
        eq(tripReviews.id, reviewId),
        eq(tripReviews.shopId, shopId),
        isNotNull(tripReviews.crewThanksPersonId),
      ),
    )
    .returning({ id: tripReviews.id });
  return row ? true : "not_found";
}
