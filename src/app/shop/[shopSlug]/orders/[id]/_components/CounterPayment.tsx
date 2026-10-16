import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { OrderCollection } from "@/db/schema";
import { ORDER_COLLECTION_KEYS, ORDER_PAID_AT_COUNTER_KEYS } from "@/i18n/order-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { recordPaymentAction, voidCounterAction } from "../counter-actions";

type CounterCollection = Exclude<OrderCollection, "stripe_invoice">;

/**
 * How and when money taken at the counter was taken: "Paid in cash Fri, Oct 9"
 * (ADR 20261009-counter-payments). It stands where a Stripe order's invoice
 * link would, and says what that link would have: where the money is.
 */
export function PaidAtCounterLine({
  collection,
  paidAt,
  locale,
  timezone,
  t,
}: {
  collection: CounterCollection;
  paidAt: Date;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  return (
    <p className="mt-2 text-sm text-muted">
      {t(ORDER_PAID_AT_COUNTER_KEYS[collection], {
        date: formatShortDate(paidAt, locale, timezone),
      })}
    </p>
  );
}

/** An owner's or manager's one correction to a counter order: void it. */
export function VoidCounterOrderForm({ orderId, t }: { orderId: string; t: StaffTranslator }) {
  return (
    <form action={voidCounterAction}>
      <input type="hidden" name="orderId" value={orderId} />
      <SubmitButton
        pendingLabel={t("orders.detail.voiding")}
        className={buttonClass({ variant: "danger" })}
      >
        {t("orders.detail.voidOrder")}
      </SubmitButton>
    </form>
  );
}

/**
 * **Record payment: cash / card machine** on an open invoice (fourth UX review,
 * item 19): one tap per way the money came, since the person at the counter
 * knows which and there is nothing else to say. A form per method, so each
 * button's in-flight state is its own.
 */
export function RecordPaymentForm({ orderId, t }: { orderId: string; t: StaffTranslator }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium">{t("orders.detail.recordPayment.label")}</span>
      {(["cash", "card_machine"] as const).map((collection) => (
        <form key={collection} action={recordPaymentAction}>
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="collection" value={collection} />
          <SubmitButton
            pendingLabel={t("orders.detail.recordPayment.recording")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t(ORDER_COLLECTION_KEYS[collection])}
          </SubmitButton>
        </form>
      ))}
    </div>
  );
}
