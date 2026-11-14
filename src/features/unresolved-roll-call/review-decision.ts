import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/db/client";
import { boundLockWaits } from "@/db/lock-bounds";
import { rollCallEventClaims, trips, unresolvedReviewDeferrals } from "@/db/schema";
import { liveTrip } from "@/db/trips";
import { lockReviewAccess, reviewSessionStillLive } from "./review-access";
import { unresolvedDeferralAvailable, unresolvedReviewAvailable } from "./review-availability";
import { validReviewObservation } from "./review-validation";

const inputIds = z.object({
  shopId: z.uuid(),
  staffPersonId: z.uuid(),
  sessionId: z.uuid(),
  tripId: z.uuid(),
  clientEventId: z.uuid(),
  reviewRevision: z.uuid(),
  requestId: z.uuid(),
});
type DeferInput = z.infer<typeof inputIds>;

/** Defer the displayed item only. This is not a receipt or a resolution; it
 * does not remove the observation, clear an alarm, or settle device work. */
export async function deferUnresolvedReview(db: AppDb, input: DeferInput) {
  if (!unresolvedReviewAvailable() || !unresolvedDeferralAvailable())
    return { ok: false as const, reason: "unavailable" as const };
  if (!inputIds.safeParse(input).success) return { ok: false as const, reason: "invalid" as const };
  return db.transaction(async (tx) => {
    await boundLockWaits(tx);
    await tx.execute(sql`set local statement_timeout = '5s'`);
    if (!(await lockReviewAccess(tx, input)))
      return { ok: false as const, reason: "forbidden" as const };
    // Same shop identity lock as the accepted/unresolved event writer.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('roll_call_event_claim'), hashtext(${input.shopId.toLowerCase()}))`,
    );
    const [trip] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
      .for("share");
    if (!trip) return { ok: false as const, reason: "not_found" as const };
    const [claim] = await tx
      .select({
        id: rollCallEventClaims.id,
        revision: rollCallEventClaims.reviewRevision,
        observation: rollCallEventClaims.unresolvedObservation,
      })
      .from(rollCallEventClaims)
      .where(
        and(
          eq(rollCallEventClaims.shopId, input.shopId),
          eq(rollCallEventClaims.tripId, input.tripId),
          eq(rollCallEventClaims.clientEventId, input.clientEventId),
          eq(rollCallEventClaims.state, "unresolved"),
          isNotNull(rollCallEventClaims.unresolvedObservation),
        ),
      )
      .for("update");
    const [previous] = await tx
      .select()
      .from(unresolvedReviewDeferrals)
      .where(
        and(
          eq(unresolvedReviewDeferrals.shopId, input.shopId),
          eq(unresolvedReviewDeferrals.requestId, input.requestId),
        ),
      );
    if (previous) {
      if (
        !claim ||
        previous.claimId !== claim.id ||
        previous.tripId !== input.tripId ||
        previous.actorPersonId !== input.staffPersonId ||
        previous.reviewRevision !== input.reviewRevision
      )
        return { ok: false as const, reason: "request_conflict" as const };
      if (claim.revision !== input.reviewRevision || !validReviewObservation(claim.observation))
        return { ok: false as const, reason: "review_changed" as const };
      if (!(await reviewSessionStillLive(tx, input.sessionId)))
        return { ok: false as const, reason: "forbidden" as const };
      return { ok: true as const, deferred: true as const, duplicate: true as const };
    }
    if (!claim || !validReviewObservation(claim.observation))
      return { ok: false as const, reason: "unavailable" as const };
    if (claim.revision !== input.reviewRevision)
      return { ok: false as const, reason: "review_changed" as const };
    await tx.insert(unresolvedReviewDeferrals).values({
      shopId: input.shopId,
      tripId: input.tripId,
      claimId: claim.id,
      actorPersonId: input.staffPersonId,
      reviewRevision: input.reviewRevision,
      requestId: input.requestId,
    });
    if (!(await reviewSessionStillLive(tx, input.sessionId)))
      throw new Error("Review session expired before defer commit");
    return { ok: true as const, deferred: true as const, duplicate: false as const };
  });
}
