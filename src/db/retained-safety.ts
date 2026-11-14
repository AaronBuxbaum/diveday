import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import type { DbExecutor } from "./client";
import {
  boardingObservations,
  rollCallEventClaims,
  unresolvedReviewDeferrals,
  unresolvedSafetyAlertEscalations,
  unresolvedSafetyAlertOutbox,
  unresolvedSafetyScanIncidents,
} from "./schema";

/** Trip-wide warning only: do not infer a person, meeting, or resolution. */
export async function retainedSafetyTripIds(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
): Promise<Set<string>> {
  if (tripIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ tripId: rollCallEventClaims.tripId })
    .from(rollCallEventClaims)
    .where(
      and(
        eq(rollCallEventClaims.shopId, shopId),
        inArray(rollCallEventClaims.tripId, [...tripIds]),
        isNotNull(rollCallEventClaims.retainedSafetyEvidence),
      ),
    );
  return new Set(rows.map((row) => row.tripId));
}

/** A shop-wide unresolved fact or delivery incident may be outside today's
 * stations, including an incident whose original trip is no longer live. */
export async function hasRetainedSafetyEvidence(db: DbExecutor, shopId: string): Promise<boolean> {
  return (await retainedSafetyShopWarnings(db, shopId)).evidence;
}

/** Includes delivery problems for trips outside the current day or removed. */
export async function hasRetainedSafetyAlertNeedsReview(
  db: DbExecutor,
  shopId: string,
): Promise<boolean> {
  return (await retainedSafetyShopWarnings(db, shopId)).alertNeedsReview;
}

/** Read both shop-wide warnings together, including incidents for removed trips. */
export async function retainedSafetyShopWarnings(db: DbExecutor, shopId: string) {
  const [row] = await db
    .select({
      claim: sql<boolean>`exists (select 1 from ${rollCallEventClaims} where ${rollCallEventClaims.shopId} = ${shopId} and ${rollCallEventClaims.retainedSafetyEvidence} is not null)`,
      incident: sql<boolean>`exists (select 1 from ${unresolvedSafetyScanIncidents} where ${unresolvedSafetyScanIncidents.shopId} = ${shopId})`,
      escalation: sql<boolean>`exists (select 1 from ${unresolvedSafetyAlertEscalations} inner join ${unresolvedSafetyAlertOutbox} on ${unresolvedSafetyAlertOutbox.id} = ${unresolvedSafetyAlertEscalations.outboxId} where ${unresolvedSafetyAlertOutbox.shopId} = ${shopId})`,
    })
    .from(sql`(select 1) as safety_warning_source`);
  const alertNeedsReview = row.incident || row.escalation;
  return { evidence: row.claim || alertNeedsReview, alertNeedsReview };
}

/** A durable delivery problem needs human review, even if the recipient later changes. */
export async function retainedSafetyAlertNeedsReview(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<boolean> {
  const [deliveryProblem] = await db
    .select({ id: unresolvedSafetyAlertEscalations.id })
    .from(unresolvedSafetyAlertEscalations)
    .innerJoin(
      unresolvedSafetyAlertOutbox,
      eq(unresolvedSafetyAlertOutbox.id, unresolvedSafetyAlertEscalations.outboxId),
    )
    .where(
      and(
        eq(unresolvedSafetyAlertOutbox.shopId, shopId),
        eq(unresolvedSafetyAlertOutbox.tripId, tripId),
      ),
    )
    .limit(1);
  if (deliveryProblem) return true;
  const [scanProblem] = await db
    .select({ id: unresolvedSafetyScanIncidents.id })
    .from(unresolvedSafetyScanIncidents)
    .where(
      and(
        eq(unresolvedSafetyScanIncidents.shopId, shopId),
        eq(unresolvedSafetyScanIncidents.tripId, tripId),
      ),
    )
    .limit(1);
  return Boolean(scanProblem);
}

/** Call inside the whole demo reset/reap transaction before its first write.
 * The exclusive shop fence blocks current capture and delivery writers while
 * the retained records are checked. Disconnected device evidence is unknown. */
export async function requireNoRetainedSafetyForDemoReset(tx: DbExecutor, shopId: string) {
  await lockBoardingCertificationEvidence(tx, shopId, "rewrite");
  const [claim] = await tx
    .select({ id: rollCallEventClaims.id })
    .from(rollCallEventClaims)
    .where(
      and(
        eq(rollCallEventClaims.shopId, shopId),
        or(
          eq(rollCallEventClaims.state, "unresolved"),
          isNotNull(rollCallEventClaims.retainedSafetyEvidence),
        ),
      ),
    )
    .limit(1);
  const [outbox] = await tx
    .select({ id: unresolvedSafetyAlertOutbox.id })
    .from(unresolvedSafetyAlertOutbox)
    .where(eq(unresolvedSafetyAlertOutbox.shopId, shopId))
    .limit(1);
  const [incident] = await tx
    .select({ id: unresolvedSafetyScanIncidents.id })
    .from(unresolvedSafetyScanIncidents)
    .where(eq(unresolvedSafetyScanIncidents.shopId, shopId))
    .limit(1);
  const [deferral] = await tx
    .select({ id: unresolvedReviewDeferrals.id })
    .from(unresolvedReviewDeferrals)
    .where(eq(unresolvedReviewDeferrals.shopId, shopId))
    .limit(1);
  // Every sighting and its client key is evidence, including resolved rows.
  // Intake does not yet share this fence; this check alone does not serialize
  // a reset racing a new sighting.
  const [sighting] = await tx
    .select({ id: boardingObservations.id })
    .from(boardingObservations)
    .where(eq(boardingObservations.shopId, shopId))
    .limit(1);
  if (claim || outbox || incident || deferral || sighting)
    throw new Error("Demo reset blocked by unresolved safety evidence");
}
