import { and, asc, eq, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  type DivePackageDefinition,
  entitlementExpiry,
  entitlementToSpend,
  type SpendableEntitlement,
  spendableCount,
} from "@/lib/dive-packages";
import type { AppDb, DbExecutor } from "./client";
import { divePackageEntitlements, divePackages } from "./schema";

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
    .orderBy(asc(divePackages.createdAt), asc(divePackages.id));
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
      validityDays: input.validityDays,
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
    validityDays: number | null;
    purchasedAt?: Date;
  },
) {
  const purchasedAt = input.purchasedAt ?? nowDate();
  const expiresAt = entitlementExpiry(input.validityDays, purchasedAt);
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
    .innerJoin(divePackages, eq(divePackages.id, divePackageEntitlements.packageId))
    .where(
      and(
        eq(divePackageEntitlements.shopId, shopId),
        eq(divePackageEntitlements.personId, personId),
        isNull(divePackageEntitlements.consumedAt),
      ),
    )
    .orderBy(asc(divePackageEntitlements.createdAt), asc(divePackageEntitlements.id));
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
 * try to take it. The partial unique index on `booking_id` is the backstop —
 * one seat can never hold two dives however the race resolves — and the
 * `consumed_at is null` predicate on the update is what makes the claim itself
 * atomic.
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
    trip: { courseId: string | null };
    now?: Date;
  },
) {
  const now = input.now ?? nowDate();
  const held = await listSpendableEntitlements(tx, input.shopId, input.personId);
  const chosen = entitlementToSpend(held, input.trip, now);
  if (!chosen) return null;
  const [claimed] = await tx
    .update(divePackageEntitlements)
    .set({ bookingId: input.bookingId, consumedAt: now })
    .where(
      and(
        eq(divePackageEntitlements.id, chosen.id),
        eq(divePackageEntitlements.shopId, input.shopId),
        // The claim's own atomicity: a row another transaction has already
        // taken no longer matches, so this update touches nothing and the
        // caller learns the dive was not spent.
        isNull(divePackageEntitlements.consumedAt),
      ),
    )
    .returning();
  return claimed ?? null;
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
  const [released] = await tx
    .update(divePackageEntitlements)
    .set({ bookingId: null, consumedAt: null })
    .where(
      and(
        eq(divePackageEntitlements.shopId, shopId),
        eq(divePackageEntitlements.bookingId, bookingId),
      ),
    )
    .returning();
  return released ?? null;
}
