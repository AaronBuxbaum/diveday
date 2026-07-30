import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { type StaffMessageKey, type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { refundPaymentAction } from "../actions";
import { type DiverProfile, ORDER_STATUS_KEYS, PAYMENT_STATUS_KEYS, type Shop } from "./shared";

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

export function PaymentsSection({
  diver,
  shop,
  locale,
  shopSlug,
  personId,
  canRefund,
}: {
  diver: DiverProfile;
  shop: Shop;
  locale: string;
  shopSlug: string;
  personId: string;
  /** Only owners/managers issue refunds (H-14); others don't see the control. */
  canRefund: boolean;
}) {
  const t = staffTranslator(locale);
  return (
    <section className="mt-10 border-t border-border pt-8" aria-labelledby="payments-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="payments-heading" className="text-lg font-semibold">
            {t("divers.payments.heading")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("divers.payments.description")}</p>
        </div>
        <Link href={`/shop/${shopSlug}/orders/new?personId=${personId}`} className={buttonClass()}>
          {t("divers.payments.newPayment")}
        </Link>
      </div>

      {diver.bookings.length === 0 && diver.orders.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-surface p-5 text-sm text-muted">
          {t("divers.payments.noPaymentsYet")}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {diver.bookings.map(({ booking, trip }) => {
            const bookingPayment = diver.bookingPayments.find(
              (row) => row.booking.id === booking.id,
            );
            const orderRow = diver.orders.find((row) => row.order.bookingId === booking.id);
            return (
              <li
                key={booking.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
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
                          status: statusLabel(
                            t,
                            PAYMENT_STATUS_KEYS,
                            bookingPayment.payment.status,
                          ),
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
                  ) : (
                    <Link
                      href={`/shop/${shopSlug}/orders/new?personId=${personId}&bookingId=${booking.id}`}
                      className={buttonClass({ variant: "secondary", size: "sm" })}
                    >
                      {t("divers.payments.createInvoice")}
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
                        : t("divers.payments.noInvoice")}
                  </span>
                </div>
              </li>
            );
          })}
          {diver.orders
            .filter(({ order }) => order.bookingId === null)
            .map(({ order }) => (
              <li
                key={order.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">
                    {order.description || t("divers.payments.shopPaymentFallback")}
                  </p>
                  <p className="text-sm text-muted">
                    ${(order.totalCents / 100).toFixed(2)} {order.currency.toUpperCase()}
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
            ))}
        </ul>
      )}
    </section>
  );
}
