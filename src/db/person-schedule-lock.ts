import { sql } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { boundLockWaits } from "./lock-bounds";

/**
 * Take before any trip, revision, party or person lock. A checked transfer must
 * not read another departure's old windows while a schedule edit is pending.
 */
export async function lockShopSchedule(tx: DbExecutor, shopId: string) {
  await boundLockWaits(tx);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('shop_schedule'), hashtext(${shopId}))`,
  );
}

/** Rail and undo writes may run together, but not through a schedule change. */
export async function lockShopScheduleShared(tx: DbExecutor, shopId: string) {
  await boundLockWaits(tx);
  await tx.execute(
    sql`select pg_advisory_xact_lock_shared(hashtext('shop_schedule'), hashtext(${shopId}))`,
  );
}

/** Serialize schedule-changing writes for one person within a shop. */
export async function lockPersonSchedule(tx: DbExecutor, shopId: string, personId: string) {
  await boundLockWaits(tx);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('person_schedule:' || ${shopId}), hashtext(${personId}))`,
  );
}

/** Party operations hold several person locks, so serialize them per shop first. */
export async function lockPartySchedule(tx: DbExecutor, shopId: string) {
  await boundLockWaits(tx);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('party_schedule'), hashtext(${shopId}))`,
  );
}
