import { eq, sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { accountSessions, rollCallEventClaims } from "@/db/schema";
import { upcomingTripsWithCounts } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createRetainedReviewSession } from "@/test/retained-safety-helpers";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { readUnresolvedRollCallObservation } from "./recovery";
import { deferUnresolvedReview } from "./review-decision";

vi.mock("./review-availability", () => ({
  unresolvedReviewAvailable: () => true,
  unresolvedDeferralAvailable: () => true,
}));
const ctx = fileScopedShopContext();

it("authorizes the session and preserves an unreadable observation without presenting a fabricated review", async () => {
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("trip missing");
  const staffPersonId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const sessionId = await createRetainedReviewSession(db, {
    shopId: shop.id,
    shopSlug: shop.slug,
    personId: staffPersonId,
  });
  const clientEventId = crypto.randomUUID();
  const snapshotId = crypto.randomUUID();
  const observation = {
    checkpoint: "after_dive_1",
    status: "not_boarded",
    occurredAt: nowDate().toISOString(),
    snapshotId,
    snapshotSavedAt: nowDate().toISOString(),
    meetingDay: 1,
    meetingProof: "proof",
    erasureToken: "token",
    observedEvidenceIds: [],
    retractsEventId: null,
    retractsClientEventId: null,
    reconcilesEvidence: false,
    note: "Seen in the water",
  };
  const [claim] = await db
    .insert(rollCallEventClaims)
    .values({
      shopId: shop.id,
      tripId: trip.id,
      clientEventId,
      state: "unresolved",
      subjectKind: "crew",
      crewPersonId: staffPersonId,
      intentFingerprint: "intent",
      proofFingerprint: "proof",
      keyFingerprint: "key",
      unresolvedReason: "meeting_identity_unverified",
      unresolvedRecordedByPersonId: staffPersonId,
      unresolvedObservation: observation,
    })
    .returning({ id: rollCallEventClaims.id });
  const input = { shopId: shop.id, tripId: trip.id, staffPersonId, sessionId, clientEventId };
  const result = await readUnresolvedRollCallObservation(db, input);
  expect(result).toMatchObject({
    ok: true,
    claim: { observation: { note: observation.note, observedEvidenceCount: 0 } },
  });
  expect(JSON.stringify(result)).not.toContain("token");
  if (!result.ok) throw new Error("review missing");
  const requestId = crypto.randomUUID();
  const decision = { ...input, reviewRevision: result.claim.reviewRevision, requestId };
  expect(await deferUnresolvedReview(db, decision)).toEqual({
    ok: true,
    deferred: true,
    duplicate: false,
  });
  expect(await deferUnresolvedReview(db, decision)).toEqual({
    ok: true,
    deferred: true,
    duplicate: true,
  });
  expect(
    await deferUnresolvedReview(db, { ...decision, reviewRevision: crypto.randomUUID() }),
  ).toEqual({ ok: false, reason: "request_conflict" });
  const [unsettled] = await db
    .select({
      state: rollCallEventClaims.state,
      observation: rollCallEventClaims.unresolvedObservation,
    })
    .from(rollCallEventClaims)
    .where(eq(rollCallEventClaims.id, claim.id));
  expect(unsettled).toEqual({ state: "unresolved", observation });
  expect(
    await deferUnresolvedReview(db, {
      ...decision,
      requestId: crypto.randomUUID(),
      reviewRevision: crypto.randomUUID(),
    }),
  ).toEqual({ ok: false, reason: "review_changed" });
  await db
    .update(rollCallEventClaims)
    .set({ reviewRevision: crypto.randomUUID() })
    .where(eq(rollCallEventClaims.id, claim.id));
  expect(await deferUnresolvedReview(db, decision)).toEqual({
    ok: false,
    reason: "review_changed",
  });
  const corrupt = { ...observation, status: "wrong" };
  await db
    .update(rollCallEventClaims)
    .set({ unresolvedObservation: corrupt })
    .where(eq(rollCallEventClaims.id, claim.id));
  expect(await readUnresolvedRollCallObservation(db, input)).toEqual({
    ok: false,
    reason: "observation_unreadable",
  });
  const [stillRetained] = await db
    .select({ observation: rollCallEventClaims.unresolvedObservation })
    .from(rollCallEventClaims)
    .where(eq(rollCallEventClaims.id, claim.id));
  expect(stillRetained.observation).toEqual(corrupt);
  await db
    .update(rollCallEventClaims)
    .set({ unresolvedObservation: false as never })
    .where(eq(rollCallEventClaims.id, claim.id));
  expect(await readUnresolvedRollCallObservation(db, input)).toEqual({
    ok: false,
    reason: "observation_unreadable",
  });
  const [stillScalar] = await db
    .select({ observation: rollCallEventClaims.unresolvedObservation })
    .from(rollCallEventClaims)
    .where(eq(rollCallEventClaims.id, claim.id));
  expect(stillScalar.observation).toBe(false);
  await db
    .update(rollCallEventClaims)
    .set({ unresolvedObservation: sql`'null'::jsonb` })
    .where(eq(rollCallEventClaims.id, claim.id));
  expect(await readUnresolvedRollCallObservation(db, input)).toEqual({
    ok: false,
    reason: "observation_unreadable",
  });
  const [stillJsonNull] = await db
    .select({
      isJsonNull: sql<boolean>`${rollCallEventClaims.unresolvedObservation} = 'null'::jsonb`,
    })
    .from(rollCallEventClaims)
    .where(eq(rollCallEventClaims.id, claim.id));
  expect(stillJsonNull.isJsonNull).toBe(true);
  await db.delete(accountSessions).where(eq(accountSessions.id, sessionId));
  expect(await readUnresolvedRollCallObservation(db, input)).toEqual({
    ok: false,
    reason: "forbidden",
  });
});
