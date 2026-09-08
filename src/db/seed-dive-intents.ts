import { and, eq } from "drizzle-orm";
import type { DiveIntent } from "@/lib/dive-intent";
import type { DbExecutor } from "./client";
import { bookings, people, trips } from "./schema";
import { demoTodayDepartureStart } from "./seed-clock";

/**
 * **Five divers on today's reef boat who said what would make their day** —
 * the one line the day station and the buddy-teams panel render from
 * `bookings.dive_intent` (ADR 20260821-currency-is-what-catches-people's
 * sibling; `src/lib/dive-intent.ts`).
 *
 * Without this the feature ships inert on the demo. `staffDiveIntentLine`
 * renders only for departures that carry at least one answer, so the seeded
 * shop showed the line nowhere — no screenshot, no visual baseline, and a
 * regression in it would be invisible to reg-suit.
 *
 * **Today's reef departure only.** The line is an aggregate over one boat, so
 * one departure carrying answers is enough to baseline it, and leaving the rest
 * silent keeps the ordinary state — a departure nobody answered on — in the
 * demo too. Five of the nine seats answer, in three distinct codes, two of them
 * with a count above one so the list formatter's conjunction is exercised.
 *
 * Tom Okafor's `easing_back` is deliberate rather than arbitrary: he is already
 * the seeded `over_five_years` recency diver, so the two answers agree with
 * each other instead of describing two different people in one row.
 *
 * Matched by email rather than by position, the way `seed-dive-recency.ts` is,
 * so re-ordering an earlier scenario cannot silently move which diver carries
 * an answer. A name that is not there is skipped rather than thrown on: this is
 * additive demo colour and must never be the reason a shop fails to seed.
 */
const REEF_TRIP_TITLE = "Two-Tank Reef — Molasses & French";

const ANSWERS: { email: string; intent: DiveIntent }[] = [
  { email: "tom.okafor@example.com", intent: "easing_back" },
  { email: "diego.alvarez@example.com", intent: "small_life" },
  { email: "sam.whitfield@example.com", intent: "small_life" },
  { email: "june.park@example.com", intent: "good_day" },
  { email: "ines.costa@example.com", intent: "good_day" },
];

export async function seedDiveIntents(db: DbExecutor, shopId: string) {
  // Title *and* instant. The title alone is not unique: the seeded history
  // replays the same reef departure across earlier weeks, so matching on it
  // resolves an arbitrary past board and the answers land where nobody looks.
  const [reef] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.title, REEF_TRIP_TITLE),
        eq(trips.startsAt, demoTodayDepartureStart()),
      ),
    )
    .limit(1);
  if (!reef) return;

  // Serial, never `Promise.all`: a drizzle transaction is one checked-out
  // client (`scripts/check-db-concurrency.mjs`).
  for (const answer of ANSWERS) {
    const [person] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shopId), eq(people.email, answer.email)))
      .limit(1);
    if (!person) continue;
    await db
      .update(bookings)
      .set({ diveIntent: answer.intent })
      .where(
        and(
          eq(bookings.shopId, shopId),
          eq(bookings.personId, person.id),
          // Scoped to the one departure, unlike `seedDiveRecency`, which is a
          // per-person answer and writes every seat that person holds. These
          // same divers also hold the wreck charter and three hold the night
          // dive, so without this the line would quietly appear on two other
          // manifests that were never meant to carry it.
          eq(bookings.tripId, reef.id),
        ),
      );
  }
}
