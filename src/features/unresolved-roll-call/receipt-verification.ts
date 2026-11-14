import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { readActiveStaffRoles } from "@/db/authz";
import { lockBoardingCertificationEvidence } from "@/db/boarding-certification-snapshot";
import type { AppDb, DbExecutor } from "@/db/client";
import { publishManifestEvent } from "@/db/manifest-events";
import {
  existingRollCallClaim,
  lockRollCallClaimIdentities,
  type RollCallClaimInput,
} from "@/db/roll-call-claims";
import {
  accountSessions,
  bookings,
  people,
  personRoles,
  rollCallEventClaims,
  trips,
  unresolvedSafetyAlertOutbox,
  userAccounts,
} from "@/db/schema";
import { livePerson, liveTrip } from "@/db/trips";
import { nextOfflineManifestSnapshotRevision } from "@/features/offline-manifest-snapshots";
import { isStaff } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { STAFF_IDLE_LIMIT_MS } from "@/lib/session-idle";
import { canonicalRetainedValue, retainedObservationMatches } from "./intent-match";
import { unresolvedReviewAvailable } from "./review-availability";

async function ensureAlertObligation(
  db: DbExecutor,
  input: { shopId: string; tripId: string; claimId: string; generationId: string },
) {
  await db.insert(unresolvedSafetyAlertOutbox).values(input).onConflictDoNothing();
  const [row] = await db
    .select({
      shopId: unresolvedSafetyAlertOutbox.shopId,
      tripId: unresolvedSafetyAlertOutbox.tripId,
      claimId: unresolvedSafetyAlertOutbox.claimId,
    })
    .from(unresolvedSafetyAlertOutbox)
    .where(eq(unresolvedSafetyAlertOutbox.generationId, input.generationId));
  if (
    !row ||
    row.shopId !== input.shopId ||
    row.tripId !== input.tripId ||
    row.claimId !== input.claimId
  )
    throw new Error("Safety alert obligation mismatch");
}

/**
 * Prototype precondition only: no receipt is issued and no event is settled.
 * `recordedByPersonId` is the currently authenticated staff retrying the event;
 * a different staffer may retry. The original recorded actor remains the one
 * stored with the claim and must still exist in this shop without erasure.
 * Caller identity must come from the live server session, not request input.
 */
async function verifyRetainedObservation(
  db: AppDb,
  input: RollCallClaimInput,
  sessionId: string,
  persistReceipt: boolean,
) {
  if (!unresolvedReviewAvailable()) return { ok: false as const, reason: "unavailable" as const };
  return db.transaction(async (tx) => {
    // This shared shop lock serializes with subject/actor erasure and merge;
    // the identity lock serializes accepted and unresolved claims with this ID.
    await lockBoardingCertificationEvidence(tx, input.shopId, "boarding");
    await lockRollCallClaimIdentities(tx, input);
    // Lock the actual rows consulted by the uncached role check so removal or
    // account disable cannot commit between that check and transaction end.
    await tx
      .select({ id: people.id })
      .from(people)
      // diveday:allow-deleted-people: lock the caller before live authorization checks its status.
      .where(eq(people.id, input.recordedByPersonId))
      .for("share");
    await tx
      .select({ id: userAccounts.id })
      .from(userAccounts)
      .where(eq(userAccounts.personId, input.recordedByPersonId))
      .for("share");
    await tx
      .select({ role: personRoles.role })
      .from(personRoles)
      .where(eq(personRoles.personId, input.recordedByPersonId))
      .for("share");
    const now = nowDate();
    const [session] = await tx
      .select({ id: accountSessions.id })
      .from(accountSessions)
      .innerJoin(userAccounts, eq(userAccounts.id, accountSessions.userAccountId))
      .where(
        and(
          eq(accountSessions.id, sessionId),
          eq(accountSessions.personId, input.recordedByPersonId),
          eq(accountSessions.shopId, input.shopId),
          eq(userAccounts.personId, input.recordedByPersonId),
          eq(userAccounts.status, "active"),
          gt(accountSessions.expiresAt, now),
          gt(accountSessions.lastHumanActivityAt, new Date(now.getTime() - STAFF_IDLE_LIMIT_MS)),
        ),
      )
      .for("share");
    if (!session) return { ok: false as const, reason: "forbidden" as const };
    const roles = await readActiveStaffRoles(tx, input.shopId, input.recordedByPersonId);
    if (!roles || !isStaff(roles)) return { ok: false as const, reason: "forbidden" as const };
    const [claim] = await tx
      .select()
      .from(rollCallEventClaims)
      .where(
        and(
          eq(rollCallEventClaims.shopId, input.shopId),
          eq(rollCallEventClaims.tripId, input.tripId),
          eq(rollCallEventClaims.clientEventId, input.clientEventId),
        ),
      )
      .for("share");
    if (!claim || !retainedObservationMatches(input, claim))
      return { ok: false as const, reason: "unavailable" as const };
    const [trip] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(
        and(
          eq(trips.id, input.tripId),
          eq(trips.shopId, input.shopId),
          eq(trips.status, "scheduled"),
          liveTrip(),
        ),
      )
      .for("update");
    if (!trip) return { ok: false as const, reason: "unavailable" as const };
    const subject = input.subject;
    const [subjectPerson] =
      subject.kind === "seat"
        ? await tx
            .select({ id: people.id })
            .from(bookings)
            .innerJoin(people, eq(people.id, bookings.personId))
            .where(
              and(
                eq(bookings.id, subject.bookingId),
                eq(bookings.shopId, input.shopId),
                eq(bookings.tripId, input.tripId),
                eq(people.shopId, input.shopId),
                isNull(people.anonymizedAt),
                isNull(people.mergedIntoPersonId),
              ),
            )
            .for("share")
        : await tx
            .select({ id: people.id })
            .from(people)
            // diveday:allow-deleted-people: removed historical crew may still hold unresolved evidence; erased or merged people cannot.
            .where(
              and(
                eq(people.id, subject.personId),
                eq(people.shopId, input.shopId),
                isNull(people.anonymizedAt),
                isNull(people.mergedIntoPersonId),
              ),
            )
            .for("share");
    if (!subjectPerson) return { ok: false as const, reason: "unavailable" as const };
    const [actor] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.id, claim.unresolvedRecordedByPersonId as string),
          eq(people.shopId, input.shopId),
          isNull(people.anonymizedAt),
          isNull(people.mergedIntoPersonId),
          livePerson(),
        ),
      )
      .for("share");
    if (!actor) return { ok: false as const, reason: "unavailable" as const };
    // This independently verifies keyed complete intent/proof, including key
    // rotation and note disposition. An unavailable key or collision fails.
    const match = await existingRollCallClaim(tx, input);
    if (!match || ("ok" in match && (match.ok || match.reason !== "meeting_identity_unverified"))) {
      return { ok: false as const, reason: "unavailable" as const };
    }
    // Locks stop revocation writes, not the passage of time. This is a
    // point-in-time check immediately before leaving the transaction, not a
    // promise that the session stays live after commit or HTTP response.
    const checkedAt = nowDate();
    const [stillLive] = await tx
      .select({ id: accountSessions.id })
      .from(accountSessions)
      .where(
        and(
          eq(accountSessions.id, sessionId),
          gt(accountSessions.expiresAt, checkedAt),
          gt(
            accountSessions.lastHumanActivityAt,
            new Date(checkedAt.getTime() - STAFF_IDLE_LIMIT_MS),
          ),
        ),
      );
    if (!stillLive) return { ok: false as const, reason: "forbidden" as const };
    if (!persistReceipt) return { ok: true as const };
    // Notes may carry irreplaceable safety context and identifying detail.
    // Until their retention lifecycle is settled, do not mark a note-bearing
    // observation as preserved by the redacted safety-facts record.
    if (!input.occurredAt || input.note?.trim())
      return { ok: false as const, reason: "unavailable" as const };
    // Persist only after every check, while the claim and identity locks are
    // still held. The transaction commits before this value leaves the helper.
    // This internal prototype is not exposed as a handoff response.
    const safetyFacts = (receiptId: string) => ({
      version: 1 as const,
      receiptId,
      checkpoint: input.checkpoint ?? "departure",
      status: input.status,
      occurredAt: input.occurredAt?.toISOString(),
      meetingDay: input.meetingDay ?? null,
      observedEvidenceIds: input.observedEvidenceIds ?? null,
      retractsEventId: input.retractsEventId ?? null,
      retractsClientEventId: input.retractsClientEventId ?? null,
      reconcilesEvidence: input.reconcilesEvidence === true,
      noteRetained: false as const,
    });
    if (claim.handoffReceiptId && claim.handoffReceiptAt) {
      if (
        !claim.retainedSafetyEvidence ||
        canonicalRetainedValue(claim.retainedSafetyEvidence) !==
          canonicalRetainedValue(safetyFacts(claim.handoffReceiptId))
      )
        return { ok: false as const, reason: "unavailable" as const };
      await ensureAlertObligation(tx, {
        shopId: input.shopId,
        tripId: input.tripId,
        claimId: claim.id,
        generationId: claim.handoffReceiptId,
      });
      return {
        ok: true as const,
        receipt: { id: claim.handoffReceiptId, createdAt: claim.handoffReceiptAt },
        created: false as const,
      };
    }
    const receiptId = crypto.randomUUID();
    const [updated] = await tx
      .update(rollCallEventClaims)
      .set({
        reviewRevision: sql`gen_random_uuid()`,
        handoffReceiptId: receiptId,
        handoffReceiptAt: checkedAt,
        retainedSafetyEvidence: {
          ...safetyFacts(receiptId),
          occurredAt: input.occurredAt.toISOString(),
        },
      })
      .where(eq(rollCallEventClaims.id, claim.id))
      .returning({
        id: rollCallEventClaims.handoffReceiptId,
        createdAt: rollCallEventClaims.handoffReceiptAt,
      });
    if (!updated?.id || !updated.createdAt) throw new Error("Receipt persistence failed");
    // Commit the obligation with the fact. Dispatch remains disabled until
    // per-recipient retries, authorization and review are implemented.
    await ensureAlertObligation(tx, {
      shopId: input.shopId,
      tripId: input.tripId,
      claimId: claim.id,
      generationId: receiptId,
    });
    // The trip lock is already held; move the snapshot frontier in the same
    // transaction so a roster read before these facts cannot be saved as new.
    const revision = await nextOfflineManifestSnapshotRevision(tx, input.shopId, input.tripId);
    if (revision === null) throw new Error("Receipt trip disappeared");
    return {
      ok: true as const,
      receipt: { id: updated.id, createdAt: updated.createdAt },
      created: true as const,
    };
  });
}

/** Checks preconditions without changing the claim. */
export function verifyRetainedObservationForReceipt(
  db: AppDb,
  input: RollCallClaimInput,
  sessionId: string,
) {
  return verifyRetainedObservation(db, input, sessionId, false);
}

/** Disabled prototype: persist an idempotent receipt without settling a device event. */
export async function persistVerifiedHandoffReceipt(
  db: AppDb,
  input: RollCallClaimInput,
  sessionId: string,
) {
  const result = await verifyRetainedObservation(db, input, sessionId, true);
  if (result.ok && "receipt" in result && result.receipt) {
    if (result.created) await publishManifestEvent(db, input.shopId, input.tripId);
    return { ok: true as const, receipt: result.receipt };
  }
  return result;
}
