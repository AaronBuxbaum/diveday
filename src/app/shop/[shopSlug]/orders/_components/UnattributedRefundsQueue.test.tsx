import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { setBookingPayment } from "@/db/payments";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookings,
  paymentOperationIntents,
} from "@/db/schema";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { ariaLabelsIn, hiddenInputNamesIn } from "@/test/jsx-inspect";

// The queue's forms post to a Server Action module, which reaches for the
// request scope; the queue itself only needs the function's identity.
vi.mock("../actions", () => ({
  matchStripeRefundAction: vi.fn(),
  refundPaidAfterCloseAction: vi.fn(),
}));

const { UnattributedRefundsQueue } = await import("./OwedMoneyQueues");
const { readBackOffice } = await import("./PayoutLines");

const ctx = fileScopedShopContext();
const t = staffTranslator("en-US");

/**
 * A refund made in the Stripe dashboard on a party's checkout, held because it
 * names no seat (issue #2293): the seat that checkout paid for is offered.
 */
async function aDashboardRefundOnAParty(db: AppDb, shopId: string) {
  const [seat] = await db
    .select({ id: bookings.id, tripId: bookings.tripId })
    .from(bookings)
    .where(and(eq(bookings.shopId, shopId), ne(bookings.status, "cancelled")))
    .limit(1);
  if (!seat) throw new Error("the seed has no booking");
  const [checkout] = await db
    .insert(bookingCheckouts)
    .values({
      shopId,
      tripId: seat.tripId,
      status: "completed",
      stripeAccountId: "acct_party_dash",
      stripeSessionId: "cs_party_dash",
      currency: "usd",
      amountPerDiverCents: 10_000,
      totalCents: 20_000,
      refundedCents: 6_000,
      completedAt: nowDate(),
    })
    .returning({ id: bookingCheckouts.id });
  if (!checkout) throw new Error("checkout insert returned no row");
  await db
    .insert(bookingCheckoutBookings)
    .values({ shopId, checkoutId: checkout.id, bookingId: seat.id });
  await setBookingPayment(db, {
    shopId,
    bookingId: seat.id,
    status: "paid",
    amountCents: 10_000,
    currency: "usd",
    provider: "stripe",
    providerRef: "cs_party_dash",
    operation: "checkout_settled",
  });
  await db.insert(paymentOperationIntents).values({
    shopId,
    kind: "refund",
    checkoutId: checkout.id,
    stripeObjectId: "ch_party_dash",
    errorMessage: "unattributed_refund:6000",
    amountCents: 6_000,
    // Old enough to count as stuck, on the database's own clock.
    startedAt: new Date("2020-01-01T00:00:00Z"),
  });
  return seat;
}

function textIn(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textIn).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textIn((node as { props: { children?: unknown } }).props.children);
  }
  return "";
}

describe("the refunds-made-in-Stripe queue on the Orders index", () => {
  it("lists the held refund with its seats, and not among the payments that need a check", async () => {
    const { db, shop } = ctx;
    const seat = await aDashboardRefundOnAParty(db, shop.id);

    const backOffice = await readBackOffice(db, shop.id, true);

    expect(backOffice.unattributedRefunds).toHaveLength(1);
    expect(backOffice.unattributedRefunds[0]?.seats.map((row) => row.bookingId)).toEqual([seat.id]);
    expect(
      backOffice.stuckPaymentOperations.some((op) => op.intent.stripeObjectId === "ch_party_dash"),
    ).toBe(false);

    const element = UnattributedRefundsQueue({
      queue: backOffice.unattributedRefunds,
      shopSlug: shop.slug,
      timeZone: "UTC",
      locale: "en-US",
      t,
    });
    expect(ariaLabelsIn(element)).toContain("Refunds made in Stripe");
    expect(hiddenInputNamesIn(element)).toEqual(expect.arrayContaining(["intentId", "bookingId"]));
    expect(textIn(element)).toContain("$60.00");
  });

  it("reads nothing for a reader who cannot reconcile payments", async () => {
    const { db, shop } = ctx;
    await aDashboardRefundOnAParty(db, shop.id);
    expect((await readBackOffice(db, shop.id, false)).unattributedRefunds).toEqual([]);
  });

  it("renders nothing when nothing is held", () => {
    expect(
      UnattributedRefundsQueue({ queue: [], shopSlug: "x", timeZone: "UTC", locale: "en-US", t }),
    ).toBeNull();
  });
});
