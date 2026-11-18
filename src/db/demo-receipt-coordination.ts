import { sql } from "drizzle-orm";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import type { DbExecutor } from "./client";
import { isDemoShopWithDemoOwnerOrCaptainAccount } from "./demo-account-guard";
import { isTransactionExecutor } from "./query-helpers";

/**
 * Proposed first step for an eventual coordinated demo reset. The caller must
 * pass a fresh transaction with no earlier shop, account, person, or booking
 * locks; this function cannot detect locks already taken by its caller.
 *
 * A true result is only the existing demo identity gate under these locks. It
 * is not authorization to delete or proof that a booking or device event is
 * preserved. Current reset, reap, revocation and older servers do not all use
 * this order, and the exclusive fence prevents prompt intake while held. No
 * production path calls this helper while the receipt contract is incomplete.
 */
export async function lockDemoResetEvidenceFirst(tx: DbExecutor, shopId: string): Promise<boolean> {
  if (!isTransactionExecutor(tx)) throw new Error("Coordinated demo gate requires a transaction");
  const isolation = await tx.execute(
    sql`select current_setting('transaction_isolation') as isolation`,
  );
  if ((isolation.rows[0] as { isolation: string } | undefined)?.isolation !== "read committed") {
    throw new Error("Coordinated demo gate requires a READ COMMITTED transaction");
  }
  await lockBoardingCertificationEvidence(tx, shopId, "rewrite");
  return isDemoShopWithDemoOwnerOrCaptainAccount(tx, shopId);
}
