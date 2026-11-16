import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { boats, cards, diveSites, people, tripDives, tripRequirements, trips } from "./schema";
import { at } from "./seed-clock";
import { HISTORY_DIVER_NAMES } from "./seed-history";

/** The historical cohort existed before their first booking and card review. */
export async function seedHistoryTimeline(
  db: DbExecutor,
  shopId: string,
  staffIds: readonly string[],
): Promise<void> {
  const cohort = await db
    .select({ id: people.id, fullName: people.fullName })
    .from(people)
    .where(and(eq(people.shopId, shopId), inArray(people.fullName, [...HISTORY_DIVER_NAMES])));
  for (const person of cohort) {
    const index = HISTORY_DIVER_NAMES.indexOf(person.fullName);
    // Keep their original cast ordering without consuming the shared seed tick.
    const createdAt = new Date(at(-500, 10).getTime() + index * 1_000);
    await db
      .update(people)
      .set({ createdAt })
      .where(and(eq(people.shopId, shopId), eq(people.id, person.id)));
  }
  if (cohort.length) {
    await db
      .update(cards)
      .set({ createdAt: at(-450, 15) })
      .where(
        and(
          eq(cards.shopId, shopId),
          eq(cards.kind, "level"),
          inArray(
            cards.personId,
            cohort.map((person) => person.id),
          ),
        ),
      );
  }
  // These are the stable demo staff who author the back-filled shop records.
  if (staffIds.length) {
    await db
      .update(people)
      .set({ createdAt: at(-501, 9) })
      .where(and(eq(people.shopId, shopId), inArray(people.id, [...staffIds])));
  }
  // The shop's own hulls and sites were in its register when those trips were planned.
  await db
    .update(boats)
    .set({ createdAt: at(-501, 9) })
    .where(eq(boats.shopId, shopId));
  await db
    .update(diveSites)
    .set({ createdAt: at(-501, 9) })
    .where(eq(diveSites.shopId, shopId));
  const history = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.description, "Sailed. Kept in the log for the shop's monthly numbers."),
      ),
    );
  if (history.length) {
    const ids = history.map((trip) => trip.id);
    await db
      .update(trips)
      .set({ createdAt: sql`${trips.startsAt} - interval '35 days'` })
      .where(inArray(trips.id, ids));
    await db
      .update(tripDives)
      .set({
        createdAt: sql`(select ${trips.createdAt} from ${trips} where ${trips.id} = ${tripDives.tripId})`,
      })
      .where(inArray(tripDives.tripId, ids));
    await db
      .update(tripRequirements)
      .set({
        createdAt: sql`(select ${trips.createdAt} from ${trips} where ${trips.id} = ${tripRequirements.tripId})`,
      })
      .where(inArray(tripRequirements.tripId, ids));
  }
}
