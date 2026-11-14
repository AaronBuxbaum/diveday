import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  hasRetainedSafetyAlertNeedsReview,
  hasRetainedSafetyEvidence,
  retainedSafetyShopWarnings,
} from "./retained-safety";
import {
  rollCallEventClaims,
  shops,
  trips,
  unresolvedSafetyAlertEscalations,
  unresolvedSafetyAlertOutbox,
  unresolvedSafetyScanIncidents,
} from "./schema";

const ctx = fileScopedShopContext();
it("keeps a shop warning for an incident whose outbox and trip no longer exist", async () => {
  const { db } = ctx;
  const [shop] = await db
    .insert(shops)
    .values({ name: "Safety test", slug: `safety-${crypto.randomUUID()}`, timezone: "UTC" })
    .returning({ id: shops.id });
  const [other] = await db
    .insert(shops)
    .values({ name: "Other", slug: `other-${crypto.randomUUID()}`, timezone: "UTC" })
    .returning({ id: shops.id });
  expect(await hasRetainedSafetyEvidence(db, shop.id)).toBe(false);
  await db.insert(unresolvedSafetyScanIncidents).values({
    outboxId: crypto.randomUUID(),
    generationId: crypto.randomUUID(),
    scanSequence: 1,
    shopId: shop.id,
    tripId: crypto.randomUUID(),
    claimId: crypto.randomUUID(),
  });
  expect(await hasRetainedSafetyEvidence(db, shop.id)).toBe(true);
  expect(await hasRetainedSafetyAlertNeedsReview(db, shop.id)).toBe(true);
  expect(await hasRetainedSafetyEvidence(db, other.id)).toBe(false);
  expect(await hasRetainedSafetyAlertNeedsReview(db, other.id)).toBe(false);
});

it("distinguishes retained facts from delivery problems and isolates shops", async () => {
  const { db } = ctx;
  const [shop, other] = await db
    .insert(shops)
    .values([
      { name: "Warnings", slug: `warnings-${crypto.randomUUID()}`, timezone: "UTC" },
      { name: "Other warnings", slug: `warnings-${crypto.randomUUID()}`, timezone: "UTC" },
    ])
    .returning();
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Earlier departure",
      startsAt: new Date("2025-01-01T09:00:00Z"),
      endsAt: new Date("2025-01-01T12:00:00Z"),
      capacity: 8,
    })
    .returning();
  const [claim] = await db
    .insert(rollCallEventClaims)
    .values({
      shopId: shop.id,
      tripId: trip.id,
      clientEventId: crypto.randomUUID(),
      state: "erased",
      retainedSafetyEvidence: {
        version: 1,
        receiptId: crypto.randomUUID(),
        checkpoint: "departure",
        status: "not_boarded",
        occurredAt: "2025-01-01T09:00:00.000Z",
        meetingDay: null,
        observedEvidenceIds: [],
        retractsEventId: null,
        retractsClientEventId: null,
        reconcilesEvidence: false,
        noteRetained: false,
      },
    })
    .returning();
  expect(await retainedSafetyShopWarnings(db, shop.id)).toEqual({
    evidence: true,
    alertNeedsReview: false,
  });
  expect(await retainedSafetyShopWarnings(db, other.id)).toEqual({
    evidence: false,
    alertNeedsReview: false,
  });
  const [outbox] = await db
    .insert(unresolvedSafetyAlertOutbox)
    .values({
      shopId: shop.id,
      tripId: trip.id,
      claimId: claim.id,
      generationId: crypto.randomUUID(),
    })
    .returning();
  await db
    .insert(unresolvedSafetyAlertEscalations)
    .values({ outboxId: outbox.id, kind: "pending" });
  expect(await retainedSafetyShopWarnings(db, shop.id)).toEqual({
    evidence: true,
    alertNeedsReview: true,
  });
  await db
    .update(rollCallEventClaims)
    .set({ retainedSafetyEvidence: null })
    .where(eq(rollCallEventClaims.id, claim.id));
  expect(await retainedSafetyShopWarnings(db, shop.id)).toEqual({
    evidence: true,
    alertNeedsReview: true,
  });
  expect(await retainedSafetyShopWarnings(db, other.id)).toEqual({
    evidence: false,
    alertNeedsReview: false,
  });
});
