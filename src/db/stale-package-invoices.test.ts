import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS } from "@/lib/clock";
import type { InvoicingProvider } from "@/lib/payments/invoicing";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { orderLineItems, orders, people, shops } from "./schema";
import {
  PUBLIC_PACKAGE_INVOICE_DAYS,
  STALE_VOID_ALERT_AFTER,
  voidStalePublicPackageInvoices,
} from "./stale-package-invoices";

/**
 * Issue #2304. Aaron, 2026-10-13: a nightly step voids unpaid public package
 * invoices older than 7 days, through the invoicing provider, recorded on the
 * order; a staff-created invoice is never voided.
 */

const ctx = fileScopedShopContext();

const NOW = new Date("2026-10-16T03:07:00.000Z");

function recordingInvoicing(answer: "voided" | "failed" = "voided", stripeStatus = "open") {
  const voided: string[] = [];
  const provider = {
    async voidInvoice(_account: string, invoiceId: string) {
      voided.push(invoiceId);
      return { status: answer };
    },
    async retrieveInvoice() {
      if (stripeStatus === "unreadable") return { status: "failed" };
      return {
        status: "ok",
        invoice: {
          status: stripeStatus,
          hostedInvoiceUrl: null,
          invoicePdfUrl: null,
          amountPaidCents: stripeStatus === "paid" ? 30_000 : 0,
          totalCents: 30_000,
          taxCents: 0,
        },
      };
    },
  } as unknown as InvoicingProvider;
  return { provider, voided };
}

async function openOrder(
  db: AppDb,
  shopId: string,
  input: {
    invoiceId: string;
    ageDays: number;
    source?: "public" | "staff";
    status?: "open" | "paid";
  },
) {
  const [person] = await db.select().from(people).where(eq(people.shopId, shopId)).limit(1);
  if (!person) throw new Error("person missing");
  const [order] = await db
    .insert(orders)
    .values({
      shopId,
      personId: person.id,
      createdByPersonId: person.id,
      source: input.source ?? "public",
      status: input.status ?? "open",
      currency: "usd",
      totalCents: 30_000,
      stripeAccountId: "acct_pkg",
      stripeCustomerId: "cus_pkg",
      stripeInvoiceId: input.invoiceId,
      createdAt: new Date(NOW.getTime() - input.ageDays * DAY_MS),
    })
    .returning();
  if (!order) throw new Error("order insert failed");
  await db.insert(orderLineItems).values({
    shopId,
    orderId: order.id,
    kind: "dive_package",
    description: "Ten-dive package",
    quantity: 1,
    unitAmountCents: 30_000,
  });
  return order;
}

async function statusOf(db: AppDb, orderId: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
  return row?.status;
}

describe("voidStalePublicPackageInvoices", () => {
  it("is seven days, the owner's window", () => {
    expect(PUBLIC_PACKAGE_INVOICE_DAYS).toBe(7);
  });

  it("voids an unpaid public invoice older than the window, at Stripe and on the order", async () => {
    const { db, shop } = ctx;
    const stale = await openOrder(db, shop.id, { invoiceId: "in_stale", ageDays: 8 });
    const { provider, voided } = recordingInvoicing();

    const summary = await voidStalePublicPackageInvoices(db, { now: NOW, invoicing: provider });

    expect(voided).toEqual(["in_stale"]);
    expect(await statusOf(db, stale.id)).toBe("void");
    expect(summary).toMatchObject({ voided: 1, failed: 0 });
  });

  it("leaves one inside the window, a paid one, and every staff-created invoice", async () => {
    const { db, shop } = ctx;
    const fresh = await openOrder(db, shop.id, { invoiceId: "in_fresh", ageDays: 6 });
    const paid = await openOrder(db, shop.id, {
      invoiceId: "in_paid",
      ageDays: 30,
      status: "paid",
    });
    const staff = await openOrder(db, shop.id, {
      invoiceId: "in_staff",
      ageDays: 30,
      source: "staff",
    });
    const { provider, voided } = recordingInvoicing();

    await voidStalePublicPackageInvoices(db, { now: NOW, invoicing: provider });

    expect(voided).toEqual([]);
    expect(await statusOf(db, fresh.id)).toBe("open");
    expect(await statusOf(db, paid.id)).toBe("paid");
    expect(await statusOf(db, staff.id)).toBe("open");
  });

  it("keeps the order open when Stripe refuses, so tomorrow's pass tries again", async () => {
    const { db, shop } = ctx;
    const stale = await openOrder(db, shop.id, { invoiceId: "in_refused", ageDays: 9 });
    const { provider } = recordingInvoicing("failed");

    const summary = await voidStalePublicPackageInvoices(db, { now: NOW, invoicing: provider });

    expect(await statusOf(db, stale.id)).toBe("open");
    expect(summary).toMatchObject({ voided: 0, failed: 1 });
  });

  it("does not retry a refused void the next night, so refusals cannot hold the batch", async () => {
    const { db, shop } = ctx;
    const refused = await openOrder(db, shop.id, { invoiceId: "in_refused", ageDays: 9 });
    const { provider, voided } = recordingInvoicing("failed");

    await voidStalePublicPackageInvoices(db, { now: NOW, invoicing: provider });
    await voidStalePublicPackageInvoices(db, {
      now: new Date(NOW.getTime() + DAY_MS),
      invoicing: provider,
    });

    expect(voided).toEqual(["in_refused"]);
    expect(await statusOf(db, refused.id)).toBe("open");
  });

  it("reports an invoice refused too many times, once, for a person to look at", async () => {
    const { db, shop } = ctx;
    await openOrder(db, shop.id, { invoiceId: "in_jammed", ageDays: 9 });
    const { provider } = recordingInvoicing("failed");

    const stuck: number[] = [];
    for (let night = 0; night < STALE_VOID_ALERT_AFTER + 1; night += 1) {
      const summary = await voidStalePublicPackageInvoices(db, {
        now: new Date(NOW.getTime() + night * 30 * DAY_MS),
        invoicing: provider,
      });
      stuck.push(summary.stuck);
    }

    expect(stuck.filter((count) => count > 0)).toEqual([1]);
  });

  it("counts nothing against an invoice it could not read back, and tries it the next night", async () => {
    const { db, shop } = ctx;
    const unread = await openOrder(db, shop.id, { invoiceId: "in_unread", ageDays: 9 });
    const { provider, voided } = recordingInvoicing("failed", "unreadable");

    const first = await voidStalePublicPackageInvoices(db, { now: NOW, invoicing: provider });
    await voidStalePublicPackageInvoices(db, {
      now: new Date(NOW.getTime() + DAY_MS),
      invoicing: provider,
    });

    expect(first).toMatchObject({ failed: 0, unread: 1 });
    expect(voided).toEqual(["in_unread", "in_unread"]);
    const [row] = await db.select().from(orders).where(eq(orders.id, unread.id));
    expect(row).toMatchObject({ status: "open", autoVoidFailures: 0, autoVoidFailedAt: null });
  });

  it("treats an uncollectible invoice it could not void as a refusal, not as settled", async () => {
    const { db, shop } = ctx;
    const written = await openOrder(db, shop.id, { invoiceId: "in_uncollectible", ageDays: 9 });
    const { provider } = recordingInvoicing("failed", "uncollectible");

    const summary = await voidStalePublicPackageInvoices(db, { now: NOW, invoicing: provider });

    expect(summary).toMatchObject({ refreshed: 0, failed: 1 });
    expect(await statusOf(db, written.id)).toBe("open");
  });

  it("records an invoice Stripe says is already paid as paid, not as a refusal", async () => {
    const { db, shop } = ctx;
    const paid = await openOrder(db, shop.id, { invoiceId: "in_paid_late", ageDays: 9 });
    const { provider } = recordingInvoicing("failed", "paid");

    const summary = await voidStalePublicPackageInvoices(db, { now: NOW, invoicing: provider });

    expect(await statusOf(db, paid.id)).toBe("paid");
    expect(summary).toMatchObject({ voided: 0, refreshed: 1, failed: 0 });
  });

  it("voids each shop's own invoice on its own account", async () => {
    const { db, shop } = ctx;
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-stale-invoices", timezone: "UTC" })
      .returning();
    if (!other) throw new Error("shop insert failed");
    await db.insert(people).values({ shopId: other.id, fullName: "Ola Other" });
    const ours = await openOrder(db, shop.id, { invoiceId: "in_ours", ageDays: 8 });
    const theirs = await openOrder(db, other.id, { invoiceId: "in_theirs", ageDays: 8 });
    const { provider, voided } = recordingInvoicing();

    await voidStalePublicPackageInvoices(db, { now: NOW, invoicing: provider });

    expect(voided.sort()).toEqual(["in_ours", "in_theirs"]);
    expect(await statusOf(db, ours.id)).toBe("void");
    expect(await statusOf(db, theirs.id)).toBe("void");
  });
});
