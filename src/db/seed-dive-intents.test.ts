import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { staffDiveIntentLine } from "@/i18n/dive-intent-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import { diveIntentTally } from "@/lib/dive-intent";
import { seededShopContext } from "@/test/db";
import { bookings, trips } from "./schema";
import { demoTodayDepartureStart } from "./seed-clock";

/**
 * The seeded answers exist so the aggregate line has a visual baseline. What
 * has to hold for that to be true is narrow, and each half has failed before in
 * a sibling module:
 *
 * - the answers land on **today's reef departure and nowhere else**, because
 *   these same divers hold the wreck charter and the night dive, and the
 *   per-person shape `seed-dive-recency.ts` uses would have written all three;
 * - enough of them agree that the line renders a **conjunction**, not one item,
 *   since a single-answer board would leave the list formatter unphotographed;
 * - some seats stay **silent**, because a board where everyone answered is not
 *   the ordinary board and the empty state deserves to stay in the demo too.
 */
const REEF = "Two-Tank Reef — Molasses & French";

/**
 * Today's departure with this title, never merely the first one. The seeded
 * history replays these titles across earlier weeks, so a title-only lookup
 * reads an arbitrary past board — which is exactly the mistake the seed module
 * itself has to avoid, and the reason this helper matches on the instant too.
 */
async function intentsOn(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  shopId: string,
  title: string,
) {
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.title, title),
        eq(trips.startsAt, demoTodayDepartureStart()),
      ),
    )
    .limit(1);
  if (!trip) throw new Error(`expected today’s seeded departure "${title}"`);
  const rows = await db
    .select({ intent: bookings.diveIntent })
    .from(bookings)
    .where(and(eq(bookings.shopId, shopId), eq(bookings.tripId, trip.id)));
  return rows.map((row) => row.intent);
}

describe("the seeded dive intents", () => {
  it("puts answers on today's reef boat, and leaves some of its seats silent", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const answers = await intentsOn(db, shop.id, REEF);

    const answered = answers.filter((intent): intent is NonNullable<typeof intent> =>
      Boolean(intent),
    );
    expect(answered).toHaveLength(5);
    // A board nobody answered on is the ordinary board, so it stays in frame.
    expect(answers.length).toBeGreaterThan(answered.length);

    // Three codes, two of them held by more than one diver — which is what
    // makes the rendered line a list rather than a single item.
    expect(new Set(answered).size).toBe(3);
    expect(answered.filter((intent) => intent === "small_life")).toHaveLength(2);
    expect(answered.filter((intent) => intent === "good_day")).toHaveLength(2);
  });

  /**
   * The trap this file exists for. `seedDiveRecency` writes a per-person answer
   * to every seat that person holds; an intent belongs to one departure, and
   * these same nine divers are on the wreck charter while three are on the
   * night dive. Copying that module's where-clause verbatim would have put the
   * line on two other manifests silently.
   *
   * Asserted over the whole shop rather than by naming the other departures:
   * that way a scenario added later cannot quietly start carrying intents
   * without this failing.
   */
  it("writes to exactly one departure in the whole shop", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const rows = await db
      .select({ tripId: bookings.tripId, intent: bookings.diveIntent })
      .from(bookings)
      .where(eq(bookings.shopId, shop.id));

    const answered = rows.filter((row) => row.intent);
    expect(answered).toHaveLength(5);
    expect(new Set(answered.map((row) => row.tripId)).size).toBe(1);
  });

  /** The line the baselines are for actually renders, in the reader's words. */
  it("renders as one quiet aggregate that names nobody", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const answered = (await intentsOn(db, shop.id, REEF)).filter(Boolean);
    const line = staffDiveIntentLine(staffTranslator("en-US"), diveIntentTally(answered), "en-US");

    expect(line).toBeTruthy();
    expect(line).toContain("and");
    // Never a name: the line is a count per answer and nothing else.
    expect(line).not.toContain("Tom");
    expect(line).not.toContain("Okafor");
  });
});
