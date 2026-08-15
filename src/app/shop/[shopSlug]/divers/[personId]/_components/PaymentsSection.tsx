import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { ORDER_STATUS_KEYS, ORDER_STATUS_TONES } from "@/i18n/order-labels";
import { type StaffMessageKey, type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents, formatShortDate } from "@/lib/format";
import { refundPaymentAction } from "../actions";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import type { DiverProfile, Shop } from "./shared";

/**
 * Newest-first, then the rest behind a disclosure — same treatment as the
 * `ShopHistory` section below this one (`SHOP_HISTORY_PREVIEW_COUNT`), for the
 * same reason: a long-tenured diver's payment history otherwise buries the
 * page under one row per order, with no ceiling.
 */
const PAYMENTS_PREVIEW_COUNT = 8;

type OrderEntry = DiverProfile["orders"][number];

/** A status this shop's data predates the known set for reads back as itself, not blank. */
function statusLabel(
  t: StaffTranslator,
  keys: Record<string, StaffMessageKey>,
  status: string,
): string {
  const key = keys[status];
  return key ? t(key) : status;
}

/** The refund control — a live form on a real shop, disabled with a reason on the demo. */
function RefundButton({
  orderId,
  shopSlug,
  personId,
  demo,
  t,
}: {
  orderId: string;
  shopSlug: string;
  personId: string;
  demo: boolean;
  t: StaffTranslator;
}) {
  if (demo) {
    return (
      <button
        type="button"
        disabled
        aria-disabled="true"
        title={t("divers.payments.demoRefundHint")}
        // No hand-rolled `cursor-not-allowed opacity-50`: the button *is*
        // `disabled`, and the wrapper's own `disabled:` pair says exactly
        // this. Spelling it a second time both fought the wrapper's opacity
        // (two utilities for one property resolve by stylesheet order) and
        // dimmed the control even when it was not disabled.
        className={buttonClass({ variant: "danger", size: "sm" })}
      >
        {t("divers.payments.refund")}
      </button>
    );
  }
  return (
    <form action={refundPaymentAction.bind(null, shopSlug, personId)}>
      <input type="hidden" name="orderId" value={orderId} />
      {/* `busy`: this control disables itself for the duration of its own
          refund, which is "this is happening", not "you cannot do this" — a
          wait cursor rather than a not-allowed one. */}
      <SubmitButton
        pendingLabel={t("divers.payments.refunding")}
        className={buttonClass({ variant: "danger", size: "sm", busy: true })}
      >
        {t("divers.payments.refund")}
      </SubmitButton>
    </form>
  );
}

/**
 * One order, named by what it billed for.
 *
 * A booking-linked order takes the **trip's** title, not the order's own
 * description. The description is whatever was typed when the invoice was
 * raised, and a shop that words it the same way every time ("Two-tank
 * charter") gets a column of identical rows distinguished only by amount and
 * date. The list this section replaced named the trip, and losing that was a
 * regression the visual diff caught: three charters that read alike are three
 * rows a staffer has to open to tell apart.
 *
 * Naming the trip is also what lets this section stop re-listing the booking
 * itself — that belongs to Upcoming or the history below, whichever the trip
 * falls in.
 */
function OrderRow({
  entry,
  diver,
  shop,
  locale,
  shopSlug,
  personId,
  canRefund,
  t,
}: {
  entry: OrderEntry;
  diver: DiverProfile;
  shop: Shop;
  locale: string;
  shopSlug: string;
  personId: string;
  canRefund: boolean;
  t: StaffTranslator;
}) {
  const { order } = entry;
  const billedFor = order.bookingId
    ? diver.bookings.find(({ booking }) => booking.id === order.bookingId)?.trip.title
    : null;
  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <Link
          href={`/shop/${shopSlug}/orders/${order.id}`}
          className="font-medium hover:text-primary hover:underline"
        >
          {billedFor || order.description || t("divers.payments.shopPaymentFallback")}
        </Link>
        <p className="text-sm text-muted">
          {/* The order's *own* stored currency, not today's shop setting — a
              settled amount is evidence of what was charged (docs ADR
              20260731-shop-currency), and the divisor comes from that
              currency's minor unit. */}
          {formatMoneyCents(order.totalCents, order.currency, locale)} ·{" "}
          {formatShortDate(order.createdAt, locale, shop.timezone)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canRefund && order.status === "paid" ? (
          <RefundButton
            orderId={order.id}
            shopSlug={shopSlug}
            personId={personId}
            demo={shop.isDemo}
            t={t}
          />
        ) : null}
        {/* The canonical `Badge`, in the one tone this status wears app-wide
            (`src/i18n/order-labels.ts`). It was a flat grey pill until now, so
            a refunded order and a paid one read identically on the very list
            a staffer opens to reconcile them. */}
        <Badge tone={ORDER_STATUS_TONES[order.status] ?? "neutral"}>
          {statusLabel(t, ORDER_STATUS_KEYS, order.status)}
        </Badge>
      </div>
    </li>
  );
}

/**
 * Money, and only money.
 *
 * This section used to render a row per *booking* — every trip the diver had
 * ever been on, whether or not a payment was involved — which made it the third
 * list of the same bookings on one page, after Upcoming and the history below.
 * A staffer scrolling the record read the same Saturday charter three times.
 *
 * Now it lists what is genuinely its own: the orders. Each appears once, the
 * booking-linked ones named by what they billed for. Whether a given seat is
 * paid rides on that seat's own row, in whichever list it lives in.
 */
export function PaymentsSection({
  diver,
  shop,
  locale,
  shopSlug,
  personId,
  canRefund,
  paymentsConnected,
  status,
}: {
  diver: DiverProfile;
  shop: Shop;
  locale: string;
  shopSlug: string;
  personId: string;
  /**
   * This section's own outcome — a refund that landed, one that was refused,
   * or the "payments aren't connected" bounce from `orders/new`. All of them
   * used to answer a click made two screens down from the top of the page.
   */
  status?: DiverNotice;
  /** Only owners/managers issue refunds (H-14); others don't see the control. */
  canRefund: boolean;
  /**
   * Whether the shop has a Stripe account that can actually take money. False
   * on every day-one shop, and `orders/new` refuses outright when it is — so
   * the order buttons here become a "Connect payments" link rather than a
   * click that bounces back with a notice.
   */
  paymentsConnected: boolean;
}) {
  const t = staffTranslator(locale);
  const orders = [...diver.orders].sort(
    (a, b) => b.order.createdAt.getTime() - a.order.createdAt.getTime(),
  );
  const visible = orders.slice(0, PAYMENTS_PREVIEW_COUNT);
  const rest = orders.slice(PAYMENTS_PREVIEW_COUNT);
  const rowProps = { diver, shop, locale, shopSlug, personId, canRefund, t };

  return (
    <section className="mt-10 border-t border-border pt-8" aria-labelledby="payments-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="payments-heading" className="text-lg font-semibold">
            {t("divers.payments.heading")}
          </h2>
        </div>
        {paymentsConnected ? (
          <Link
            href={`/shop/${shopSlug}/orders/new?personId=${personId}`}
            className={buttonClass()}
          >
            {t("divers.payments.newPayment")}
          </Link>
        ) : (
          <Link href={`/shop/${shopSlug}/settings#money`} className={buttonClass()}>
            {t("shared.payments.connect")}
          </Link>
        )}
      </div>

      {/* Beside this section's own controls. The refund buttons live per row
          further down, but the header is where both doors into this section
          are, and it is what a staffer bounced back from `orders/new` lands
          looking at. */}
      <DiverFormStatus status={status} shopSlug={shopSlug} locale={locale} className="mt-3" />

      {orders.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-surface p-5 text-sm text-muted">
          {t("divers.payments.noPaymentsYet")}
        </p>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {visible.map((entry) => (
              <OrderRow key={entry.order.id} entry={entry} {...rowProps} />
            ))}
          </ul>
          {rest.length > 0 ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-primary hover:underline">
                {t("divers.payments.showOlderPayments", { count: rest.length })}
              </summary>
              <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
                {rest.map((entry) => (
                  <OrderRow key={entry.order.id} entry={entry} {...rowProps} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}
