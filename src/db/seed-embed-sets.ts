import { and, asc, eq, gt } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { embedSets, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **One named list the demo shop frames on its own website** (issue #1284):
 * "Beginner boats", the two reef two-tankers.
 *
 * The embed settings page is otherwise photographed with an empty card and a
 * blank create form, which shows the *shape* of the feature and none of the
 * thing itself — and the e2e spec would have to write a list before it could
 * frame one, which makes the read it is testing a test of its own write.
 *
 * **Adds only.** It selects departures the schedule scenarios already created
 * and writes one row of its own; nothing existing moves, no head count
 * changes, and a shop that somehow has no reef trip simply gets no list rather
 * than a failed seed. Additive demo colour is never the reason a shop fails to
 * seed.
 */
const SET_NAME = "Beginner boats";

/** How many departures the demo's list names, well inside `EMBED_SET_MAX`. */
const MEMBER_COUNT = 2;

export async function seedEmbedSets(db: DbExecutor, shopId: string, now: Date = nowDate()) {
  // **Upcoming, public and scheduled** — the same three facts the widget's own
  // read applies. A list naming a departure that has already sailed would draw
  // an empty widget in the demo, which is the one thing this scenario exists
  // to prevent.
  const boats = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        eq(trips.isPrivate, false),
        gt(trips.startsAt, now),
        liveTrip(),
      ),
    )
    .orderBy(asc(trips.startsAt))
    .limit(MEMBER_COUNT);
  if (boats.length === 0) return;

  await db.insert(embedSets).values({
    shopId,
    name: SET_NAME,
    kind: "trip",
    memberIds: boats.map((trip) => trip.id),
  });
}
