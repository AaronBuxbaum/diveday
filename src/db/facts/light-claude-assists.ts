import { and, asc, desc, eq, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/db/client";
import { bookings, people, shops, tripReviews, trips } from "@/db/schema";
import { seatNotCancelled } from "@/db/trips-queries";
import { armClaudeFixtures } from "@/lib/assists/e2e-fixtures";

export const claudeAssistsArgs = z.object({ review: z.boolean().optional() }).strict();

/**
 * **Claude's assists, lit on one private shop** (`claudeAssists`, ADR
 * 20261018-claude-assists), so the browser fleet can photograph an assist's
 * surface. Every shop the fleet mints is a demo, and a demo is dark by the
 * seam's own rule, so this clears the shop's `is_demo` and arms the canned
 * provider for it (`src/lib/assists/e2e-fixtures.ts`): its assists answer from
 * fixtures and nothing leaves the machine. The door's teardown disarms it and
 * drops the shop. A private shop's fact: the canonical fixture is shared.
 *
 * `review`: one commented review waiting for moderation, on a departure that
 * has sailed, so the review flags have a row to mark. A minted shop carries no
 * review history of its own.
 */
export async function lightClaudeAssists(
  db: AppDb,
  shopId: string,
  { review }: z.output<typeof claudeAssistsArgs>,
  now: Date,
) {
  await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shopId));
  armClaudeFixtures(shopId, true);
  if (review) await seedWaitingReview(db, shopId, now);
}

async function seedWaitingReview(db: AppDb, shopId: string, now: Date): Promise<void> {
  const [seat] = await db
    .select({ id: bookings.id, tripId: bookings.tripId, personId: bookings.personId })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .leftJoin(tripReviews, eq(tripReviews.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.shopId, shopId),
        lt(trips.startsAt, now),
        seatNotCancelled,
        isNull(tripReviews.id),
      ),
    )
    // Every seat on one departure shares its `startsAt`, and a booking id is a
    // random uuid per database, so the departure alone picked a different diver
    // each run (#2973). The name, then the id, is the same seat every time.
    .orderBy(desc(trips.startsAt), asc(people.fullName), asc(bookings.id))
    .limit(1);
  if (!seat?.personId) return;
  await db.insert(tripReviews).values({
    shopId,
    bookingId: seat.id,
    tripId: seat.tripId,
    personId: seat.personId,
    rating: 4,
    // i18n-exempt: a diver's own words, seeded for the browser fleet
    comment: "Lovely reef and a patient crew. Text me on 305 555 0199 when the night dive runs.",
  });
}
