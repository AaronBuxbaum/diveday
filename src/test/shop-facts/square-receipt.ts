/** Historical receipt evidence after a local disconnect; no credentials or provider calls. */
import { and, eq, isNull } from "drizzle-orm";
import { recordCounterOrder } from "../../db/orders";
import { integrationSyncRecords, people, personRoles, userAccounts } from "../../db/schema";
import type { FactContext } from "./index";
import { FactRefused } from "./refusal";

export async function seedDisconnectedSquareReceipt({ db, shop, actorId, now }: FactContext) {
  // The fact context names any seeded person, not necessarily an authorized staff member.
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .innerJoin(userAccounts, eq(userAccounts.personId, people.id))
    .where(
      and(
        eq(people.shopId, shop.id),
        isNull(people.deletedAt),
        eq(personRoles.role, "owner"),
        eq(userAccounts.status, "active"),
      ),
    )
    .limit(1);
  if (!owner) throw new FactRefused("not_available");
  const purchase = await recordCounterOrder(db, {
    shopId: shop.id,
    personId: actorId,
    createdByPersonId: owner.id,
    collection: "card_machine",
    lineItems: [
      { kind: "merchandise", description: "Reef shirt", quantity: 1, unitAmountCents: 10000 },
    ],
  });
  if (!purchase.ok) throw new FactRefused("not_available");
  // A prior successful observation is a fixture fact, not a fresh provider request.
  const paymentId = "review-square-payment";
  const merchantId = `fixture-${purchase.order.id}`;
  await db.insert(integrationSyncRecords).values({
    shopId: shop.id,
    provider: "square",
    sourceType: "square_payment_receipt",
    sourceId: purchase.order.id,
    operation: "receipt",
    externalId: `sandbox:${merchantId}:${paymentId}`,
    receiptEvidence: {
      environment: "sandbox",
      merchantId,
      paymentId,
      locationId: "fixture-location",
      currency: purchase.order.currency,
      totalCents: 10000,
      tipCents: 0,
      refundedCents: 0,
      receiptNumber: "TEST",
    },
    lastSyncedAt: now,
    updatedAt: now,
  });
  return { orderId: purchase.order.id, paymentId };
}
