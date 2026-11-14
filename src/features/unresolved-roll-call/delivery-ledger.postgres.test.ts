import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  rollCallEventClaims,
  unresolvedSafetyAlertDeliveries,
  unresolvedSafetyAlertOutbox,
} from "@/db/schema";
import { seedDemo } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { listStaff, upcomingTripsWithCounts } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import {
  ensureSafetyReviewDelivery,
  finishSafetyReviewDelivery,
  markInterruptedSafetyReviewDelivery,
  startSafetyReviewDelivery,
} from "./delivery-ledger";

describePostgres("unresolved safety delivery attempt fences", () => {
  it("permits one concurrent attempt and retains a late confirmed success", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "history");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop fixture missing");
    const [trip] = await upcomingTripsWithCounts(pg.db, shop.id, new Date(0));
    const [staff] = await listStaff(pg.db, shop.id);
    if (!trip || !staff) throw new Error("trip or staff fixture missing");
    const generationId = crypto.randomUUID();
    const [claim] = await pg.db
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
    const [outbox] = await pg.db
      .insert(unresolvedSafetyAlertOutbox)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        claimId: claim.id,
        generationId,
      })
      .returning({ id: unresolvedSafetyAlertOutbox.id });
    const id = await ensureSafetyReviewDelivery(pg.db, {
      outboxId: outbox.id,
      personId: staff.person.id,
    });
    const gate = await holdRowLock(
      pg,
      sql`select id from ${unresolvedSafetyAlertDeliveries} where id = ${id} for update`,
    );
    const first = startSafetyReviewDelivery(pg.connect(), id);
    const second = startSafetyReviewDelivery(pg.connect(), id);
    try {
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    const attempts = (await Promise.all([first, second])).filter(
      (value): value is string => value !== null,
    );
    expect(attempts).toHaveLength(1);
    const attemptId = attempts[0];
    const gate2 = await holdRowLock(
      pg,
      sql`select id from ${unresolvedSafetyAlertDeliveries} where id = ${id} for update`,
    );
    const interrupted = markInterruptedSafetyReviewDelivery(
      pg.connect(),
      id,
      new Date(nowDate().getTime() + 1_000),
    );
    const sent = finishSafetyReviewDelivery(pg.connect(), {
      deliveryId: id,
      attemptId,
      outcome: "delivered",
      providerMessageId: "provider-accepted",
    });
    try {
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate2.release();
    }
    await Promise.all([interrupted, sent]);
    const [row] = await pg.db
      .select()
      .from(unresolvedSafetyAlertDeliveries)
      .where(eq(unresolvedSafetyAlertDeliveries.id, id));
    expect(row).toMatchObject({
      status: "delivered",
      attemptId,
      providerMessageId: "provider-accepted",
    });
    expect(await startSafetyReviewDelivery(pg.db, id)).toBeNull();
  });
});
