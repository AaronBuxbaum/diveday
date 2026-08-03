import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { type StaffMessageKey, type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents, formatShortDate } from "@/lib/format";
import { refundPaymentAction } from "../actions";
import { type DiverProfile, ORDER_STATUS_KEYS, PAYMENT_STATUS_KEYS, type Shop } from "./shared";

/**
 * Newest-first, then the rest behind a disclosure — same treatment as the
 * `ShopHistory` section below this one (`SHOP_HISTORY_PREVIEW_COUNT`), for the
 * same reason: a long-tenured diver's payment history otherwise buries the
 * page under one row per trip they've ever booked, with no ceiling.
 */
const PAYMENTS_PREVIEW_COUNT = 8;

type BookingEntry = DiverProfile["bookings"][number];
type OrderEntry = DiverProfile["orders"][number];

type PaymentRowItem =
  | { kind: "booking"; date: Date; entry: BookingEntry }
  | { kind: "order"; date: Date; entry: OrderEntry };

function paymentRowKey(item: PaymentRowItem): string {
  return item.kind === "booking"
    ? `booking:${item.entry.booking.id}`
    : `order:${item.entry.order.id}`;
}

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
        className={buttonClass({
          variant: "danger",
          size: "sm",
          className: "cursor-not-allowed opacity-50",
        })}
      >
        {t("divers.payments.refund")}
      </button>
    );
  }
  return (
    <form action={refundPaymentAction.bind(null, shopSlug, personId)}>
      <input type="hidden" name="orderId" value={orderId} />
      <SubmitButton
        pendingLabel={t("divers.payments.refunding")}
        className={buttonClass({ variant: "danger", size: "sm" })}
      >
        {t("divers.payments.refund")}
      </SubmitButton>
    </form>
  );
}

function PaymentRow({
  item,
  diver,
  shop,
  locale,
  shopSlug,
  personId,
  canRefund,
  paymentsConnected,
  t,
}: {
  item: PaymentRowItem;
  diver: DiverProfile;
  shop: Shop;
  locale: string;
  shopSlug: string;
  personId: string;
  canRefund: boolean;
  paymentsConnected: boolean;
  t: StaffTranslator;
}) {
  if (item.kind === "booking") {
    const { booking, trip } = item.entry;
    const bookingPayment = diver.bookingPayments.find((row) => row.booking.id === booking.id);
    const orderRow = diver.orders.find((row) => row.order.bookingId === booking.id);
    return (
      <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href={`/shop/${shopSlug}/trips/${trip.id}`}
            className="font-medium hover:text-primary hover:underline"
          >
            {trip.title}
          </Link>
          <p className="text-sm text-muted">
            {formatShortDate(trip.startsAt, locale, shop.timezone)}
            {t("divers.payments.bookingPaymentSuffix")}
          </p>
          <p className="mt-1 text-sm text-muted">
            {bookingPayment
              ? t("divers.payments.paymentStatusText", {
                  status: statusLabel(t, PAYMENT_STATUS_KEYS, bookingPayment.payment.status),
                })
              : t("divers.payments.paymentNotRecorded")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {orderRow ? (
            <Link
              href={`/shop/${shopSlug}/orders/${orderRow.order.id}`}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("divers.payments.openPayment")}
            </Link>
          ) : paymentsConnected ? (
            <Link
              href={`/shop/${shopSlug}/orders/new?personId=${personId}&bookingId=${booking.id}`}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("divers.payments.createOrder")}
            </Link>
          ) : (
            // No connected account means `orders/new` would refuse and bounce
            // straight back here. Offer the thing that unblocks it instead of
            // the button that can't work yet.
            <Link
              href={`/shop/${shopSlug}/settings#money`}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("shared.payments.connect")}
            </Link>
          )}
          {canRefund && orderRow?.order.status === "paid" ? (
            <RefundButton
              orderId={orderRow.order.id}
              shopSlug={shopSlug}
              personId={personId}
              demo={shop.isDemo}
              t={t}
            />
          ) : null}
          <span className="rounded-full bg-surface-sunken px-3 py-1 text-sm text-muted">
            {orderRow
              ? statusLabel(t, ORDER_STATUS_KEYS, orderRow.order.status)
              : bookingPayment
                ? statusLabel(t, PAYMENT_STATUS_KEYS, bookingPayment.payment.status)
                : t("divers.payments.noOrder")}
          </span>
        </div>
      </li>
    );
  }

  const { order } = item.entry;
  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium">
          {order.description || t("divers.payments.shopPaymentFallback")}
        </p>
        <p className="text-sm text-muted">
          {/* The order's *own* stored currency, not today's shop setting — a
              settled amount is evidence of what was charged (docs ADR
              20260731-shop-currency), and the divisor comes from that
              currency's minor unit. */}
          {formatMoneyCents(order.totalCents, order.currency, locale)}
          {t("divers.payments.noTripAttached")}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/shop/${shopSlug}/orders/${order.id}`}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {t("divers.payments.openPayment")}
        </Link>
        {canRefund && order.status === "paid" ? (
          <RefundButton
            orderId={order.id}
            shopSlug={shopSlug}
            personId={personId}
            demo={shop.isDemo}
            t={t}
          />
        ) : null}
        <span className="rounded-full bg-surface-sunken px-3 py-1 text-sm text-muted">
          {statusLabel(t, ORDER_STATUS_KEYS, order.status)}
        </span>
      </div>
    </li>
  );
}

export function PaymentsSection({
  diver,
  shop,
  locale,
  shopSlug,
  personId,
  canRefund,
  paymentsConnected,
}: {
  diver: DiverProfile;
  shop: Shop;
  locale: string;
  shopSlug: string;
  personId: string;
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
  const rows: PaymentRowItem[] = [
    ...diver.bookings.map(
      (entry): PaymentRowItem => ({ kind: "booking", date: entry.trip.startsAt, entry }),
    ),
    ...diver.orders
      .filter(({ order }) => order.bookingId === null)
      .map((entry): PaymentRowItem => ({ kind: "order", date: entry.order.createdAt, entry })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());
  // Newest first, then the rest behind a disclosure — a long-tenured diver's
  // row-per-trip history otherwise buries the New payment button a staffer
  // opened this page for (same reasoning as `ShopHistory` just below it).
  const visible = rows.slice(0, PAYMENTS_PREVIEW_COUNT);
  const rest = rows.slice(PAYMENTS_PREVIEW_COUNT);
  const rowProps = { diver, shop, locale, shopSlug, personId, canRefund, paymentsConnected, t };

  return (
    <section className="mt-10 border-t border-border pt-8" aria-labelledby="payments-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="payments-heading" className="text-lg font-semibold">
            {t("divers.payments.heading")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("divers.payments.description")}</p>
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

      {rows.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-surface p-5 text-sm text-muted">
          {t("divers.payments.noPaymentsYet")}
        </p>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {visible.map((item) => (
              <PaymentRow key={paymentRowKey(item)} item={item} {...rowProps} />
            ))}
          </ul>
          {rest.length > 0 ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-primary hover:underline">
                {t("divers.payments.showOlderPayments", { count: rest.length })}
              </summary>
              <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
                {rest.map((item) => (
                  <PaymentRow key={paymentRowKey(item)} item={item} {...rowProps} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}
