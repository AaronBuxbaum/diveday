import { and, asc, desc, eq, isNull, lt } from "drizzle-orm";
import { DAY_MS, nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { departureNotes, reviewReplies, tripReviews, trips } from "./schema";
import { liveTrip, notRehearsal } from "./trips-live";

const HOUR_MS = 60 * 60 * 1000;

/**
 * **The shop's own voice in the demo**: the replies it writes under reviews and
 * the note it sends a departure's divers the evening before. A shop that has
 * been trading for a quarter has done both, and the pages that show them
 * (Reviews, a trip's Notes) otherwise open on their empty states.
 *
 * Adds only, and written with explicit instants taken from the rows they answer, so
 * no shared seed clock moves and nothing seeded earlier shifts.
 */
export async function seedShopVoice(db: DbExecutor, shopId: string, writerId: string) {
  const [alreadyReplied] = await db
    .select({ id: reviewReplies.id })
    .from(reviewReplies)
    .where(and(eq(reviewReplies.shopId, shopId), isNull(reviewReplies.deletedAt)))
    .limit(1);
  if (!alreadyReplied) {
    const reviews = await db
      .select({ id: tripReviews.id, rating: tripReviews.rating, createdAt: tripReviews.createdAt })
      .from(tripReviews)
      .where(and(eq(tripReviews.shopId, shopId), eq(tripReviews.isPublished, true)))
      // diveday:allow-time-id-order: seed picks the two oldest published reviews to answer; no ordered list is shown.
      .orderBy(asc(tripReviews.createdAt), asc(tripReviews.id))
      .limit(2);
    const answers = [
      // i18n-exempt: the shop's own words, like its tagline.
      "Thank you! The crew loved having you aboard. Come back when the lionfish are running and we will find you a spot on the Spiegel Grove.",
      // i18n-exempt: the shop's own words, as above.
      "Thanks for the kind words. We pass them to the whole crew. See you on the water.",
    ];
    if (reviews.length > 0) {
      await db.insert(reviewReplies).values(
        reviews.map((review, i) => ({
          shopId,
          reviewId: review.id,
          body: answers[i] ?? answers[0],
          writtenByPersonId: writerId,
          createdAt: new Date(review.createdAt.getTime() + 5 * HOUR_MS),
          updatedAt: new Date(review.createdAt.getTime() + 5 * HOUR_MS),
        })),
      );
    }
  }

  const [alreadyNoted] = await db
    .select({ id: departureNotes.id })
    .from(departureNotes)
    .where(eq(departureNotes.shopId, shopId))
    .limit(1);
  if (alreadyNoted) return;
  const [trip] = await db
    .select({ id: trips.id, startsAt: trips.startsAt })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        lt(trips.endsAt, new Date(nowDate().getTime() - DAY_MS)),
        notRehearsal(),
        liveTrip(),
      ),
    )
    // diveday:allow-time-id-order: seed picks one returned departure; no ordered list is shown.
    .orderBy(desc(trips.endsAt), desc(trips.id))
    .limit(1);
  if (!trip) return;
  await db.insert(departureNotes).values({
    shopId,
    tripId: trip.id,
    // i18n-exempt: a note the shop's staff typed to its divers.
    body: "Seas are calm for tomorrow. Meet at the dock at 7:30, bring a light layer for the ride back, and take your seasickness tablet tonight if you use one.",
    sentByPersonId: writerId,
    recipients: 8,
    delivered: 8,
    sentAt: new Date(trip.startsAt.getTime() - 14 * HOUR_MS),
  });
}
