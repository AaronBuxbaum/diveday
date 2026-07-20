import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { formatShortDate } from "@/lib/format";
import { refundPaymentAction } from "../actions";
import { type DiverProfile, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, type Shop } from "./shared";

export function PaymentsSection({
  diver,
  shop,
  shopSlug,
  personId,
}: {
  diver: DiverProfile;
  shop: Shop;
  shopSlug: string;
  personId: string;
}) {
  return (
    <section className="mt-10 border-t border-border pt-8" aria-labelledby="payments-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="payments-heading" className="text-lg font-semibold">
            Payments
          </h2>
          <p className="mt-1 text-sm text-muted">
            Payment status, invoices, and refunds stay with the diver so the next action is easy to
            find.
          </p>
        </div>
        <Link href={`/shop/${shopSlug}/orders/new?personId=${personId}`} className={buttonClass()}>
          New payment
        </Link>
      </div>

      {diver.bookings.length === 0 && diver.orders.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-surface p-5 text-sm text-muted">
          No payments yet — they’ll appear here once this diver books a trip or you send an invoice.
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
                    {formatShortDate(trip.startsAt, "en-US", shop.timezone)} · booking payment
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {bookingPayment
                      ? `Payment gate: ${PAYMENT_STATUS_LABELS[bookingPayment.payment.status] ?? bookingPayment.payment.status}`
                      : "Payment gate: not recorded"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {orderRow ? (
                    <Link
                      href={`/shop/${shopSlug}/orders/${orderRow.order.id}`}
                      className={buttonClass({ variant: "secondary", size: "sm" })}
                    >
                      Open payment
                    </Link>
                  ) : (
                    <Link
                      href={`/shop/${shopSlug}/orders/new?personId=${personId}&bookingId=${booking.id}`}
                      className={buttonClass({ variant: "secondary", size: "sm" })}
                    >
                      Create invoice
                    </Link>
                  )}
                  {orderRow?.order.status === "paid" ? (
                    <form action={refundPaymentAction.bind(null, shopSlug, personId)}>
                      <input type="hidden" name="orderId" value={orderRow.order.id} />
                      <SubmitButton
                        pendingLabel="Refunding…"
                        className={buttonClass({ variant: "danger", size: "sm" })}
                      >
                        Refund
                      </SubmitButton>
                    </form>
                  ) : null}
                  <span className="rounded-full bg-surface-sunken px-3 py-1 text-sm text-muted">
                    {orderRow
                      ? (ORDER_STATUS_LABELS[orderRow.order.status] ?? orderRow.order.status)
                      : bookingPayment
                        ? (PAYMENT_STATUS_LABELS[bookingPayment.payment.status] ??
                          bookingPayment.payment.status)
                        : "No invoice"}
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
                  <p className="font-medium">{order.description || "Shop payment"}</p>
                  <p className="text-sm text-muted">
                    ${(order.totalCents / 100).toFixed(2)} {order.currency.toUpperCase()} · no trip
                    attached
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/shop/${shopSlug}/orders/${order.id}`}
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                  >
                    Open payment
                  </Link>
                  {order.status === "paid" ? (
                    <form action={refundPaymentAction.bind(null, shopSlug, personId)}>
                      <input type="hidden" name="orderId" value={order.id} />
                      <SubmitButton
                        pendingLabel="Refunding…"
                        className={buttonClass({ variant: "danger", size: "sm" })}
                      >
                        Refund
                      </SubmitButton>
                    </form>
                  ) : null}
                  <span className="rounded-full bg-surface-sunken px-3 py-1 text-sm text-muted">
                    {ORDER_STATUS_LABELS[order.status] ?? order.status}
                  </span>
                </div>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
