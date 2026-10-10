import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { PaymentSourceLookup } from "@/lib/payments/payment-sources";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import {
  type DisputeEvent,
  listOpenPaymentDisputes,
  recordStripeDispute,
} from "./payment-disputes";
import { orders, paymentDisputes, people, shops } from "./schema";

const ctx = fileScopedShopContext();

/** Stripe says the charge is nothing DiveDay raised. Records every question. */
function lookupAnsweringNone() {
  const calls: Array<[string, string]> = [];
  const lookup: PaymentSourceLookup = {
    async findSource(account, paymentIntentId) {
      calls.push([account, paymentIntentId]);
      return { status: "none" };
    },
  };
  return { lookup, calls };
}

async function paidOrder(
  db: AppDb,
  shopId: string,
  { account, paymentIntentId }: { account: string; paymentIntentId: string },
) {
  const [person] = await db.select().from(people).where(eq(people.shopId, shopId)).limit(1);
  const personId =
    person?.id ??
    (
      await db
        .insert(people)
        .values({ shopId, fullName: "Odette Other", email: "odette.other@example.com" })
        .returning({ id: people.id })
    )[0]?.id;
  if (!personId) throw new Error("person missing");
  const [order] = await db
    .insert(orders)
    .values({
      shopId,
      personId,
      createdByPersonId: personId,
      status: "paid",
      currency: "usd",
      totalCents: 12_000,
      amountPaidCents: 12_000,
      stripeAccountId: account,
      stripeCustomerId: "cus_dispute",
      stripeInvoiceId: `in_${paymentIntentId}`,
      stripePaymentIntentId: paymentIntentId,
    })
    .returning();
  if (!order) throw new Error("order insert failed");
  return { order, personId };
}

async function otherShop(db: AppDb) {
  const [other] = await db
    .insert(shops)
    .values({ name: "Other Reef", slug: "other-reef-disputes", timezone: "America/New_York" })
    .returning();
  if (!other) throw new Error("other shop insert failed");
  return other;
}

function disputeEvent(overrides: {
  account?: string;
  id?: string;
  paymentIntentId?: string;
  eventType?: string;
  status?: string;
  at: string;
  evidenceDueBy?: Date | null;
  amountCents?: number;
}): DisputeEvent {
  return {
    stripeAccountId: overrides.account ?? "acct_demo",
    eventType: overrides.eventType ?? "charge.dispute.created",
    occurredAt: new Date(overrides.at),
    dispute: {
      id: overrides.id ?? "dp_one",
      paymentIntentId: overrides.paymentIntentId ?? "pi_disputed",
      amountCents: overrides.amountCents ?? 12_000,
      currency: "usd",
      reason: "fraudulent",
      status: overrides.status ?? "needs_response",
      evidenceDueBy: overrides.evidenceDueBy ?? null,
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
    },
  };
}

describe("recordStripeDispute", () => {
  it("records a dispute against the order whose charge it is", async () => {
    const { db, shop } = ctx;
    const { order } = await paidOrder(db, shop.id, {
      account: "acct_demo",
      paymentIntentId: "pi_disputed",
    });
    const outcome = await recordStripeDispute(
      db,
      disputeEvent({ at: "2026-10-01T00:00:00.000Z" }),
      lookupAnsweringNone().lookup,
    );
    expect(outcome).toMatchObject({
      status: "recorded",
      dispute: { shopId: shop.id, orderId: order.id, checkoutId: null, closedAt: null },
    });
  });

  it("is not_found for a charge DiveDay never raised, and writes nothing", async () => {
    const { db } = ctx;
    const { lookup, calls } = lookupAnsweringNone();
    const outcome = await recordStripeDispute(
      db,
      disputeEvent({ paymentIntentId: "pi_the_shops_own_till", at: "2026-10-01T00:00:00.000Z" }),
      lookup,
    );
    expect(outcome).toEqual({ status: "not_found" });
    expect(calls).toEqual([["acct_demo", "pi_the_shops_own_till"]]);
    expect(await db.select().from(paymentDisputes)).toEqual([]);
  });

  it("never matches an order on another connected account, even by its PaymentIntent", async () => {
    const { db, shop } = ctx;
    await paidOrder(db, shop.id, { account: "acct_demo", paymentIntentId: "pi_disputed" });
    const outcome = await recordStripeDispute(
      db,
      disputeEvent({ account: "acct_forged", at: "2026-10-01T00:00:00.000Z" }),
      lookupAnsweringNone().lookup,
    );
    expect(outcome).toEqual({ status: "not_found" });
    expect(await db.select().from(paymentDisputes)).toEqual([]);
  });

  it("never moves a dispute to another shop's account by reusing its dispute id", async () => {
    const { db, shop } = ctx;
    await paidOrder(db, shop.id, { account: "acct_demo", paymentIntentId: "pi_disputed" });
    const other = await otherShop(db);
    await paidOrder(db, other.id, { account: "acct_other", paymentIntentId: "pi_other" });
    const { lookup } = lookupAnsweringNone();
    await recordStripeDispute(db, disputeEvent({ at: "2026-10-01T00:00:00.000Z" }), lookup);

    const hijack = await recordStripeDispute(
      db,
      disputeEvent({
        account: "acct_other",
        paymentIntentId: "pi_other",
        status: "won",
        eventType: "charge.dispute.closed",
        at: "2026-10-09T00:00:00.000Z",
      }),
      lookup,
    );
    expect(hijack).toEqual({ status: "stale" });
    const [row] = await db.select().from(paymentDisputes);
    expect(row).toMatchObject({
      shopId: shop.id,
      stripeAccountId: "acct_demo",
      status: "needs_response",
      closedAt: null,
    });
  });

  it("ignores an event older than one already applied", async () => {
    const { db, shop } = ctx;
    await paidOrder(db, shop.id, { account: "acct_demo", paymentIntentId: "pi_disputed" });
    const { lookup } = lookupAnsweringNone();
    await recordStripeDispute(
      db,
      disputeEvent({
        status: "under_review",
        eventType: "charge.dispute.updated",
        at: "2026-10-03T00:00:00.000Z",
      }),
      lookup,
    );
    const late = await recordStripeDispute(
      db,
      disputeEvent({ status: "needs_response", at: "2026-10-01T00:00:00.000Z" }),
      lookup,
    );
    expect(late).toEqual({ status: "stale" });
    const [row] = await db.select().from(paymentDisputes);
    expect(row?.status).toBe("under_review");
  });

  it("never reopens a closed dispute: not by an older update, nor one stamped the same second", async () => {
    const { db, shop } = ctx;
    await paidOrder(db, shop.id, { account: "acct_demo", paymentIntentId: "pi_disputed" });
    const { lookup } = lookupAnsweringNone();
    const closed = await recordStripeDispute(
      db,
      disputeEvent({
        status: "lost",
        eventType: "charge.dispute.closed",
        at: "2026-10-05T00:00:00.000Z",
      }),
      lookup,
    );
    expect(closed).toMatchObject({
      status: "recorded",
      dispute: { status: "lost", closedAt: new Date("2026-10-05T00:00:00.000Z") },
    });

    for (const at of ["2026-10-04T00:00:00.000Z", "2026-10-05T00:00:00.000Z"]) {
      const reopen = await recordStripeDispute(
        db,
        disputeEvent({ status: "under_review", eventType: "charge.dispute.updated", at }),
        lookup,
      );
      expect(reopen).toEqual({ status: "stale" });
    }
    const [row] = await db.select().from(paymentDisputes);
    expect(row).toMatchObject({ status: "lost", closedAt: new Date("2026-10-05T00:00:00.000Z") });
  });

  it("keeps the first close it saw when a later close arrives", async () => {
    const { db, shop } = ctx;
    await paidOrder(db, shop.id, { account: "acct_demo", paymentIntentId: "pi_disputed" });
    const { lookup } = lookupAnsweringNone();
    await recordStripeDispute(
      db,
      disputeEvent({
        status: "won",
        eventType: "charge.dispute.closed",
        at: "2026-10-05T00:00:00.000Z",
      }),
      lookup,
    );
    const again = await recordStripeDispute(
      db,
      disputeEvent({
        status: "won",
        eventType: "charge.dispute.closed",
        at: "2026-10-06T00:00:00.000Z",
      }),
      lookup,
    );
    expect(again).toMatchObject({
      status: "recorded",
      dispute: { closedAt: new Date("2026-10-05T00:00:00.000Z") },
    });
  });

  it("reads a status Stripe has not told us about as still open", async () => {
    const { db, shop } = ctx;
    await paidOrder(db, shop.id, { account: "acct_demo", paymentIntentId: "pi_disputed" });
    const outcome = await recordStripeDispute(
      db,
      disputeEvent({
        status: "some_future_status",
        eventType: "charge.dispute.updated",
        at: "2026-10-02T00:00:00.000Z",
      }),
      lookupAnsweringNone().lookup,
    );
    expect(outcome).toMatchObject({ status: "recorded", dispute: { closedAt: null } });
  });
});

describe("listOpenPaymentDisputes", () => {
  it("lists only this shop's undecided disputes, soonest deadline first, with the customer's name", async () => {
    const { db, shop } = ctx;
    const { lookup } = lookupAnsweringNone();
    const { order, personId } = await paidOrder(db, shop.id, {
      account: "acct_demo",
      paymentIntentId: "pi_late",
    });
    await paidOrder(db, shop.id, { account: "acct_demo", paymentIntentId: "pi_soon" });
    await paidOrder(db, shop.id, { account: "acct_demo", paymentIntentId: "pi_none" });
    await paidOrder(db, shop.id, { account: "acct_demo", paymentIntentId: "pi_decided" });
    const other = await otherShop(db);
    await paidOrder(db, other.id, { account: "acct_other", paymentIntentId: "pi_other" });

    await recordStripeDispute(
      db,
      disputeEvent({
        id: "dp_late",
        paymentIntentId: "pi_late",
        at: "2026-10-01T00:00:00.000Z",
        evidenceDueBy: new Date("2026-10-20T00:00:00.000Z"),
      }),
      lookup,
    );
    await recordStripeDispute(
      db,
      disputeEvent({
        id: "dp_soon",
        paymentIntentId: "pi_soon",
        at: "2026-10-01T00:00:00.000Z",
        evidenceDueBy: new Date("2026-10-12T00:00:00.000Z"),
      }),
      lookup,
    );
    await recordStripeDispute(
      db,
      disputeEvent({ id: "dp_none", paymentIntentId: "pi_none", at: "2026-10-01T00:00:00.000Z" }),
      lookup,
    );
    await recordStripeDispute(
      db,
      disputeEvent({
        id: "dp_decided",
        paymentIntentId: "pi_decided",
        status: "lost",
        eventType: "charge.dispute.closed",
        at: "2026-10-02T00:00:00.000Z",
      }),
      lookup,
    );
    await recordStripeDispute(
      db,
      disputeEvent({
        id: "dp_other",
        account: "acct_other",
        paymentIntentId: "pi_other",
        at: "2026-10-01T00:00:00.000Z",
        evidenceDueBy: new Date("2026-10-11T00:00:00.000Z"),
      }),
      lookup,
    );

    const [person] = await db.select().from(people).where(eq(people.id, personId));
    const open = await listOpenPaymentDisputes(db, shop.id);
    expect(open.map((dispute) => dispute.evidenceDueBy?.toISOString() ?? null)).toEqual([
      "2026-10-12T00:00:00.000Z",
      "2026-10-20T00:00:00.000Z",
      null,
    ]);
    expect(open.every((dispute) => dispute.personName === person?.fullName)).toBe(true);
    expect(open.every((dispute) => dispute.tripId === null && dispute.tripTitle === null)).toBe(
      true,
    );

    const forOrder = await listOpenPaymentDisputes(db, shop.id, { orderId: order.id });
    expect(forOrder).toHaveLength(1);
    expect(forOrder[0]?.orderId).toBe(order.id);

    expect(await listOpenPaymentDisputes(db, shop.id, { limit: 1 })).toHaveLength(1);
    const theirs = await listOpenPaymentDisputes(db, other.id);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]?.personName).toBe("Odette Other");
  });

  it("never reads another shop's dispute by naming its order", async () => {
    const { db, shop } = ctx;
    const other = await otherShop(db);
    const { order } = await paidOrder(db, other.id, {
      account: "acct_other",
      paymentIntentId: "pi_other",
    });
    await recordStripeDispute(
      db,
      disputeEvent({
        account: "acct_other",
        paymentIntentId: "pi_other",
        at: "2026-10-01T00:00:00.000Z",
      }),
      lookupAnsweringNone().lookup,
    );
    expect(await listOpenPaymentDisputes(db, shop.id, { orderId: order.id })).toEqual([]);
  });
});
