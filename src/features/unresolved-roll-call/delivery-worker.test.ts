import { and, eq, inArray } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import {
  personRoles,
  rollCallEventClaims,
  shops,
  unresolvedSafetyAlertDeliveries,
  unresolvedSafetyAlertOutbox,
} from "@/db/schema";
import { upcomingTripsWithCounts } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";

vi.mock("./review-availability", () => ({ unresolvedReviewAvailable: () => true }));
vi.mock("@/db/notifications", async (original) => ({
  ...(await original<typeof import("@/db/notifications")>()),
  sendNotification: vi.fn(),
}));
const { sendNotification } = await import("@/db/notifications");
const { dispatchUnresolvedSafetyReview } = await import("./delivery-worker");
const provider = { safetySingleAttemptAbortable: true as const, send: vi.fn() };
const ctx = fileScopedShopContext();
beforeEach(() => vi.mocked(sendNotification).mockReset());

it("does not dispatch without an explicitly single-attempt abortable provider", async () => {
  expect(await dispatchUnresolvedSafetyReview(ctx.db, crypto.randomUUID())).toEqual({
    status: "unavailable",
  });
  expect(sendNotification).not.toHaveBeenCalled();
});

async function obligation() {
  const { db, shop } = ctx;
  await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("trip missing");
  const generationId = crypto.randomUUID();
  const [claim] = await db
    .insert(rollCallEventClaims)
    .values({
      shopId: shop.id,
      tripId: trip.id,
      clientEventId: crypto.randomUUID(),
      state: "erased",
      retainedSafetyEvidence: {
        version: 1,
        receiptId: generationId,
        checkpoint: "after_dive_1",
        status: "not_boarded",
        occurredAt: nowDate().toISOString(),
        meetingDay: null,
        observedEvidenceIds: null,
        retractsEventId: null,
        retractsClientEventId: null,
        reconcilesEvidence: false,
        noteRetained: false,
      },
    })
    .returning({ id: rollCallEventClaims.id });
  const [outbox] = await db
    .insert(unresolvedSafetyAlertOutbox)
    .values({ shopId: shop.id, tripId: trip.id, claimId: claim.id, generationId })
    .returning({ id: unresolvedSafetyAlertOutbox.id });
  return { db, shop, trip, claim, outbox, generationId };
}

it("does not send when the retained generation no longer matches", async () => {
  const { db, claim, outbox } = await obligation();
  await db
    .update(rollCallEventClaims)
    .set({ retainedSafetyEvidence: null })
    .where(eq(rollCallEventClaims.id, claim.id));
  const result = await dispatchUnresolvedSafetyReview(db, outbox.id, provider);
  expect(result).toMatchObject({ status: "attempted", delivered: 0 });
  expect(sendNotification).not.toHaveBeenCalled();
});

it("sends a generic review notice once per active owner and generation", async () => {
  const { db, outbox, generationId } = await obligation();
  vi.mocked(sendNotification).mockResolvedValue({
    status: "sent",
    providerMessageId: "provider-accepted",
  });
  const first = await dispatchUnresolvedSafetyReview(db, outbox.id, provider);
  expect(first).toMatchObject({ status: "attempted", delivered: expect.any(Number), uncertain: 0 });
  if (first.status !== "attempted") throw new Error("worker did not attempt");
  expect(first.delivered).toBeGreaterThan(0);
  const calls = vi.mocked(sendNotification).mock.calls;
  expect(calls).toHaveLength(first.delivered);
  for (const [, notice, , options] of calls) {
    expect(notice).toMatchObject({ kind: "unresolved_safety_evidence", generationId });
    expect(notice).not.toHaveProperty("diveNumber");
    expect(notice).not.toHaveProperty("notBackAboard");
    expect(options).toEqual({ retryPolicy: "disabled", signal: expect.any(AbortSignal) });
  }
  await dispatchUnresolvedSafetyReview(db, outbox.id, provider);
  expect(sendNotification).toHaveBeenCalledTimes(first.delivered);
});

it("does not automatically resend an ambiguous provider failure", async () => {
  const { db, outbox } = await obligation();
  vi.mocked(sendNotification).mockResolvedValue({
    status: "failed",
    retryable: true,
    errorCode: "provider_error",
  });
  const first = await dispatchUnresolvedSafetyReview(db, outbox.id, provider);
  if (first.status !== "attempted") throw new Error("worker did not attempt");
  expect(first.uncertain).toBeGreaterThan(0);
  const sends = vi.mocked(sendNotification).mock.calls.length;
  const rows = await db
    .select()
    .from(unresolvedSafetyAlertDeliveries)
    .where(eq(unresolvedSafetyAlertDeliveries.outboxId, outbox.id));
  expect(rows.every((row) => row.status === "uncertain")).toBe(true);
  await dispatchUnresolvedSafetyReview(db, outbox.id, provider);
  expect(sendNotification).toHaveBeenCalledTimes(sends);
  await db.delete(personRoles).where(
    and(
      eq(personRoles.role, "owner"),
      inArray(
        personRoles.personId,
        rows.map((row) => row.personId),
      ),
    ),
  );
  expect(await dispatchUnresolvedSafetyReview(db, outbox.id, provider)).toMatchObject({
    status: "no_recipients",
    ledger: { uncertain: rows.length },
  });
});
