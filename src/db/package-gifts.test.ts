import { eq } from "drizzle-orm";
import { assert, describe, expect, it } from "vitest";
import type { CreateInvoiceRequest, InvoicingProvider } from "@/lib/payments/invoicing";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { countSpendableDives, createDivePackage, deleteDivePackage } from "./dive-packages";
import { createDiverPackageOrder, markOrderPaidByInvoiceId, refundOrder } from "./orders";
import { sendDuePackageGifts } from "./package-gifts";
import { packageGifts, people } from "./schema";
import { setShopTimezone } from "./shops";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";

/**
 * A package bought for someone else (issue 4629; ADR
 * 20260822-a-package-is-entitlements-not-money, amendment 2026-11-16): the
 * buyer pays, the dives land on the recipient's email when paid, and the gift
 * email goes on the chosen date. Money-adjacent, so the failure paths are
 * here: unpaid, refunded, and a package withdrawn before the date.
 */
const fileCtx = fileScopedShopContext();

/** Stripe as the gift needs it: an invoice raised, and a refund accepted. */
function fakeInvoicing(): InvoicingProvider {
  let counter = 0;
  return {
    async createInvoice(request: CreateInvoiceRequest) {
      counter += 1;
      const totalCents = request.lineItems.reduce(
        (sum, item) => sum + item.quantity * item.unitAmountCents,
        0,
      );
      return {
        status: "created",
        stripeCustomerId: `cus_${counter}`,
        stripeInvoiceId: `in_gift_${counter}`,
        stripeStatus: "open",
        hostedInvoiceUrl: `https://invoice.stripe.com/i/${request.stripeAccountId}/in_${counter}`,
        invoicePdfUrl: null,
        totalCents,
        taxCents: 0,
      };
    },
    async refundInvoice() {
      return { status: "refunded", refundId: "re_gift" };
    },
  } as Partial<InvoicingProvider> as InvoicingProvider;
}

function invoiceIdOf(order: { stripeInvoiceId: string | null }): string {
  if (!order.stripeInvoiceId) throw new Error("expected a Stripe-invoiced order");
  return order.stripeInvoiceId;
}

async function packageShop() {
  const { db, shop } = fileCtx;
  await upsertShopStripeAccount(db, shop.id, "acct_gift");
  await setShopStripeAccountStatus(db, "acct_gift", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  const pkg = await createDivePackage(db, {
    shopId: shop.id,
    name: "Ten-dive card",
    diveCount: 10,
    priceCents: 45_000,
    scope: "all",
    validUntil: null,
  });
  if (!pkg) throw new Error("package not created");
  return { db, shop, pkg };
}

describe("a dive package bought as a gift (issue 4629)", () => {
  const morning = (date: string) => new Date(`${date}T12:00:00.000Z`);

  async function giftOrder(sendOn = "2026-12-01") {
    const ctx = await packageShop();
    // UTC, so a test's noon is the shop's noon and its date the shop's date.
    await setShopTimezone(ctx.db, ctx.shop.id, "UTC");
    const result = await createDiverPackageOrder(
      ctx.db,
      {
        shopId: ctx.shop.id,
        packageId: ctx.pkg.id,
        fullName: "Gil Giver",
        email: "gil.giver@example.com",
        lineDescription: "Ten-dive card",
        gift: { fullName: "Rita Recipient", email: "rita@example.com", sendOn },
      },
      fakeInvoicing(),
    );
    assert(result.ok && result.order.stripeInvoiceId && result.order.personId);
    const [gift] = await ctx.db.select().from(packageGifts);
    assert(gift);
    return { ...ctx, order: result.order, buyerId: result.order.personId, gift };
  }

  const sweep = (db: Parameters<typeof sendDuePackageGifts>[0], now: Date) => {
    const email = fakeEmail();
    return sendDuePackageGifts(db, { now, emailProvider: email.provider, appOrigin: null }).then(
      (summary) => ({ summary, sent: email.sent }),
    );
  };

  it("grants the dives to the recipient's email when paid, and the buyer keeps the order", async () => {
    const { db, shop, order, buyerId, gift } = await giftOrder();
    expect(order.personId).toBe(buyerId);
    const [recipient] = await db.select().from(people).where(eq(people.id, gift.recipientPersonId));
    expect(recipient).toMatchObject({ fullName: "Rita Recipient", email: "rita@example.com" });
    expect(await countSpendableDives(db, shop.id, gift.recipientPersonId)).toBe(0);
    await markOrderPaidByInvoiceId(db, invoiceIdOf(order), order.totalCents);
    expect(await countSpendableDives(db, shop.id, gift.recipientPersonId)).toBe(10);
    expect(await countSpendableDives(db, shop.id, buyerId)).toBe(0);
  });

  it("mails the recipient once, on the chosen date in the shop's send window", async () => {
    const { db, order } = await giftOrder("2026-12-01");
    await markOrderPaidByInvoiceId(db, invoiceIdOf(order), order.totalCents);
    expect((await sweep(db, morning("2026-11-30"))).sent).toEqual([]);
    // 05:00 on the day is before the window opens.
    expect((await sweep(db, new Date("2026-12-01T05:00:00.000Z"))).sent).toEqual([]);
    const { sent } = await sweep(db, morning("2026-12-01"));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: "package_gift",
      to: "rita@example.com",
      buyerName: "Gil Giver",
      packageName: "Ten-dive card",
      diveCount: 10,
    });
    expect((await sweep(db, morning("2026-12-02"))).sent).toEqual([]);
  });

  it("waits for an unpaid order, and mails on the first tick after it is paid", async () => {
    const { db, order } = await giftOrder("2026-12-01");
    expect((await sweep(db, morning("2026-12-01"))).sent).toEqual([]);
    await markOrderPaidByInvoiceId(db, invoiceIdOf(order), order.totalCents);
    expect((await sweep(db, morning("2026-12-03"))).sent).toHaveLength(1);
  });

  it("sends nothing after a refund before the date, and the recipient's dives go back", async () => {
    const { db, shop, order, gift } = await giftOrder("2026-12-01");
    await markOrderPaidByInvoiceId(db, invoiceIdOf(order), order.totalCents);
    expect((await refundOrder(db, shop.id, order.id, fakeInvoicing())).status).toBe("refunded");
    expect(await countSpendableDives(db, shop.id, gift.recipientPersonId)).toBe(0);
    expect((await sweep(db, morning("2026-12-01"))).sent).toEqual([]);
    const [row] = await db.select().from(packageGifts).where(eq(packageGifts.id, gift.id));
    expect(row?.sentAt).toBeNull();
  });

  it("still mails a gift whose package the shop stopped selling before the date", async () => {
    const { db, shop, pkg, order, gift } = await giftOrder("2026-12-01");
    await markOrderPaidByInvoiceId(db, invoiceIdOf(order), order.totalCents);
    await deleteDivePackage(db, shop.id, pkg.id);
    const { sent } = await sweep(db, morning("2026-12-01"));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "package_gift", packageName: "Ten-dive card" });
    expect(await countSpendableDives(db, shop.id, gift.recipientPersonId)).toBe(10);
  });

  it("gives the dives to the diver who already holds the recipient's email", async () => {
    const ctx = await packageShop();
    const [existing] = await ctx.db
      .insert(people)
      .values({ shopId: ctx.shop.id, fullName: "Rita R.", email: "rita.known@example.com" })
      .returning();
    assert(existing);
    const result = await createDiverPackageOrder(
      ctx.db,
      {
        shopId: ctx.shop.id,
        packageId: ctx.pkg.id,
        fullName: "Gil Giver",
        email: "gil.giver@example.com",
        lineDescription: "Ten-dive card",
        gift: { fullName: "Rita", email: "rita.known@example.com", sendOn: "2026-12-01" },
      },
      fakeInvoicing(),
    );
    assert(result.ok);
    await markOrderPaidByInvoiceId(ctx.db, invoiceIdOf(result.order), result.order.totalCents);
    expect(await countSpendableDives(ctx.db, ctx.shop.id, existing.id)).toBe(10);
  });
});
