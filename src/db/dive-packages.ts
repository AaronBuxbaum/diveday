import { and, asc, count, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  type DivePackageDefinition,
  entitlementExpiry,
  entitlementToSpend,
  packageOnSale,
  type SpendableEntitlement,
  spendableCount,
  spendableCountForTrip,
} from "@/lib/dive-packages";
import type { AppDb, DbExecutor } from "./client";
import { queryAll } from "./query-helpers";
import {
  divePackageEntitlements,
  divePackages,
  orderLineItems,
  orders,
  paymentDisputes,
  shops,
} from "./schema";

/**
 * Reading and writing the shop's prepaid packages
 * (ADR 20260822-a-package-is-entitlements-not-money). The rules live in
 * `src/lib/dive-packages.ts`; this is what puts rows behind them.
 */

/** The shop's live price list, oldest first — deleted products stay sold. */
export async function listDivePackages(db: DbExecutor, shopId: string) {
  return db
    .select()
    .from(divePackages)
    .where(and(eq(divePackages.shopId, shopId), isNull(divePackages.deletedAt)))
    .orderBy(asc(divePackages.createdAt), asc(divePackages.name), asc(divePackages.id));
}

/**
 * What a diver can buy online right now: the live price list less any package
 * whose end date has passed (`packageOnSale`). The public nav and the public
 * packages page both ask this, so a lapsed package never earns a tab.
 *
 * Empty while the shop has dive packages switched off (the Features page):
 * nothing is sold, and the dives divers already bought are still drawn from.
 */
export async function listPackagesOnSale(db: DbExecutor, shopId: string, now = nowDate()) {
  const [shop] = await db
    .select({ on: shops.divePackagesEnabled })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!shop?.on) return [];
  return (await listDivePackages(db, shopId)).filter((pkg) => packageOnSale(pkg, now));
}

export async function createDivePackage(
  db: AppDb,
  input: DivePackageDefinition & { shopId: string; name: string; createdByPersonId?: string },
) {
  const [row] = await db
    .insert(divePackages)
    .values({
      shopId: input.shopId,
      name: input.name,
      diveCount: input.diveCount,
      priceCents: input.priceCents,
      scope: input.scope,
      validUntil: input.validUntil,
      createdByPersonId: input.createdByPersonId,
    })
    .returning();
  return row ?? null;
}

/**
 * Stop selling a package. Soft, like every delete
 * (ADR 20260820-every-delete-is-soft) — and here the softness is not only a
 * convention: the entitlements already bought against this row reference it and
 * must outlive it. A diver who paid for ten dives does not lose them because
 * the shop stopped selling that product.
 */
export async function deleteDivePackage(db: AppDb, shopId: string, packageId: string) {
  const [row] = await db
    .update(divePackages)
    .set({ deletedAt: nowDate() })
    .where(and(eq(divePackages.id, packageId), eq(divePackages.shopId, shopId)))
    .returning();
  return row ?? null;
}

/**
 * Sell one package to one diver: N entitlement rows against the order they paid
 * on, each stamped with its own expiry.
 *
 * Per-row expiry rather than a lookup back through the package, so a later edit
 * to the product cannot retroactively shorten a package somebody already bought.
 */
export async function grantPackageEntitlements(
  db: DbExecutor,
  input: {
    shopId: string;
    packageId: string;
    personId: string;
    orderId: string;
    diveCount: number;
    validUntil: string | null;
    purchasedAt?: Date;
  },
) {
  const expiresAt = entitlementExpiry(input.validUntil);
  return db
    .insert(divePackageEntitlements)
    .values(
      Array.from({ length: input.diveCount }, () => ({
        shopId: input.shopId,
        packageId: input.packageId,
        personId: input.personId,
        orderId: input.orderId,
        expiresAt,
      })),
    )
    .returning();
}

/**
 * The order statuses under which a package's unspent dives still stand: the
 * money is held, or part of it is. A full refund (`refunded`) takes the unspent
 * dives back with it; a partial one leaves them, because a goodwill refund is
 * not a cancellation and the desk decides which it was. Reports' "dives owed"
 * reads the same list, so the liability and what a diver can spend agree.
 */
export const BACKED_PACKAGE_ORDER_STATUSES = ["paid", "partly_refunded"] as const;

/**
 * Whether the order an entitlement was bought on still backs it: paid or
 * partly refunded, and no card dispute on it lost. A lost dispute is money
 * Stripe took back without touching the order's status (ADR
 * 20261009-stripe-reversals-reach-diveday), so it is asked of the dispute rows;
 * an open one is not enough, since the shop may yet win it. Needs `orders`
 * joined on the entitlement's `order_id`.
 */
export function packageOrderStillBacks(): SQL {
  return and(
    inArray(orders.status, [...BACKED_PACKAGE_ORDER_STATUSES]),
    sql`not exists (select 1 from ${paymentDisputes} where ${paymentDisputes.orderId} = ${orders.id} and ${paymentDisputes.shopId} = ${orders.shopId} and ${paymentDisputes.status} = 'lost')`,
  ) as SQL;
}

/**
 * Every dive this diver holds that has not been spent, with its package's
 * scope — only while the order it was bought on still backs it
 * ({@link packageOrderStillBacks}). Nothing is deleted on a refund: the rows
 * stay as the record of what was sold, and simply stop being spendable.
 */
export async function listSpendableEntitlements(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<SpendableEntitlement[]> {
  const rows = await db
    .select({
      id: divePackageEntitlements.id,
      packageId: divePackageEntitlements.packageId,
      scope: divePackages.scope,
      expiresAt: divePackageEntitlements.expiresAt,
      consumedAt: divePackageEntitlements.consumedAt,
    })
    .from(divePackageEntitlements)
    .innerJoin(
      divePackages,
      and(
        eq(divePackages.id, divePackageEntitlements.packageId),
        eq(divePackages.shopId, divePackageEntitlements.shopId),
      ),
    )
    .innerJoin(
      orders,
      and(
        eq(orders.id, divePackageEntitlements.orderId),
        eq(orders.shopId, divePackageEntitlements.shopId),
      ),
    )
    .where(
      and(
        eq(divePackageEntitlements.shopId, shopId),
        eq(divePackageEntitlements.personId, personId),
        isNull(divePackageEntitlements.consumedAt),
        packageOrderStillBacks(),
      ),
    )
    .orderBy(
      asc(divePackageEntitlements.createdAt),
      asc(divePackages.name),
      asc(divePackageEntitlements.id),
    );
  return rows;
}

/**
 * How many unspent dives each of these people could put toward one departure,
 * in one read over the roster (issue #1697, H-20260916-unconfirmed-identity-withhold-cost). A person with none is
 * absent from the map.
 *
 * The roster's payment control reads it so a staffer about to take a fare can
 * see the package first: a fare already collected stands
 * (`settleConfirmedPackageCoverage` leaves it alone), so the line is there to
 * stop the situation arising, not to unwind it. The same backing rule as
 * {@link listSpendableEntitlements}, so a refunded or disputed package never
 * shows here.
 */
export async function spendableDivesForTrip(
  db: DbExecutor,
  shopId: string,
  personIds: readonly string[],
  trip: { courseId: string | null },
  now = nowDate(),
): Promise<Map<string, number>> {
  if (personIds.length === 0) return new Map();
  const rows = await db
    .select({
      personId: divePackageEntitlements.personId,
      id: divePackageEntitlements.id,
      packageId: divePackageEntitlements.packageId,
      scope: divePackages.scope,
      expiresAt: divePackageEntitlements.expiresAt,
      consumedAt: divePackageEntitlements.consumedAt,
    })
    .from(divePackageEntitlements)
    .innerJoin(
      divePackages,
      and(
        eq(divePackages.id, divePackageEntitlements.packageId),
        eq(divePackages.shopId, divePackageEntitlements.shopId),
      ),
    )
    .innerJoin(
      orders,
      and(
        eq(orders.id, divePackageEntitlements.orderId),
        eq(orders.shopId, divePackageEntitlements.shopId),
      ),
    )
    .where(
      and(
        eq(divePackageEntitlements.shopId, shopId),
        inArray(divePackageEntitlements.personId, [...personIds]),
        isNull(divePackageEntitlements.consumedAt),
        packageOrderStillBacks(),
      ),
    );

  const heldByPerson = new Map<string, SpendableEntitlement[]>();
  for (const { personId, ...entitlement } of rows) {
    const held = heldByPerson.get(personId);
    if (held) held.push(entitlement);
    else heldByPerson.set(personId, [entitlement]);
  }
  const counts = new Map<string, number>();
  for (const [personId, held] of heldByPerson) {
    const spendable = spendableCountForTrip(held, trip, now);
    if (spendable > 0) counts.set(personId, spendable);
  }
  return counts;
}

/** How many dives this diver can still spend — what both they and the shop ask. */
export async function countSpendableDives(
  db: DbExecutor,
  shopId: string,
  personId: string,
  now = nowDate(),
): Promise<number> {
  return spendableCount(await listSpendableEntitlements(db, shopId, personId), now);
}

/**
 * **"Package: 7 of 10 dives left"** on the diver record (fourth UX review,
 * item 20): the question a diver asks at the counter on day three, answered
 * where the staffer is already looking.
 *
 * "Of" counts the dives on the packages that still have one to spend, so a
 * finished package from two years ago does not turn "7 of 10" into "7 of 20".
 * The same backing rule as {@link listSpendableEntitlements}: a refunded or
 * lost-dispute package shows nothing. Null when there is nothing left.
 */
export async function diverPackageBalance(
  db: DbExecutor,
  shopId: string,
  personId: string,
  now = nowDate(),
): Promise<{ left: number; of: number } | null> {
  const rows = await db
    .select({
      orderId: divePackageEntitlements.orderId,
      expiresAt: divePackageEntitlements.expiresAt,
      consumedAt: divePackageEntitlements.consumedAt,
    })
    .from(divePackageEntitlements)
    .innerJoin(
      orders,
      and(
        eq(orders.id, divePackageEntitlements.orderId),
        eq(orders.shopId, divePackageEntitlements.shopId),
      ),
    )
    .where(
      and(
        eq(divePackageEntitlements.shopId, shopId),
        eq(divePackageEntitlements.personId, personId),
        packageOrderStillBacks(),
      ),
    );
  const byOrder = new Map<string, { left: number; of: number }>();
  for (const row of rows) {
    const tally = byOrder.get(row.orderId) ?? { left: 0, of: 0 };
    tally.of += 1;
    const spendable =
      row.consumedAt === null &&
      (row.expiresAt === null || row.expiresAt.getTime() > now.getTime());
    if (spendable) tally.left += 1;
    byOrder.set(row.orderId, tally);
  }
  let left = 0;
  let of = 0;
  for (const tally of byOrder.values()) {
    if (tally.left === 0) continue;
    left += tally.left;
    of += tally.of;
  }
  return left > 0 ? { left, of } : null;
}

/**
 * How many package dives this booking spent: one per planned tank (H-20261014-package-dive-is-a).
 * `/ready` says it beside the money ("Uses 2 package dives (3 left)"), so a
 * two-tank boat spending two is never a surprise.
 */
export async function countDivesSpentOnBooking(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(divePackageEntitlements)
    .where(
      and(
        eq(divePackageEntitlements.shopId, shopId),
        eq(divePackageEntitlements.bookingId, bookingId),
      ),
    );
  return Number(row?.total ?? 0);
}

/**
 * The two package numbers `/ready`'s Pay step says: what the diver still
 * holds (`countSpendableDives`) and what this booking used (H-20261014-package-dive-is-a).
 */
export async function packageDivesForBooking(
  db: DbExecutor,
  input: { shopId: string; personId: string; bookingId: string },
): Promise<{ left: number; usedHere: number }> {
  const [left, usedHere] = await queryAll(db, [
    () => countSpendableDives(db, input.shopId, input.personId),
    () => countDivesSpentOnBooking(db, input.shopId, input.bookingId),
  ]);
  return { left, usedHere };
}

/**
 * Spend one dive on a booking, or report that there was none to spend.
 *
 * **Takes the executor it is given**, because the caller is `bookSpot`'s
 * capacity transaction: the claim has to happen inside the same transaction as
 * the seat, or two concurrent bookings can read the same unused dive and both
 * try to take it. The booking transaction is the concurrency boundary, and
 * the `consumed_at is null` predicate on each update makes each claim atomic.
 *
 * Returns the entitlement it consumed, or null. Null is not a failure: it is a
 * diver with no covering dive left, and the booking pays the ordinary way.
 */
export async function consumeEntitlementForBooking(
  tx: DbExecutor,
  input: {
    shopId: string;
    personId: string;
    bookingId: string;
    trip: { courseId: string | null; plannedDives?: number };
    now?: Date;
  },
) {
  const rows = await consumeEntitlementsForBooking(tx, {
    ...input,
    trip: { ...input.trip, plannedDives: input.trip.plannedDives ?? 1 },
  });
  return rows[0] ?? null;
}

/** Spend up to one entitlement per planned tank, returning only what existed. */
export async function consumeEntitlementsForBooking(
  tx: DbExecutor,
  input: {
    shopId: string;
    personId: string;
    bookingId: string;
    trip: { courseId: string | null; plannedDives: number };
    now?: Date;
  },
) {
  const now = input.now ?? nowDate();
  const claimed: Array<typeof divePackageEntitlements.$inferSelect> = [];
  const [already] = await tx
    .select({ total: count() })
    .from(divePackageEntitlements)
    .where(
      and(
        eq(divePackageEntitlements.shopId, input.shopId),
        eq(divePackageEntitlements.bookingId, input.bookingId),
      ),
    );
  const countToConsume = Math.max(
    0,
    Math.trunc(input.trip.plannedDives) - Number(already?.total ?? 0),
  );
  for (let index = 0; index < countToConsume; index += 1) {
    const held = await listSpendableEntitlements(tx, input.shopId, input.personId);
    const chosen = entitlementToSpend(held, input.trip, now);
    if (!chosen) break;
    const [row] = await tx
      .update(divePackageEntitlements)
      .set({ bookingId: input.bookingId, consumedAt: now })
      .where(
        and(
          eq(divePackageEntitlements.id, chosen.id),
          eq(divePackageEntitlements.shopId, input.shopId),
          isNull(divePackageEntitlements.consumedAt),
        ),
      )
      .returning();
    if (row) claimed.push(row);
  }
  return claimed;
}

/**
 * Hand back every dive a booking consumed, when the booking goes away.
 *
 * Undoing a link, never crediting an amount — which is what makes this exact:
 * it cannot round, cannot drift, and cannot return more than it took. A booking
 * that consumed nothing returns nothing.
 */
export async function releaseEntitlementsForBooking(
  tx: DbExecutor,
  shopId: string,
  bookingId: string,
) {
  return tx
    .update(divePackageEntitlements)
    .set({ bookingId: null, consumedAt: null })
    .where(
      and(
        eq(divePackageEntitlements.shopId, shopId),
        eq(divePackageEntitlements.bookingId, bookingId),
      ),
    )
    .returning();
}

/** Number of package tanks already attached to each booking. */
export async function countConsumedEntitlementsForBookings(
  db: DbExecutor,
  shopId: string,
  bookingIds: string[],
) {
  const result = new Map<string, number>();
  if (bookingIds.length === 0) return result;
  const consumed = await db
    .select({ bookingId: divePackageEntitlements.bookingId, total: count() })
    .from(divePackageEntitlements)
    .where(
      and(
        eq(divePackageEntitlements.shopId, shopId),
        inArray(divePackageEntitlements.bookingId, bookingIds),
      ),
    )
    .groupBy(divePackageEntitlements.bookingId);
  for (const row of consumed) {
    if (row.bookingId) result.set(row.bookingId, Number(row.total));
  }
  return result;
}

/** Grant package lines only after their order is paid; safe to replay. */
export async function grantPackageEntitlementsForPaidOrder(
  db: DbExecutor,
  input: { shopId: string; orderId: string; purchasedAt?: Date },
) {
  const [order] = await db
    .select({ personId: orders.personId, status: orders.status })
    .from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.shopId, input.shopId)))
    .limit(1);
  if (order?.status !== "paid") return [];
  const lines = await db
    .select({ packageId: orderLineItems.packageId, quantity: orderLineItems.quantity })
    .from(orderLineItems)
    .where(
      and(
        eq(orderLineItems.shopId, input.shopId),
        eq(orderLineItems.orderId, input.orderId),
        eq(orderLineItems.kind, "dive_package"),
      ),
    );
  const granted = [];
  for (const line of lines) {
    if (!line.packageId) continue;
    const [pkg] = await db
      .select()
      .from(divePackages)
      .where(and(eq(divePackages.id, line.packageId), eq(divePackages.shopId, input.shopId)))
      .limit(1);
    if (!pkg) continue;
    const [existing] = await db
      .select({ id: divePackageEntitlements.id })
      .from(divePackageEntitlements)
      .where(
        and(
          eq(divePackageEntitlements.shopId, input.shopId),
          eq(divePackageEntitlements.orderId, input.orderId),
          eq(divePackageEntitlements.packageId, pkg.id),
        ),
      )
      .limit(1);
    if (existing) continue;
    granted.push(
      ...(await grantPackageEntitlements(db, {
        shopId: input.shopId,
        packageId: pkg.id,
        personId: order.personId,
        orderId: input.orderId,
        diveCount: pkg.diveCount * line.quantity,
        validUntil: pkg.validUntil,
        purchasedAt: input.purchasedAt,
      })),
    );
  }
  return granted;
}
