import { randomUUID } from "node:crypto";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import type { Order } from "@/db/schema";
import type { purchaseRefundHistory } from "@/features/recorded-purchases";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents, formatShortDate } from "@/lib/format";
import { currencyFractionDigits, minorToMajor } from "@/lib/money";
import { recordPurchaseRefundAction } from "../../purchase-actions";

export function RecordedPurchaseRefund({
  order,
  history,
  canRefund,
  locale,
  timezone,
  t,
}: {
  order: Order;
  history: Awaited<ReturnType<typeof purchaseRefundHistory>>;
  canRefund: boolean;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  if (!order.counterReceipt || order.stripeInvoiceId || order.bookingId) return null;
  return (
    <section className="mt-6 space-y-4">
      {order.counterReceipt.reference ? (
        <p className="break-words text-base">
          <span className="text-muted">{t("orders.purchase.reference")}:</span>{" "}
          {order.counterReceipt.reference}
        </p>
      ) : null}
      {order.counterReceipt.tipCents > 0 ? (
        <p className="text-base">
          {t("orders.purchase.tip")}:{" "}
          {formatMoneyCents(order.counterReceipt.tipCents, order.currency, locale)}
        </p>
      ) : null}
      {canRefund &&
      ["paid", "partly_refunded"].includes(order.status) &&
      order.amountPaidCents > 0 ? (
        <details>
          <summary
            className={buttonClass({
              variant: "secondary",
              className: "w-fit cursor-pointer list-none",
            })}
          >
            {t("orders.purchase.refundTitle")}
          </summary>
          <form action={recordPurchaseRefundAction} className="mt-4 space-y-4">
            <p className="text-sm text-muted">{t("orders.purchase.refundExplanation")}</p>
            <input type="hidden" name="orderId" value={order.id} />
            <input type="hidden" name="attemptId" value={randomUUID()} />
            <input type="hidden" name="expectedRefundedCents" value={order.refundedCents} />
            <input type="hidden" name="currency" value={order.currency} />
            <FieldGrid columns={2}>
              <Field
                label={t("orders.purchase.refundAmount", {
                  currency: order.currency.toUpperCase(),
                })}
              >
                <input
                  name="amount"
                  type="number"
                  inputMode="decimal"
                  required
                  min={currencyFractionDigits(order.currency) === 0 ? 1 : 0.01}
                  max={minorToMajor(order.amountPaidCents, order.currency)}
                  step={currencyFractionDigits(order.currency) === 0 ? "1" : "0.01"}
                  className={controlClass}
                />
              </Field>
              <Field label={t("orders.purchase.refundReason")}>
                <input
                  name="reason"
                  type="text"
                  required
                  maxLength={200}
                  className={controlClass}
                />
              </Field>
            </FieldGrid>
            <SubmitButton
              pendingLabel={t("words.busy.recording")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("orders.purchase.refundSubmit")}
            </SubmitButton>
          </form>
        </details>
      ) : null}
      {history.length > 0 ? (
        <div>
          <h2 className="font-medium">{t("orders.purchase.refundHistory")}</h2>
          <ul className="mt-2 divide-y divide-border">
            {history.map((row) => (
              <li key={row.id} className="space-y-1 py-3">
                <p className="text-base font-medium">
                  {formatMoneyCents(Number(row.params.amountCents) || 0, order.currency, locale)} ·{" "}
                  {row.actorName ?? row.params.actor}
                </p>
                <p className="break-words text-base">{row.params.reason}</p>
                <p className="text-sm text-muted">{formatShortDate(row.at, locale, timezone)}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
