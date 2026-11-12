import { and, count, eq, isNull, sql } from "drizzle-orm";
import { cache } from "react";
import type { AppDb } from "./client";
import { courses, gearItems, orders, shops, trips, workOrders } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **The shop's rarely-changing facts, read once per staff render** (issue #4395).
 *
 * A staff render used to pay one statement each for whether the shop has a departure, has ever
 * taken an order, teaches, keeps a fleet or a bench, from the chrome and from Today alike, on a pool of ten connections. These are
 * existence and count facts, so they come back in one statement, and `cache()` shares it between
 * the layout's chrome and the page for the length of a render.
 *
 * Nothing in here is an authorization gate. `canPersonViewShopReports` and the other live gates
 * stay their own reads on purpose (issue #1930), and the Stripe account stays a separate cached
 * read because callers need the row, not a flag.
 */
export type ShopRenderFacts = {
  /** Live departures, past and future: the first-run checklist's gate. */
  tripCount: number;
  /** Any order at all, ever: the setup ledger's payments row. */
  everTakenAnOrder: boolean;
  /** Any active course: whether Courses is a row in the nav. */
  hasActiveCourses: boolean;
  /** Live rental units. */
  gearItemCount: number;
  /** Live work orders (the bench). */
  workOrderCount: number;
};

async function readShopRenderFacts(db: AppDb, shopId: string): Promise<ShopRenderFacts> {
  const tripCount = db
    .select({ n: count() })
    .from(trips)
    .where(and(eq(trips.shopId, shopId), liveTrip()));
  const anyOrder = db.select({ one: sql`1` }).from(orders).where(eq(orders.shopId, shopId));
  const anyCourse = db
    .select({ one: sql`1` })
    .from(courses)
    .where(and(eq(courses.shopId, shopId), eq(courses.isActive, true)));
  const gearCount = db
    .select({ n: count() })
    .from(gearItems)
    .where(and(eq(gearItems.shopId, shopId), isNull(gearItems.deletedAt)));
  const workOrderCount = db
    .select({ n: count() })
    .from(workOrders)
    .where(and(eq(workOrders.shopId, shopId), isNull(workOrders.deletedAt)));
  const [row] = await db
    .select({
      tripCount: sql<number>`(${tripCount})`.mapWith(Number),
      everTakenAnOrder: sql<boolean>`exists (${anyOrder})`,
      hasActiveCourses: sql<boolean>`exists (${anyCourse})`,
      gearItemCount: sql<number>`(${gearCount})`.mapWith(Number),
      workOrderCount: sql<number>`(${workOrderCount})`.mapWith(Number),
    })
    .from(shops)
    .where(eq(shops.id, shopId));
  if (!row) throw new Error(`shop render facts: no shop ${shopId}`);
  return row;
}

/**
 * Memoized for one React render, per shop. `db` is compared by identity and is one object per
 * request. Whether a person closed the orientation is theirs, not the shop's, and stays its own
 * read (`isOrientationDismissed`).
 */
export const shopRenderFacts = cache(
  (db: AppDb, shopId: string): Promise<ShopRenderFacts> => readShopRenderFacts(db, shopId),
);
