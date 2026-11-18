import { sql } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { isTransactionExecutor } from "./query-helpers";

/**
 * Attempt the existing erasure/reset fence without waiting behind a rewrite.
 * This only coordinates participating writers. It is not authorization, a
 * durable receipt, a device acknowledgement, or a reset-preservation policy.
 * No production intake calls this while the receipt contract is incomplete.
 * Call before any person, booking, or schedule lock, then re-read live
 * authorization and subject state within the same READ COMMITTED transaction.
 */
export async function tryLockBoardingEvidenceForReceipt(
  tx: DbExecutor,
  shopId: string,
): Promise<boolean> {
  if (!isTransactionExecutor(tx)) throw new Error("Receipt fence requires a transaction");
  const isolation = await tx.execute(
    sql`select current_setting('transaction_isolation') as isolation`,
  );
  if ((isolation.rows[0] as { isolation: string } | undefined)?.isolation !== "read committed") {
    throw new Error("Receipt fence requires a READ COMMITTED transaction");
  }
  const result = await tx.execute(sql`select pg_try_advisory_xact_lock_shared(
    hashtext('boarding_certification_evidence'), hashtext(${shopId})) as acquired`);
  return (result.rows[0] as { acquired: boolean } | undefined)?.acquired === true;
}
