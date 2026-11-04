// @vitest-environment node
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { assembleCrewSheet } from "@/lib/crew-sheet";
import { unseededTestDb } from "@/test/db";
import { insertTip } from "@/test/tips";
import type { AppDb } from "./client";
import { crewSheetForMonth } from "./crew-sheet";
import { crewTipShare, tipsByDeparture } from "./crew-tips";
import { recordStripeDispute } from "./payment-disputes";
import { recordStripeRefundFailure } from "./refund-failures";
import { recordStripeChargeRefund } from "./refunds";
import { getMonthlyReport } from "./reporting";
import { bookingCheckouts, bookings, people, shops, tripAssignments, trips } from "./schema";

/**
 * A refund or dispute of a tip at Stripe reaches the crew's figures (issue
 * #3736). Built on a bare shop so every figure is exact.
 */
const ACCOUNT = "acct_tips";
const WINDOW = { from: new Date("2026-10-05T00:00:00Z"), to: new Date("2026-10-12T00:00:00Z") };

async function setup(db: AppDb) {
  const [shop] = await db
    .insert(shops)
    .values({ name: "Tip Reef", slug: `tip-reversals-${randomUUID()}`, timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("shop insert failed");
  const [ana, ben, diver] = await db
    .insert(people)
    .values([
      { shopId: shop.id, fullName: "Ana Reyes" },
      { shopId: shop.id, fullName: "Ben Okafor" },
      { shopId: shop.id, fullName: "Tipping Diver" },
    ])
    .returning();
  if (!ana || !ben || !diver) throw new Error("people insert failed");
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
  await db.insert(tripAssignments).values([
    { tripId: trip.id, personId: ana.id },
    { tripId: trip.id, personId: ben.id },
  ]);
  const [booking] = await db
    .insert(bookings)
    .values({ bookedAs: "diver", shopId: shop.id, tripId: trip.id, personId: diver.id })
    .returning();
  if (!booking) throw new Error("booking insert failed");
  return { shop, ana, ben, trip, booking };
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

describe("a refunded tip", () => {
  it("drops out of the crew split, the departure's tips and the month total", async () => {
    const db = await unseededTestDb();
    const s = await setup(db);
    await tip(db, s, 50_000, "mistyped");
    await tip(db, s, 2_000, "kept");

    expect(await crewTipShare(db, s.shop.id, s.ana.id, WINDOW)).toBe(26_000);

    expect(await recordStripeChargeRefund(db, refund("mistyped", 50_000))).toEqual({
      status: "tip_refunded",
    });

    expect(await crewTipShare(db, s.shop.id, s.ana.id, WINDOW)).toBe(1_000);
    expect((await tipsByDeparture(db, s.shop.id, WINDOW)).map((row) => row.cents)).toEqual([2_000]);
    const report = await getMonthlyReport(
      db,
      s.shop.id,
      new Date("2026-10-01T00:00:00Z"),
      new Date("2026-11-01T00:00:00Z"),
    );
    expect(report.tipsCents).toBe(2_000);
    expect(report.tipCount).toBe(1);
    const sheet = assembleCrewSheet(
      await crewSheetForMonth(db, s.shop.id, "UTC", { year: 2026, month: 10 }),
    );
    expect(sheet.map((row) => row.tipsCents)).toEqual([1_000, 1_000]);
  });

  it("counts a replayed event once, and a partial refund only for its part", async () => {
    const db = await unseededTestDb();
    const s = await setup(db);
    await tip(db, s, 5_000, "partial");

    expect(await recordStripeChargeRefund(db, refund("partial", 1_500))).toEqual({
      status: "tip_refunded",
    });
    expect(await recordStripeChargeRefund(db, refund("partial", 1_500))).toEqual({
      status: "already_recorded",
    });
    // An older, smaller cumulative arriving late changes nothing.
    expect(await recordStripeChargeRefund(db, refund("partial", 500))).toEqual({
      status: "already_recorded",
    });
    expect((await refundedOf(db, "partial"))?.refundedCents).toBe(1_500);
    expect((await tipsByDeparture(db, s.shop.id, WINDOW))[0]?.cents).toBe(3_500);

    // Stripe's cumulative figure never takes more than the tip was.
    await recordStripeChargeRefund(db, refund("partial", 9_999));
    expect((await refundedOf(db, "partial"))?.refundedCents).toBe(5_000);
  });

  it("waits for a tip that has not settled yet, and ignores another account's charge", async () => {
    const db = await unseededTestDb();
    const s = await setup(db);
    await tip(db, s, 2_000, "early", "pending");
    await tip(db, s, 2_000, "theirs");

    expect(await recordStripeChargeRefund(db, refund("early", 2_000))).toEqual({
      status: "deferred",
    });
    expect(
      await recordStripeChargeRefund(db, {
        ...refund("theirs", 2_000),
        stripeAccountId: "acct_other",
      }),
    ).toEqual({ status: "not_found" });
    expect((await refundedOf(db, "theirs"))?.refundedCents).toBe(0);
  });

  it("comes back when Stripe reports the refund failed, once", async () => {
    const db = await unseededTestDb();
    const s = await setup(db);
    await tip(db, s, 4_000, "bounced");
    await recordStripeChargeRefund(db, refund("bounced", 4_000));
    expect((await tipsByDeparture(db, s.shop.id, WINDOW)).length).toBe(0);

    const failure = {
      stripeAccountId: ACCOUNT,
      paymentIntentId: "pi_bounced",
      occurredAt: new Date("2026-10-10T00:00:00Z"),
      refund: {
        id: "re_bounced",
        amountCents: 4_000,
        currency: "usd",
        status: "failed",
        failureReason: "expired_or_canceled_card",
      },
    };
    expect(await recordStripeRefundFailure(db, failure)).toEqual({ status: "reversed" });
    expect(await recordStripeRefundFailure(db, failure)).toEqual({ status: "already_recorded" });
    expect((await tipsByDeparture(db, s.shop.id, WINDOW))[0]?.cents).toBe(4_000);
  });
});

describe("a disputed tip", () => {
  it("leaves the tip counted while the dispute is open, and takes it out when the shop loses, once", async () => {
    const db = await unseededTestDb();
    const s = await setup(db);
    await tip(db, s, 6_000, "disputed");

    await recordStripeDispute(
      db,
      dispute("disputed", "needs_response", "2026-10-09T00:00:00Z", 6_000),
    );
    expect((await tipsByDeparture(db, s.shop.id, WINDOW))[0]?.cents).toBe(6_000);

    const lost = dispute("disputed", "lost", "2026-10-20T00:00:00Z", 6_000);
    expect(await recordStripeDispute(db, lost)).toMatchObject({ status: "recorded" });
    expect(await recordStripeDispute(db, lost)).toMatchObject({ status: "recorded" });
    expect((await refundedOf(db, "disputed"))?.refundedCents).toBe(6_000);
    expect(await tipsByDeparture(db, s.shop.id, WINDOW)).toEqual([]);
  });

  it("never takes more than the tip still held", async () => {
    const db = await unseededTestDb();
    const s = await setup(db);
    await tip(db, s, 3_000, "both");
    await recordStripeChargeRefund(db, refund("both", 2_000));
    await recordStripeDispute(db, dispute("both", "lost", "2026-10-20T00:00:00Z", 3_000));
    expect((await refundedOf(db, "both"))?.refundedCents).toBe(3_000);
  });
});
