import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  type DivePackageDefinition,
  entitlementExpiry,
  entitlementToSpend,
  packageOnSale,
  type SpendableEntitlement,
  spendableCount,
} from "@/lib/dive-packages";
import type { AppDb, DbExecutor } from "./client";
import { divePackageEntitlements, divePackages, orderLineItems, orders } from "./schema";

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
 */
export async function listPackagesOnSale(db: DbExecutor, shopId: string, now = nowDate()) {
  return (await listDivePackages(db, shopId)).filter((pkg) => packageOnSale(pkg, now));
}

/**
 * Whether this shop sells packages at all.
 *
 * The register is **opt-in by presence**, the shape the gear register uses
 * (ADR 20260815-minimal-gear-register): a shop that has never defined one sees
 * no package UI anywhere, and defining the first turns it on. Every surface
 * asks this before rendering anything.
 */
export async function shopSellsPackages(db: DbExecutor, shopId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: divePackages.id })
    .from(divePackages)
    .where(and(eq(divePackages.shopId, shopId), isNull(divePackages.deletedAt)))
    .limit(1);
  return Boolean(row);
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

/** Every dive this diver holds that has not been spent, with its package's scope. */
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
    .where(
      and(
        eq(divePackageEntitlements.shopId, shopId),
        eq(divePackageEntitlements.personId, personId),
        isNull(divePackageEntitlements.consumedAt),
      ),
    )
    .orderBy(
      asc(divePackageEntitlements.createdAt),
      asc(divePackages.name),
      asc(divePackageEntitlements.id),
    );
  return rows;
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
 * Hand a dive back when its booking goes away.
 *
 * Undoing a link, never crediting an amount — which is what makes this exact:
 * it cannot round, cannot drift, and cannot return more than it took. A booking
 * that consumed nothing returns nothing.
 */
export async function releaseEntitlementForBooking(
  tx: DbExecutor,
  shopId: string,
  bookingId: string,
) {
  const released = await releaseEntitlementsForBooking(tx, shopId, bookingId);
  return released[0] ?? null;
}

/** Return every tank a booking consumed, preserving the exact rows. */
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
