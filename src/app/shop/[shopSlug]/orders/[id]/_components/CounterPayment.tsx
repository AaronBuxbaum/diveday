import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { OrderCollection } from "@/db/schema";
import { ORDER_PAID_AT_COUNTER_KEYS } from "@/i18n/order-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { voidCounterAction } from "../counter-actions";

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
