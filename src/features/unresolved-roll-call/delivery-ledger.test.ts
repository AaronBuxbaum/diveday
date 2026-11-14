import { eq, ne } from "drizzle-orm";
import { expect, it } from "vitest";
import { createPerson } from "@/db/people";
import {
  rollCallEventClaims,
  shops,
  unresolvedSafetyAlertDeliveries,
  unresolvedSafetyAlertOutbox,
} from "@/db/schema";
import { listStaff, upcomingTripsWithCounts } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  ensureSafetyReviewDelivery,
  finishSafetyReviewDelivery,
  markInterruptedSafetyReviewDelivery,
  startSafetyReviewDelivery,
} from "./delivery-ledger";

const ctx = fileScopedShopContext();

it("fences attempts per recipient and leaves interrupted sends uncertain", async () => {
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  const staff = await listStaff(db, shop.id);
  if (!trip || staff.length < 2) throw new Error("fixtures missing");
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
    .values({
      shopId: shop.id,
      tripId: trip.id,
      claimId: claim.id,
      generationId,
    })
    .returning({ id: unresolvedSafetyAlertOutbox.id });
  const [foreignShop] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(ne(shops.id, shop.id))
    .limit(1);
  if (!foreignShop) throw new Error("foreign shop missing");
  const foreignPerson = await createPerson(db, {
    shopId: foreignShop.id,
    fullName: "Foreign Owner",
    email: null,
    phone: null,
    origin: "counter",
  });
  await expect(
    ensureSafetyReviewDelivery(db, { outboxId: outbox.id, personId: foreignPerson.id }),
  ).rejects.toThrow("Safety review delivery could not be recorded");
  expect(
    await db
      .select()
      .from(unresolvedSafetyAlertDeliveries)
      .where(eq(unresolvedSafetyAlertDeliveries.outboxId, outbox.id)),
  ).toEqual([]);
  const target = { outboxId: outbox.id, personId: staff[0].person.id };
  const id = await ensureSafetyReviewDelivery(db, target);
  expect(await ensureSafetyReviewDelivery(db, target)).toBe(id);
  const other = await ensureSafetyReviewDelivery(db, { ...target, personId: staff[1].person.id });
  expect(other).not.toBe(id);
  const attempt = await startSafetyReviewDelivery(db, id);
  if (!attempt) throw new Error("attempt missing");
  expect(await startSafetyReviewDelivery(db, id)).toBeNull();
  expect(
    await finishSafetyReviewDelivery(db, {
      deliveryId: id,
      attemptId: crypto.randomUUID(),
      outcome: "delivered",
      providerMessageId: "x",
    }),
  ).toBe(false);
  expect(
    await finishSafetyReviewDelivery(db, {
      deliveryId: id,
      attemptId: attempt,
      outcome: "not_configured",
    }),
  ).toBe(true);
  const retried = await startSafetyReviewDelivery(db, id);
  if (!retried) throw new Error("retry missing");
  expect(retried).not.toBe(attempt);
  expect(
    await markInterruptedSafetyReviewDelivery(db, id, new Date(nowDate().getTime() + 1_000)),
  ).toBe(true);
  expect(await startSafetyReviewDelivery(db, id)).toBeNull();
  const [uncertain] = await db
    .select()
    .from(unresolvedSafetyAlertDeliveries)
    .where(eq(unresolvedSafetyAlertDeliveries.id, id));
  expect(uncertain).toMatchObject({ status: "uncertain", attemptId: retried, deliveredAt: null });
  expect(
    await finishSafetyReviewDelivery(db, {
      deliveryId: id,
      attemptId: retried,
      outcome: "delivered",
      providerMessageId: "late",
    }),
  ).toBe(true);
  const [stored] = await db
    .select()
    .from(unresolvedSafetyAlertDeliveries)
    .where(eq(unresolvedSafetyAlertDeliveries.id, id));
  expect(stored).toMatchObject({
    status: "delivered",
    attemptId: retried,
    providerMessageId: "late",
  });
  expect(await startSafetyReviewDelivery(db, id)).toBeNull();
  expect(await startSafetyReviewDelivery(db, other)).not.toBeNull();
});
