import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { getOrder, refreshOrderStatus, refundOrder, voidOrder } from "@/db/orders";
import { getShopById } from "@/db/shops";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = { title: "Order — DiveDay" };

const STATUS_LABELS: Record<string, string> = {
  open: "Open — awaiting payment",
  paid: "Paid",
  void: "Void",
  uncollectible: "Uncollectible",
  refunded: "Refunded",
};

const STATUS_TONES: Record<string, BadgeTone> = {
  paid: "success",
  open: "primary",
};

const KIND_LABELS: Record<string, string> = {
  trip_fee: "Trip fee",
  course_fee: "Course fee",
  rental: "Rental",
  nitrox: "Nitrox",
  deposit: "Deposit",
  merchandise: "Merchandise",
  other: "Other",
};

function centsToDisplay(cents: number, currency: string): string {
  return `$${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

/**
 * Demo shops carry seeded orders whose Stripe invoice ids are fabricated (the
 * demo never connects a real Stripe account). Refresh / void / refund all reach
 * out to Stripe with those ids and would error against live platform
 * credentials, so on a demo shop these actions are refused before any Stripe
 * call — and the buttons are rendered disabled to match (src/db/seed.ts).
 */
async function isDemoShop(db: Awaited<ReturnType<typeof getDb>>, shopId: string): Promise<boolean> {
  const shop = await getShopById(db, shopId);
  return shop?.isDemo ?? false;
}

async function refreshAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const orderId = String(formData.get("orderId") ?? "");
  const db = await getDb();
  const back = `/shop/${session.user.shopSlug}/orders/${orderId}`;
  if (await isDemoShop(db, session.user.shopId)) {
    revalidateAndRedirect(back, `${back}?notice=demo_disabled`);
    return;
  }
  const updated = orderId ? await refreshOrderStatus(db, session.user.shopId, orderId) : null;
  revalidateAndRedirect(back, `${back}?notice=${updated ? "refreshed" : "refresh_failed"}`);
}

async function voidAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const orderId = String(formData.get("orderId") ?? "");
  const db = await getDb();
  const back = `/shop/${session.user.shopSlug}/orders/${orderId}`;
  if (await isDemoShop(db, session.user.shopId)) {
    revalidateAndRedirect(back, `${back}?notice=demo_disabled`);
    return;
  }
  const updated = orderId ? await voidOrder(db, session.user.shopId, orderId) : null;
  revalidateAndRedirect(back, `${back}?notice=${updated ? "voided" : "void_failed"}`);
}

async function refundAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const orderId = String(formData.get("orderId") ?? "");
  const db = await getDb();
  const back = `/shop/${session.user.shopSlug}/orders/${orderId}`;
  if (await isDemoShop(db, session.user.shopId)) {
    revalidateAndRedirect(back, `${back}?notice=demo_disabled`);
    return;
  }
  const updated = orderId ? await refundOrder(db, session.user.shopId, orderId) : null;
  revalidateAndRedirect(back, `${back}?notice=${updated ? "refunded" : "refund_failed"}`);
}

const FAILED_NOTICES = new Set(["refresh_failed", "void_failed", "refund_failed"]);

const NOTICE_MESSAGES: Record<string, string> = {
  refreshed: "Status refreshed from Stripe.",
  refresh_failed: "Couldn't reach Stripe to refresh this order.",
  voided: "Order voided.",
  void_failed: "Couldn't void this order — it may already be paid or void.",
  refunded: "Payment refunded — the trip now shows as unpaid for this diver.",
  refund_failed: "Couldn't refund this order — it may not have a refundable payment yet.",
  demo_disabled:
    "This is a demo order — it isn't backed by a live Stripe invoice, so it can't be changed.",
};

/** Why a Stripe action is greyed out on a demo shop — shown on hover and to AT. */
const DEMO_ACTION_HINT =
  "Demo orders aren't backed by a live Stripe invoice, so this action is disabled.";

/** A greyed-out stand-in for a Stripe action a demo shop can't perform. */
function DisabledDemoButton({
  label,
  variant,
}: {
  label: string;
  variant: "secondary" | "danger";
}) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title={DEMO_ACTION_HINT}
      className={buttonClass({
        variant,
        className: `cursor-not-allowed opacity-50${variant === "secondary" ? " text-foreground" : ""}`,
      })}
    >
      {label}
    </button>
  );
}

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
  const demo = await isDemoShop(db, session.user.shopId);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow="Front desk"
        title={order.person.fullName}
        description={order.order.description || "Order"}
        actions={
          <Link
            href={`/shop/${shopSlug}/divers/${order.person.id}`}
            className={buttonClass({ variant: "secondary", className: "text-foreground" })}
          >
            Back to diver
          </Link>
        }
      />

      {notice ? (
        <div className="mb-6">
          <ShopNotice
            tone={
              notice === "demo_disabled"
                ? "neutral"
                : FAILED_NOTICES.has(notice)
                  ? "danger"
                  : "success"
            }
            role={FAILED_NOTICES.has(notice) ? "alert" : "status"}
          >
            {NOTICE_MESSAGES[notice] ?? notice}
          </ShopNotice>
        </div>
      ) : null}

      <section className="rounded-lg border border-border bg-surface p-6">
        <div className="flex items-center justify-between gap-3">
          <Badge tone={STATUS_TONES[order.order.status] ?? "neutral"}>
            {STATUS_LABELS[order.order.status] ?? order.order.status}
          </Badge>
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
            demo ? (
              <>
                <DisabledDemoButton label="Refresh status" variant="secondary" />
                <DisabledDemoButton label="Void order" variant="danger" />
              </>
            ) : (
              <>
                <form action={refreshAction}>
                  <input type="hidden" name="orderId" value={order.order.id} />
                  <SubmitButton
                    pendingLabel="Refreshing…"
                    className={buttonClass({ variant: "secondary", className: "text-foreground" })}
                  >
                    Refresh status
                  </SubmitButton>
                </form>
                <form action={voidAction}>
                  <input type="hidden" name="orderId" value={order.order.id} />
                  <SubmitButton
                    pendingLabel="Voiding…"
                    className={buttonClass({ variant: "danger" })}
                  >
                    Void order
                  </SubmitButton>
                </form>
              </>
            )
          ) : null}
          {order.order.status === "paid" ? (
            demo ? (
              <DisabledDemoButton label="Refund payment" variant="danger" />
            ) : (
              <form action={refundAction}>
                <input type="hidden" name="orderId" value={order.order.id} />
                <SubmitButton
                  pendingLabel="Refunding…"
                  className={buttonClass({ variant: "danger" })}
                >
                  Refund payment
                </SubmitButton>
              </form>
            )
          ) : null}
        </div>
        {demo && (order.order.status === "open" || order.order.status === "paid") ? (
          <p className="mt-2 text-xs text-muted">{DEMO_ACTION_HINT}</p>
        ) : null}
      </section>
    </main>
  );
}
