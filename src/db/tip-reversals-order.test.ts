// @vitest-environment node
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import { insertTip } from "@/test/tips";
import type { AppDb } from "./client";
import { recordStripeDispute } from "./payment-disputes";
import { recordStripeRefundFailure } from "./refund-failures";
import { recordStripeChargeRefund } from "./refunds";
import { bookingCheckouts, bookings, people, shops, trips } from "./schema";

/**
 * Refund, failure and lost-dispute events reach a tip in any order and leave
 * the same money counted (issues #3835, #3736).
 */
const ACCOUNT = "acct_tips";

async function setup(db: AppDb) {
  const [shop] = await db
    .insert(shops)
    .values({ name: "Tip Reef", slug: `tip-reversals-${randomUUID()}`, timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("shop insert failed");
  const [diver] = await db
    .insert(people)
    .values([{ shopId: shop.id, fullName: "Tipping Diver" }])
    .returning();
  if (!diver) throw new Error("people insert failed");
  const startsAt = new Date("2026-10-07T13:00:00Z");
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Reef",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 8,
    })
    .returning();
  if (!trip) throw new Error("trip insert failed");
  const [booking] = await db
    .insert(bookings)
    .values({ bookedAs: "diver", shopId: shop.id, tripId: trip.id, personId: diver.id })
    .returning();
  if (!booking) throw new Error("booking insert failed");
  return { shop, trip, booking };
}

async function tip(
  db: AppDb,
  s: Awaited<ReturnType<typeof setup>>,
  amountCents: number,
  name: string,
  status: "paid" | "pending" = "paid",
) {
  await insertTip(db, {
    shopId: s.shop.id,
    bookingId: s.booking.id,
    status,
    stripeAccountId: ACCOUNT,
    stripeSessionId: `cs_${name}`,
    stripePaymentIntentId: `pi_${name}`,
    currency: "usd",
    amountCents,
    completedAt: status === "paid" ? new Date("2026-10-08T00:00:00Z") : null,
  });
}

function refund(name: string, amountRefundedCents: number) {
  return {
    stripeAccountId: ACCOUNT,
    paymentIntentId: `pi_${name}`,
    amountRefundedCents,
    chargeId: `ch_${name}`,
    occurredAt: new Date("2026-10-09T00:00:00Z"),
  };
}

function dispute(name: string, status: string, at: string, amountCents: number) {
  return {
    stripeAccountId: ACCOUNT,
    eventType: status === "lost" ? "charge.dispute.closed" : "charge.dispute.created",
    occurredAt: new Date(at),
    dispute: {
      id: `dp_${name}`,
      paymentIntentId: `pi_${name}`,
      amountCents,
      currency: "usd",
      reason: "fraudulent",
      status,
      evidenceDueBy: null,
      createdAt: new Date("2026-10-08T00:00:00Z"),
    },
  };
}

async function refundedOf(db: AppDb, name: string) {
  const [row] = await db
    .select({ refundedCents: bookingCheckouts.refundedCents, status: bookingCheckouts.status })
    // diveday:any-checkout-purpose: a test reading back the tip it wrote
    .from(bookingCheckouts)
    .where(eq(bookingCheckouts.stripeSessionId, `cs_${name}`));
  return row;
}

const failure = (name: string, id: string, amountCents: number, at: string) => ({
  stripeAccountId: ACCOUNT,
  paymentIntentId: `pi_${name}`,
  occurredAt: new Date(at),
  refund: {
    id,
    amountCents,
    currency: "usd",
    status: "failed",
    failureReason: "expired_or_canceled_card",
  },
});

const at = (iso: string) => new Date(iso);

describe("refund failures and lost disputes in any order", () => {
  it("a failure for a refund never counted takes nothing off a lost dispute", async () => {
    const db = await unseededTestDb();
    const s = await setup(db);
    await tip(db, s, 10_000, "dispute-fail");
    await recordStripeDispute(db, dispute("dispute-fail", "lost", "2026-10-20T00:00:00Z", 7_000));

    await recordStripeRefundFailure(
      db,
      failure("dispute-fail", "re_a", 3_000, "2026-10-21T00:00:00Z"),
    );
    expect((await refundedOf(db, "dispute-fail"))?.refundedCents).toBe(7_000);
    // Its own event arrives later, stamped before the failure: still nothing.
    await recordStripeChargeRefund(db, refund("dispute-fail", 3_000));
    expect((await refundedOf(db, "dispute-fail"))?.refundedCents).toBe(7_000);
  });

  it("keeps an earlier refund that succeeded when a later one fails first", async () => {
    const db = await unseededTestDb();
    const s = await setup(db);
    await tip(db, s, 10_000, "a-ok-b-fails");

    await recordStripeRefundFailure(
      db,
      failure("a-ok-b-fails", "re_b", 3_000, "2026-10-12T00:00:00Z"),
    );
    // A's event (2,000, before the failure), then B's running total (5,000), both late.
    await recordStripeChargeRefund(db, {
      ...refund("a-ok-b-fails", 2_000),
      occurredAt: at("2026-10-09T00:00:00Z"),
    });
    await recordStripeChargeRefund(db, {
      ...refund("a-ok-b-fails", 5_000),
      occurredAt: at("2026-10-10T00:00:00Z"),
    });
    expect((await refundedOf(db, "a-ok-b-fails"))?.refundedCents).toBe(2_000);
  });

  it("counts A when the failure arrived with A already counted and B's event still to come", async () => {
    const db = await unseededTestDb();
    const s = await setup(db);
    await tip(db, s, 10_000, "a-counted");
    await recordStripeChargeRefund(db, {
      ...refund("a-counted", 2_000),
      occurredAt: at("2026-10-09T00:00:00Z"),
    });

    await recordStripeRefundFailure(
      db,
      failure("a-counted", "re_b2", 3_000, "2026-10-12T00:00:00Z"),
    );
    await recordStripeChargeRefund(db, {
      ...refund("a-counted", 5_000),
      occurredAt: at("2026-10-10T00:00:00Z"),
    });
    expect((await refundedOf(db, "a-counted"))?.refundedCents).toBe(2_000);
  });

  it("counts a refund stamped the same second as a failure", async () => {
    const db = await unseededTestDb();
    const s = await setup(db);
    await tip(db, s, 10_000, "same-second");

    await recordStripeRefundFailure(
      db,
      failure("same-second", "re_c", 3_000, "2026-10-12T00:00:00Z"),
    );
    // A new refund of 1,000 in the failure's own second; the total no longer holds the failed 3,000.
    expect(
      await recordStripeChargeRefund(db, {
        ...refund("same-second", 1_000),
        occurredAt: at("2026-10-12T00:00:00Z"),
      }),
    ).toEqual({ status: "tip_refunded" });
    expect((await refundedOf(db, "same-second"))?.refundedCents).toBe(1_000);
  });
});
