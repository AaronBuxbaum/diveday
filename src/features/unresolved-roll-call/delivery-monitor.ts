import { sql } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import {
  unresolvedSafetyAlertDeliveries,
  unresolvedSafetyAlertEscalations,
  unresolvedSafetyAlertOutbox,
  unresolvedSafetyAlertScan,
  unresolvedSafetyScanIncidents,
} from "@/db/schema";

/** A point-in-time operations reading, not proof that a recipient saw a notice.
 * Escalations are retained until an explicit recovery workflow handles them. */
export async function readSafetyDeliveryMonitor(db: AppDb) {
  const [row] = await db.transaction(async (tx) => {
    // A timed-out aggregate is an error, never a healthy or empty reading.
    // This bounds each database statement, not connection acquisition or the
    // entire transaction; those still need operational limits before enablement.
    await tx.execute(sql`set local statement_timeout = '5s'`);
    return tx
      .select({
        pending:
          sql<number>`(select count(*) from ${unresolvedSafetyAlertDeliveries} where ${unresolvedSafetyAlertDeliveries.status} = 'pending')`.mapWith(
            Number,
          ),
        sending:
          sql<number>`(select count(*) from ${unresolvedSafetyAlertDeliveries} where ${unresolvedSafetyAlertDeliveries.status} = 'sending')`.mapWith(
            Number,
          ),
        uncertain:
          sql<number>`(select count(*) from ${unresolvedSafetyAlertDeliveries} where ${unresolvedSafetyAlertDeliveries.status} = 'uncertain')`.mapWith(
            Number,
          ),
        escalations:
          sql<number>`(select count(*) from ${unresolvedSafetyAlertEscalations})`.mapWith(Number),
        incidents: sql<number>`(select count(*) from ${unresolvedSafetyScanIncidents})`.mapWith(
          Number,
        ),
        withoutDeliveryRecord:
          sql<number>`(select count(*) from ${unresolvedSafetyAlertOutbox} where not exists (select 1 from ${unresolvedSafetyAlertDeliveries} where ${unresolvedSafetyAlertDeliveries.outboxId} = ${unresolvedSafetyAlertOutbox.id}))`.mapWith(
            Number,
          ),
        scanExists: sql<boolean>`exists (select 1 from ${unresolvedSafetyAlertScan} where ${unresolvedSafetyAlertScan.name} = 'unresolved-safety')`,
        expiredLease: sql<boolean>`exists (select 1 from ${unresolvedSafetyAlertScan} where ${unresolvedSafetyAlertScan.name} = 'unresolved-safety' and ${unresolvedSafetyAlertScan.leaseId} is not null and ${unresolvedSafetyAlertScan.leaseUntil} < clock_timestamp())`,
      })
      .from(sql`(select 1) as monitor`);
  });
  if (!row) throw new Error("Safety delivery monitor unavailable");
  return {
    ...row,
    deliveryConfirmedByMonitor: false as const,
    progressVerified: false as const,
    // No completed-cycle watermark or recipient-frontier exists yet. A clear
    // ledger therefore cannot establish that every owner was considered.
    needsAttention: true as const,
    observedProblems:
      !row.scanExists ||
      row.expiredLease ||
      row.pending > 0 ||
      row.sending > 0 ||
      row.uncertain > 0 ||
      row.escalations > 0 ||
      row.incidents > 0 ||
      row.withoutDeliveryRecord > 0,
  };
}
