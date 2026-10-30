import { and, asc, count, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { lensSlugFrom } from "@/lib/trip-lenses";
import type { AppDb } from "./client";
import { tripLenses, trips } from "./schema";
import { tripHasStandingSailedRollCall } from "./standing-sailed-roll-call";

export type TripLens = typeof tripLenses.$inferSelect;

/**
 * The shop's vocabulary, in the order it wrote it — which is also the order the
 * storefront's rail renders. There is deliberately no `position` column and no
 * reorder control: a shop that wants a different order writes its words in that
 * order, and a pair of arrows is a surface to maintain for a list of six.
 */
export async function listTripLenses(db: AppDb, shopId: string): Promise<TripLens[]> {
  return db
    .select()
    .from(tripLenses)
    .where(and(eq(tripLenses.shopId, shopId), isNull(tripLenses.deletedAt)))
    .orderBy(asc(tripLenses.createdAt), asc(tripLenses.name), asc(tripLenses.id));
}

/**
 * One live lens — the tenant check every write on a departure runs before it
 * stores an id that arrived on a form.
 */
export async function getTripLens(
  db: AppDb,
  shopId: string,
  lensId: string,
): Promise<TripLens | null> {
  const [lens] = await db
    .select()
    .from(tripLenses)
    .where(
      and(eq(tripLenses.shopId, shopId), eq(tripLenses.id, lensId), isNull(tripLenses.deletedAt)),
    )
    .limit(1);
  return lens ?? null;
}

/**
 * How many departures wear this word, for the confirm to say so before a shop
 * taps Delete.
 *
 * Counted rather than refused, the same call `countDeparturesByBoat` makes:
 * retiring a word the shop no longer uses is an ordinary thing, and with a soft
 * delete nothing is lost either way. A word nothing carries goes quietly.
 */
export async function countDeparturesByTripLens(
  db: AppDb,
  shopId: string,
): Promise<Map<string, number>> {
  // One read for the vocabulary, grouped by word (code review 2026-10-13b,
  // item 36). A word nothing carries is absent, and reads as 0.
  const rows = await db
    .select({ lensId: trips.lensId, departures: count(trips.id) })
    .from(trips)
    // diveday:allow-deleted-trips: count every non-cancelled trip and any
    // cancelled trip with standing diver or crew evidence that somebody sailed.
    // The confirm is telling the shop how much history this word is attached to.
    .where(
      and(
        eq(trips.shopId, shopId),
        isNotNull(trips.lensId),
        or(ne(trips.status, "cancelled"), tripHasStandingSailedRollCall(db)),
      ),
    )
    .groupBy(trips.lensId);
  return new Map(rows.flatMap((row) => (row.lensId ? [[row.lensId, row.departures]] : [])));
}

/**
 * Writes one word into the shop's vocabulary, deriving its slug from the live
 * words already there so the unique index cannot be the thing that refuses.
 */
export async function createTripLens(
  db: AppDb,
  shopId: string,
  name: string,
): Promise<TripLens | null> {
  const existing = await listTripLenses(db, shopId);
  const slug = lensSlugFrom(
    name,
    existing.map((lens) => lens.slug),
  );
  const [lens] = await db.insert(tripLenses).values({ shopId, name, slug }).returning();
  return lens ?? null;
}

/**
 * **The name moves; the slug does not.**
 *
 * A shop correcting "Easygoing reef" to "Easy reef" is fixing what a diver
 * reads, not republishing its URLs — and the link somebody shared yesterday
 * still has to land on the same list.
 */
export async function renameTripLens(
  db: AppDb,
  shopId: string,
  lensId: string,
  name: string,
): Promise<TripLens | null> {
  const [lens] = await db
    .update(tripLenses)
    .set({ name })
    .where(
      and(eq(tripLenses.shopId, shopId), eq(tripLenses.id, lensId), isNull(tripLenses.deletedAt)),
    )
    .returning();
  return lens ?? null;
}

/**
 * **Stamps, never removes** (ADR 20260820-every-delete-is-soft). The word on
 * screen is still "Delete".
 *
 * Every departure keeps its `lens_id`, so a past day still says which kind of
 * day it was — the whole reason the row survives. Already-stamped rows are left
 * alone, so the date keeps saying when the shop actually stopped using the word.
 */
export async function deleteTripLens(db: AppDb, shopId: string, lensId: string): Promise<boolean> {
  const result = await db
    .update(tripLenses)
    .set({ deletedAt: nowDate() })
    .where(
      and(eq(tripLenses.shopId, shopId), eq(tripLenses.id, lensId), isNull(tripLenses.deletedAt)),
    )
    .returning({ id: tripLenses.id });
  return result.length > 0;
}
