import { and, count, eq, gt, sql } from "drizzle-orm";
import { DAY_MS, HOUR_MS, nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import type { SetupReceiptOutcome } from "@/lib/setup-request-receipts";
import { SETUP_REQUESTS_PER_HOUR } from "@/lib/setup-requests";
import type { AppDb, DbExecutor } from "./client";
import { setupRequests } from "./schema";

/**
 * One short global lock makes both limits atomic across server instances (ADR
 * 20261021-setup-request-receipts). It ends before rendering or contacting SES.
 * Only an explicitly pending retained request can win; suppressed rows never
 * receive a claim timestamp and cannot prolong an address's cooldown.
 */
export async function claimSetupRequestReceipt(
  db: AppDb,
  id: string,
  at = nowDate(),
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('setup_request_receipt'))`);
    const [request] = await tx
      .select({ email: setupRequests.email, status: setupRequests.receiptStatus })
      .from(setupRequests)
      .where(eq(setupRequests.id, id));
    if (request?.status !== "pending") return false;
    const address = request.email.trim().toLowerCase();
    const [recentAddress] = await tx
      .select({ count: count() })
      .from(setupRequests)
      .where(
        and(
          eq(sql`lower(trim(${setupRequests.email}))`, address),
          gt(setupRequests.receiptClaimedAt, new Date(at.getTime() - DAY_MS)),
        ),
      );
    const [recentGlobal] = await tx
      .select({ count: count() })
      .from(setupRequests)
      .where(gt(setupRequests.receiptClaimedAt, new Date(at.getTime() - HOUR_MS)));
    const reason =
      (recentAddress?.count ?? 0) > 0
        ? "address_cooldown"
        : (recentGlobal?.count ?? 0) >= SETUP_REQUESTS_PER_HOUR
          ? "global_limit"
          : null;
    if (reason) {
      await tx
        .update(setupRequests)
        .set({ receiptStatus: "suppressed", receiptErrorCode: reason })
        .where(and(eq(setupRequests.id, id), eq(setupRequests.receiptStatus, "pending")));
      log("setup_request.receipt_outcome", "info", {
        requestId: id,
        state: "suppressed",
        errorCode: reason,
      });
      return false;
    }
    const claimed = await tx
      .update(setupRequests)
      .set({ receiptStatus: "claimed", receiptClaimedAt: at })
      .where(and(eq(setupRequests.id, id), eq(setupRequests.receiptStatus, "pending")))
      .returning({ id: setupRequests.id });
    return claimed.length === 1;
  });
}

/** Re-read only the retained address and locale immediately before making the envelope. */
export async function readClaimedSetupRequestReceipt(db: DbExecutor, id: string) {
  const [row] = await db
    .select({ email: setupRequests.email, locale: setupRequests.locale })
    .from(setupRequests)
    .where(and(eq(setupRequests.id, id), eq(setupRequests.receiptStatus, "claimed")));
  return row ? { email: row.email.trim().toLowerCase(), locale: row.locale } : null;
}

/** No retry, queue, or recovery path can move a terminal result back to pending. */
export async function finishSetupRequestReceipt(
  db: DbExecutor,
  id: string,
  outcome: SetupReceiptOutcome,
): Promise<void> {
  await db
    .update(setupRequests)
    .set({
      receiptStatus: outcome.status,
      receiptProviderMessageId: outcome.status === "accepted" ? outcome.providerMessageId : null,
      receiptErrorCode: outcome.status === "accepted" ? null : outcome.errorCode,
    })
    .where(and(eq(setupRequests.id, id), eq(setupRequests.receiptStatus, "claimed")));
}
