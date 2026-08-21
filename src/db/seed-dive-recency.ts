import { and, eq, ne } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { bookings, people } from "./schema";

/**
 * **Two divers who said how long it has been** — the answers a crew member
 * reads on the roster before the boat sails (ADR
 * 20260821-currency-is-what-catches-people).
 *
 * Without this the currency question ships inert. `diveRecencyIsNotable` picks
 * out exactly two of the five bands, the roster renders those in warning tone,
 * and until a seeded booking carries one that treatment has only ever been seen
 * in jsdom — the same "green tests over a safeguard nobody has looked at" gap
 * `seed-self-declared.ts` was written to close for the self-declared card mark.
 *
 * **A column on seats that already exist, not new people.** Currency is a fact
 * about a booking, so unlike the self-declared joiners this cannot be seeded
 * beside the demo instead of inside it — the whole point is a name on a roster.
 * It is safe to write onto an asserted fixture precisely because it **gates
 * nothing**: no readiness blocker reads it, no admission decision reads it, no
 * head count moves. The only thing that changes on any surface is one advisory
 * line.
 *
 * **Two of them, and only one notable.** Tom has been out of the water for
 * years, which is the case the feature exists for; Priya dived this season,
 * which is what most of a roster looks like and is what keeps the warning
 * meaning something. A demo where every diver is a warning is a worse demo —
 * the argument `seed-front-desk.ts` makes at the row it deliberately seeds
 * `succeeded`.
 *
 * Matched by email rather than by position, so re-ordering an earlier scenario
 * cannot silently move which diver carries the answer. A name that is not there
 * is skipped rather than thrown on: this is additive demo colour, and it must
 * never be the reason a shop fails to seed.
 */
const ANSWERS = [
  { email: "tom.okafor@example.com", band: "over_five_years" as const },
  { email: "priya.sharma@example.com", band: "this_season" as const },
];

export async function seedDiveRecency(db: DbExecutor, shopId: string) {
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
      .set({ lastDivedBand: answer.band })
      .where(
        and(
          eq(bookings.shopId, shopId),
          eq(bookings.personId, person.id),
          ne(bookings.status, "cancelled"),
        ),
      );
  }
}
