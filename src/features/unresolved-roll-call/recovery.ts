import { createHash } from "node:crypto";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import type { AppDb, AppTransaction } from "@/db/client";
import { boundLockWaits } from "@/db/lock-bounds";
import { rollCallEventClaims, trips } from "@/db/schema";
import { liveTrip } from "@/db/trips";
import { lockReviewAccess, reviewSessionStillLive } from "./review-access";
import { unresolvedReviewAvailable } from "./review-availability";
import { projectReviewObservation } from "./review-projection";
import { validReviewObservation } from "./review-validation";

const REVIEW_PAGE_SIZE = 50;
const REVIEW_FRONTIER_LIMIT = 5_000;

async function boundReviewTransaction(tx: AppTransaction) {
  await boundLockWaits(tx);
  await tx.execute(sql`set local statement_timeout = '5s'`);
}

/** Lists identifiers for a staff review, never an observation or an outcome.
 * A redacted fact remains a warning rather than a guessed subject. */
export async function listRetainedSafetyReviewEntries(
  db: AppDb,
  input: {
    shopId: string;
    staffPersonId: string;
    sessionId: string;
    tripId: string;
    cursor?: string;
    frontier?: string;
  },
) {
  if (!unresolvedReviewAvailable()) return { ok: false as const, reason: "unavailable" as const };
  return db.transaction(async (tx) => {
    await boundReviewTransaction(tx);
    if (!(await lockReviewAccess(tx, input)))
      return { ok: false as const, reason: "forbidden" as const };
    const [trip] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
      .limit(1)
      .for("share");
    if (!trip) return { ok: false as const, reason: "not_found" as const };
    const rows = await tx
      .select({
        id: rollCallEventClaims.id,
        clientEventId: rollCallEventClaims.clientEventId,
        state: rollCallEventClaims.state,
        observationPresent: sql<boolean>`${rollCallEventClaims.unresolvedObservation} is not null`,
      })
      .from(rollCallEventClaims)
      .where(
        and(
          eq(rollCallEventClaims.shopId, input.shopId),
          eq(rollCallEventClaims.tripId, input.tripId),
          isNotNull(rollCallEventClaims.retainedSafetyEvidence),
        ),
      )
      // diveday:allow-time-id-order: an opaque pagination cursor, not event chronology.
      .orderBy(asc(rollCallEventClaims.id))
      .limit(REVIEW_FRONTIER_LIMIT + 1);
    if (rows.length > REVIEW_FRONTIER_LIMIT)
      return { ok: false as const, reason: "too_many" as const };
    // Each page is checked against one bounded, single-statement projection.
    // A change anywhere in the index forces a restart rather than silently
    // missing an entry inserted before the cursor. This is not a receipt or
    // authority for a later decision.
    const frontier = createHash("sha256")
      .update(
        JSON.stringify(
          rows.map((row) => [row.id, row.clientEventId, row.state, row.observationPresent]),
        ),
      )
      .digest("hex");
    if (input.cursor && (!input.frontier || input.frontier !== frontier))
      return { ok: false as const, reason: "review_changed" as const };
    const start = input.cursor ? rows.findIndex((row) => row.id === input.cursor) + 1 : 0;
    if (input.cursor && start === 0)
      return { ok: false as const, reason: "review_changed" as const };
    const page = rows.slice(start, start + REVIEW_PAGE_SIZE);
    if (!(await reviewSessionStillLive(tx, input.sessionId)))
      return { ok: false as const, reason: "forbidden" as const };
    return {
      ok: true as const,
      entries: page.map((row) => ({
        clientEventId:
          row.state === "unresolved" && row.observationPresent ? row.clientEventId : null,
      })),
      frontier,
      nextCursor:
        rows.length > start + REVIEW_PAGE_SIZE ? (page[page.length - 1]?.id ?? null) : null,
    };
  });
}

/**
 * Point-in-time staff-authorized recovery lookup. This is an internal building
 * block, not a handoff receipt or a resolution: capture remains disabled and
 * the device must retain its pending observation. Callers must use the shop
 * and person from the authenticated session, never request-provided identity.
 */
export async function readUnresolvedRollCallObservation(
  db: AppDb,
  input: {
    shopId: string;
    staffPersonId: string;
    sessionId: string;
    tripId: string;
    clientEventId: string;
  },
) {
  if (!unresolvedReviewAvailable()) return { ok: false as const, reason: "unavailable" as const };
  return db.transaction(async (tx) => {
    await boundReviewTransaction(tx);
    if (!(await lockReviewAccess(tx, input)))
      return { ok: false as const, reason: "forbidden" as const };
    const [trip] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
      .limit(1)
      .for("share");
    if (!trip) return { ok: false as const, reason: "not_found" as const };
    const [claim] = await tx
      .select({
        clientEventId: rollCallEventClaims.clientEventId,
        reviewRevision: rollCallEventClaims.reviewRevision,
        tripId: rollCallEventClaims.tripId,
        subjectKind: rollCallEventClaims.subjectKind,
        bookingId: rollCallEventClaims.bookingId,
        crewPersonId: rollCallEventClaims.crewPersonId,
        reason: rollCallEventClaims.unresolvedReason,
        noteDisposition: rollCallEventClaims.noteDisposition,
        recordedByPersonId: rollCallEventClaims.unresolvedRecordedByPersonId,
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
      .limit(1)
      .for("share");
    if (!(await reviewSessionStillLive(tx, input.sessionId)))
      return { ok: false as const, reason: "forbidden" as const };
    // SQL NULL was excluded above; JSONB literal null is corrupt data and
    // must be preserved and reported as unreadable.
    if (!claim) return { ok: false as const, reason: "not_found" as const };
    const observation = validReviewObservation(claim.observation);
    if (!observation) return { ok: false as const, reason: "observation_unreadable" as const };
    // Review needs the recorded words, not signed meeting/erasure proofs,
    // snapshot credentials or the raw causal frontier. Counts do not verify
    // which observation a future decision should reference.
    return {
      ok: true as const,
      claim: { ...claim, observation: projectReviewObservation(observation) },
    };
  });
}
