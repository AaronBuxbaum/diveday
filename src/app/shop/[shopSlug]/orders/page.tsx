import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { listOrders } from "@/db/orders";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = { title: "Orders — Scuba" };

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  paid: "Paid",
  void: "Void",
  uncollectible: "Uncollectible",
};

function statusClasses(status: string): string {
  if (status === "paid") return "bg-success/10 text-success";
  if (status === "open") return "bg-primary/10 text-primary";
  return "bg-surface-sunken text-muted";
}

export default async function OrdersPage({ params }: { params: Promise<{ shopSlug: string }> }) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const db = await getDb();
  const [rows, account] = await Promise.all([
    listOrders(db, session.user.shopId),
    getShopStripeAccount(db, session.user.shopId),
  ]);
  const ready = canAcceptPayments(account);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium tracking-widest text-primary uppercase">{shopSlug}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Orders</h1>
          <p className="mt-1 text-muted">
            {rows.length === 0
              ? "No orders yet."
              : `${rows.length} order${rows.length === 1 ? "" : "s"}.`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Link
            href={`/shop/${shopSlug}/settings/payments`}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken"
          >
            Payment settings
          </Link>
          {ready ? (
            <Link
              href={`/shop/${shopSlug}/orders/new`}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
            >
              New order
            </Link>
          ) : null}
        </div>
      </header>

      {!ready ? (
        <p className="mb-6 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm font-medium text-warning">
          Connect a Stripe account in{" "}
          <Link href={`/shop/${shopSlug}/settings/payments`} className="underline">
            payment settings
          </Link>{" "}
          before creating an order.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-10 text-center">
          <h2 className="font-medium">No orders on the books</h2>
          <p className="mt-1 text-sm text-muted">
            Create an order to invoice a diver for a trip, course, or gear.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map(({ order, person }) => (
            <li key={order.id}>
              <Link
                href={`/shop/${shopSlug}/orders/${order.id}`}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5 transition-colors duration-200 hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <h2 className="font-medium">{person.fullName}</h2>
                  <p className="text-sm text-muted">
                    {order.description || "Order"} · ${(order.totalCents / 100).toFixed(2)}{" "}
                    {order.currency.toUpperCase()}
                  </p>
                </div>
                <span
                  className={`inline-block shrink-0 rounded-full px-3 py-1 text-sm font-medium tabular-nums ${statusClasses(order.status)}`}
                >
                  {STATUS_LABELS[order.status] ?? order.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
