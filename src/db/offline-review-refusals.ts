import { and, eq, sql } from "drizzle-orm";
import { requireActiveStaffId } from "./authz";
import type { DbExecutor } from "./client";
import { offlineReviewRefusals } from "./schema";

/** Serialize all uses of a review confirmation ID before checking its outcome. */
export async function lockReviewConfirmation(
  db: DbExecutor,
  shopId: string,
  clientEventId: string,
) {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtext('offline_review_confirmation'), hashtext(${`${shopId.toLowerCase()}:${clientEventId.toLowerCase()}`}))`,
  );
  const [refusal] = await db
    .select({ clientEventId: offlineReviewRefusals.clientEventId })
    .from(offlineReviewRefusals)
    .where(
      and(
        eq(offlineReviewRefusals.shopId, shopId),
        eq(offlineReviewRefusals.clientEventId, clientEventId),
      ),
    )
    .limit(1);
  return Boolean(refusal);
}

/** A committed refusal permanently prevents this ID from becoming a live mark. */
export async function refuseReviewConfirmation(
  db: DbExecutor,
  shopId: string,
  clientEventId: string,
) {
  await db.insert(offlineReviewRefusals).values({ shopId, clientEventId }).onConflictDoNothing();
}

/** Authenticate before revealing whether a shared roll-call ID has been refused. */
export async function authorizeCrewRollCallId(
  db: DbExecutor,
  shopId: string,
  personId: string,
  clientEventId?: string,
) {
  const staffId = await requireActiveStaffId(db, shopId, personId);
  if (!staffId) return { ok: false as const, reason: "staff_not_found" as const };
  if (clientEventId && (await lockReviewConfirmation(db, shopId, clientEventId)))
    return { ok: false as const, reason: "client_event_conflict" as const };
  return { ok: true as const, staffId };
}
