import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { getDb } from "@/db/client";
import { getOrder, refreshOrderStatus, refundOrder, voidOrder } from "@/db/orders";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = { title: "Order — Scuba" };

const STATUS_LABELS: Record<string, string> = {
  open: "Open — awaiting payment",
  paid: "Paid",
  void: "Void",
  uncollectible: "Uncollectible",
  refunded: "Refunded",
};

const KIND_LABELS: Record<string, string> = {
  trip_fee: "Trip fee",
  course_fee: "Course fee",
  rental_gear: "Rental gear",
  deposit: "Deposit",
  merchandise: "Merchandise",
  other: "Other",
};

function centsToDisplay(cents: number, currency: string): string {
  return `$${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

async function refreshAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const orderId = String(formData.get("orderId") ?? "");
  const db = await getDb();
  const updated = orderId ? await refreshOrderStatus(db, session.user.shopId, orderId) : null;
  redirect(
    `/shop/${session.user.shopSlug}/orders/${orderId}?notice=${updated ? "refreshed" : "refresh_failed"}`,
  );
}

async function voidAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const orderId = String(formData.get("orderId") ?? "");
  const db = await getDb();
  const updated = orderId ? await voidOrder(db, session.user.shopId, orderId) : null;
  redirect(
    `/shop/${session.user.shopSlug}/orders/${orderId}?notice=${updated ? "voided" : "void_failed"}`,
  );
}

async function refundAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const orderId = String(formData.get("orderId") ?? "");
  const db = await getDb();
  const updated = orderId ? await refundOrder(db, session.user.shopId, orderId) : null;
  redirect(
    `/shop/${session.user.shopSlug}/orders/${orderId}?notice=${updated ? "refunded" : "refund_failed"}`,
  );
}

const NOTICES: Record<string, string> = {
  refreshed: "Status refreshed from Stripe.",
  refresh_failed: "Couldn't reach Stripe to refresh this order.",
  voided: "Order voided.",
  void_failed: "Couldn't void this order — it may already be paid or void.",
  refunded: "Payment refunded and the diver's trip payment gate was reopened.",
  refund_failed: "Couldn't refund this order — it may not have a refundable payment yet.",
};

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, id } = await params;
  const { notice } = await searchParams;
  const db = await getDb();
  const order = await getOrder(db, session.user.shopId, id);
  if (!order) notFound();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <FlashParams params={["notice"]} />
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium tracking-widest text-primary uppercase">{shopSlug}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{order.person.fullName}</h1>
          <p className="mt-1 text-muted">{order.order.description || "Order"}</p>
        </div>
        <Link
          href={`/shop/${shopSlug}/orders`}
          className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken"
        >
          All orders
        </Link>
      </div>

      {notice ? (
        <p
          role="status"
          className={`mb-6 rounded-lg px-4 py-3 text-sm font-medium ${
            notice === "refresh_failed" || notice === "void_failed" || notice === "refund_failed"
              ? "bg-danger/10 text-danger"
              : "bg-success/10 text-success"
          }`}
        >
          {NOTICES[notice] ?? notice}
        </p>
      ) : null}

      <section className="rounded-lg border border-border bg-surface p-6">
        <div className="flex items-center justify-between gap-3">
          <span
            className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${
              order.order.status === "paid"
                ? "bg-success/10 text-success"
                : order.order.status === "open"
                  ? "bg-primary/10 text-primary"
                  : "bg-surface-sunken text-muted"
            }`}
          >
            {STATUS_LABELS[order.order.status] ?? order.order.status}
          </span>
          <span className="text-lg font-semibold tabular-nums">
            {centsToDisplay(order.order.totalCents, order.order.currency)}
          </span>
        </div>

        <ul className="mt-4 divide-y divide-border">
          {order.lineItems.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                {item.description}{" "}
                <span className="text-muted">
                  ({KIND_LABELS[item.kind] ?? item.kind}
                  {item.quantity > 1 ? ` × ${item.quantity}` : ""})
                </span>
              </span>
              <span className="tabular-nums">
                {centsToDisplay(item.unitAmountCents * item.quantity, order.order.currency)}
              </span>
            </li>
          ))}
        </ul>

        {order.order.hostedInvoiceUrl ? (
          <p className="mt-4 text-sm">
            <a
              href={order.order.hostedInvoiceUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline"
            >
              Open the payable invoice
            </a>{" "}
            — share this link with the customer if Stripe's email didn't reach them.
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {order.order.status === "open" ? (
            <>
              <form action={refreshAction}>
                <input type="hidden" name="orderId" value={order.order.id} />
                <button
                  type="submit"
                  className="min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken"
                >
                  Refresh status
                </button>
              </form>
              <form action={voidAction}>
                <input type="hidden" name="orderId" value={order.order.id} />
                <button
                  type="submit"
                  className="min-h-11 rounded-lg border border-danger/40 bg-surface px-4 py-2 text-sm font-medium text-danger transition-colors duration-200 hover:bg-danger/10"
                >
                  Void order
                </button>
              </form>
            </>
          ) : null}
          {order.order.status === "paid" ? (
            <form action={refundAction}>
              <input type="hidden" name="orderId" value={order.order.id} />
              <button
                type="submit"
                className="min-h-11 rounded-lg border border-danger/40 bg-surface px-4 py-2 text-sm font-medium text-danger transition-colors duration-200 hover:bg-danger/10"
              >
                Refund payment
              </button>
            </form>
          ) : null}
        </div>
      </section>
    </main>
  );
}
