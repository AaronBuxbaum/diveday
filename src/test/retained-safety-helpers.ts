import { and, eq, ne } from "drizzle-orm";
import { expect } from "vitest";
import type { AppDb } from "@/db/client";
import type { RollCallClaimInput } from "@/db/roll-call-claims";
import { accountSessions, trips, unresolvedSafetyAlertOutbox, userAccounts } from "@/db/schema";
import {
  cancelDeparturesBelowMinimum,
  listDeparturesAwaitingMinimumDecision,
} from "@/db/trips-minimum";
import { deleteTrip } from "@/db/trips-schedule";
import { listRetainedSafetyReviewEntries } from "@/features/unresolved-roll-call";
import { persistVerifiedHandoffReceipt } from "@/features/unresolved-roll-call/receipt-verification";
import { nowDate } from "@/lib/clock";

export async function createRetainedReviewSession(
  db: AppDb,
  input: { shopId: string; shopSlug: string; personId: string },
) {
  const [account] = await db
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .where(eq(userAccounts.personId, input.personId));
  if (!account) throw new Error("staff account missing");
  const [session] = await db
    .insert(accountSessions)
    .values({
      userAccountId: account.id,
      personId: input.personId,
      shopId: input.shopId,
      shopSlug: input.shopSlug,
      roles: ["owner"],
      name: "Staff",
      token: crypto.randomUUID(),
      expiresAt: new Date(nowDate().getTime() + 60_000),
    })
    .returning({ id: accountSessions.id });
  return session.id;
}

export async function createRetainedReviewLookup(
  db: AppDb,
  shop: { id: string; slug: string },
  staffPersonId: string,
  event: { tripId: string; clientEventId: string },
) {
  const sessionId = await createRetainedReviewSession(db, {
    shopId: shop.id,
    shopSlug: shop.slug,
    personId: staffPersonId,
  });
  return {
    shopId: shop.id,
    staffPersonId,
    sessionId,
    tripId: event.tripId,
    clientEventId: event.clientEventId,
  };
}

export async function checkRetainedReviewIndex(
  db: AppDb,
  input: RollCallClaimInput,
  sessionId: string,
  expectedClientEventId: string | null,
) {
  const scope = {
    shopId: input.shopId,
    staffPersonId: input.recordedByPersonId,
    sessionId,
    tripId: input.tripId,
  };
  const result = await listRetainedSafetyReviewEntries(db, scope);
  expect(result).toMatchObject({
    ok: true,
    entries: expect.arrayContaining([{ clientEventId: expectedClientEventId }]),
    nextCursor: null,
  });
  expect(
    await listRetainedSafetyReviewEntries(db, { ...scope, shopId: crypto.randomUUID() }),
  ).toEqual({ ok: false, reason: "forbidden" });
}

export async function checkAlertObligationRetry(
  db: AppDb,
  input: RollCallClaimInput,
  sessionId: string,
  receipt: { ok: true; receipt: { id: string; createdAt: Date } },
) {
  await checkRetainedReviewIndex(db, input, sessionId, input.clientEventId ?? null);
  const rows = await db
    .select()
    .from(unresolvedSafetyAlertOutbox)
    .where(eq(unresolvedSafetyAlertOutbox.generationId, receipt.receipt.id));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ shopId: input.shopId, tripId: input.tripId });
  await db
    .delete(unresolvedSafetyAlertOutbox)
    .where(eq(unresolvedSafetyAlertOutbox.id, rows[0].id));
  expect(await persistVerifiedHandoffReceipt(db, input, sessionId)).toEqual(receipt);
  expect(
    await db
      .select()
      .from(unresolvedSafetyAlertOutbox)
      .where(eq(unresolvedSafetyAlertOutbox.generationId, receipt.receipt.id)),
  ).toHaveLength(1);
  const [otherTrip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.shopId, input.shopId), ne(trips.id, input.tripId)))
    .limit(1);
  if (!otherTrip) throw new Error("other trip fixture missing");
  await db
    .update(unresolvedSafetyAlertOutbox)
    .set({ tripId: otherTrip.id })
    .where(eq(unresolvedSafetyAlertOutbox.generationId, receipt.receipt.id));
  await expect(persistVerifiedHandoffReceipt(db, input, sessionId)).rejects.toThrow(
    "Safety alert obligation mismatch",
  );
  await db
    .update(unresolvedSafetyAlertOutbox)
    .set({ tripId: input.tripId })
    .where(eq(unresolvedSafetyAlertOutbox.generationId, receipt.receipt.id));
}

export async function checkRetainedTripIsNotRemoved(db: AppDb, shopId: string, tripId: string) {
  expect(await deleteTrip(db, shopId, tripId)).toEqual({
    ok: false,
    reason: "unresolved_safety_evidence",
  });
  const [departure] = await db
    .update(trips)
    .set({ minimumBookings: 20, minimumDecisionHours: 24, capacity: 30, boatId: null })
    .where(eq(trips.id, tripId))
    .returning({ startsAt: trips.startsAt });
  const sweepTime = new Date(departure.startsAt.getTime() - 60 * 60 * 1000);
  expect(
    (await listDeparturesAwaitingMinimumDecision(db, { now: sweepTime })).map(
      (trip) => trip.tripId,
    ),
  ).toContain(tripId);
  const sweep = await cancelDeparturesBelowMinimum(db, { now: sweepTime });
  expect(sweep.cancelled.some((trip) => trip.tripId === tripId)).toBe(false);
  const [row] = await db.select({ status: trips.status }).from(trips).where(eq(trips.id, tripId));
  expect(row.status).toBe("scheduled");
}
