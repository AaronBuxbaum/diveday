import { expect, it } from "vitest";
import {
  rollCallEventClaims,
  unresolvedSafetyAlertDeliveries,
  unresolvedSafetyAlertEscalations,
  unresolvedSafetyAlertOutbox,
  unresolvedSafetyAlertScan,
  unresolvedSafetyScanIncidents,
} from "@/db/schema";
import { listStaff, upcomingTripsWithCounts } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { readSafetyDeliveryMonitor } from "./delivery-monitor";

const ctx = fileScopedShopContext();

it("reports uncertain sends, persisted escalation, missing generations and an expired lease without treating them as delivered", async () => {
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  const [staff] = await listStaff(db, shop.id);
  if (!trip || !staff) throw new Error("fixtures missing");
  const generationId = crypto.randomUUID();
  const [claim] = await db
    .insert(rollCallEventClaims)
    .values({
      shopId: shop.id,
      tripId: trip.id,
      clientEventId: crypto.randomUUID(),
      state: "erased",
    })
    .returning({ id: rollCallEventClaims.id });
  const [outbox] = await db
    .insert(unresolvedSafetyAlertOutbox)
    .values({ shopId: shop.id, tripId: trip.id, claimId: claim.id, generationId })
    .returning({
      id: unresolvedSafetyAlertOutbox.id,
      scanSequence: unresolvedSafetyAlertOutbox.scanSequence,
    });
  await db.insert(unresolvedSafetyAlertDeliveries).values({
    outboxId: outbox.id,
    personId: staff.person.id,
    status: "uncertain",
    attemptId: crypto.randomUUID(),
    attemptedAt: nowDate(),
  });
  await db
    .insert(unresolvedSafetyAlertEscalations)
    .values({ outboxId: outbox.id, kind: "uncertain" });
  await db.insert(unresolvedSafetyScanIncidents).values({
    outboxId: crypto.randomUUID(),
    generationId: crypto.randomUUID(),
    scanSequence: 99,
    shopId: shop.id,
    tripId: trip.id,
    claimId: claim.id,
  });
  await db
    .insert(unresolvedSafetyAlertScan)
    .values({ name: "unresolved-safety", leaseId: crypto.randomUUID(), leaseUntil: new Date(0) });
  expect(await readSafetyDeliveryMonitor(db)).toMatchObject({
    pending: 0,
    sending: 0,
    uncertain: 1,
    escalations: 1,
    incidents: 1,
    expiredLease: true,
    needsAttention: true,
  });
});

it("does not call a missing lease or an empty delivery ledger an all-clear", async () => {
  const state = await readSafetyDeliveryMonitor(ctx.db);
  expect(state.scanExists).toBe(false);
  expect(state.pending).toBe(0);
  expect(state.needsAttention).toBe(true);
  expect(state.deliveryConfirmedByMonitor).toBe(false);
  expect(state.progressVerified).toBe(false);
});
