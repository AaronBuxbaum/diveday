import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { orderLineItems, orders } from "@/db/schema";
import { ORDER_STATUS_KEYS, ORDER_STATUS_TONES } from "@/i18n/order-labels";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents } from "@/lib/format";
import { SheetCode } from "../../../../print/_components/SheetCode";

const COLLECTION_KEYS: Record<(typeof orders.$inferSelect)["collection"], StaffMessageKey> = {
  cash: "counterRentals.ticket.payment.cash",
  card_machine: "counterRentals.ticket.payment.cardMachine",
  stripe_invoice: "counterRentals.ticket.payment.invoice",
};

/**
 * **What this rental cost, and whether it is paid** (Aaron, 2026-10-09: "it's
 * not totally clear how I charge for it").
 *
 * Read from the order the rental is linked to, never from the rental: the
 * lines and total as billed or recorded, the order's own status word, and how
 * it was taken. An invoice still open carries its Stripe payment page as a
 * code, so the person can pay by card on their phone at the counter, or later
 * from the printed slip; the link beside it opens the same page on the
 * counter's screen. A paid, void or refunded order shows no code.
 */
export function RentalTicketPayment({
  order,
  lineItems,
  locale,
  t,
}: {
  order: typeof orders.$inferSelect;
  lineItems: (typeof orderLineItems.$inferSelect)[];
  locale: string;
  t: StaffTranslator;
}) {
  const money = (cents: number) => formatMoneyCents(cents, order.currency, locale);
  const payable = order.status === "open" && order.hostedInvoiceUrl ? order.hostedInvoiceUrl : null;
  return (
    <section aria-labelledby="ticket-payment-heading" className="mt-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="ticket-payment-heading" className={SECTION_TITLE_CLASS}>
          {t("counterRentals.ticket.payment.heading")}
        </h2>
        <Badge tone={ORDER_STATUS_TONES[order.status]} size="sm">
          {t(ORDER_STATUS_KEYS[order.status])}
        </Badge>
        <span className="text-sm text-muted">{t(COLLECTION_KEYS[order.collection])}</span>
      </div>
      <div
        className={sectionCardClass({
          padding: "none",
          className: "mt-3 flex flex-col gap-6 p-4 sm:flex-row sm:items-start sm:p-5",
        })}
      >
        <ul className="min-w-0 flex-1 divide-y divide-border text-sm">
          {lineItems.map((line) => (
            <li key={line.id} className="flex items-baseline gap-3 py-2 first:pt-0">
              <span className="min-w-0 flex-1">
                {line.description}
                {line.quantity > 1 ? <span className="text-muted"> × {line.quantity}</span> : null}
              </span>
              <span className="tabular-nums">{money(line.quantity * line.unitAmountCents)}</span>
            </li>
          ))}
          {order.taxCents > 0 ? (
            <li className="flex items-baseline gap-3 py-2">
              <span className="flex-1 text-muted">{t("counterRentals.ticket.payment.tax")}</span>
              <span className="tabular-nums">{money(order.taxCents)}</span>
            </li>
          ) : null}
          <li className="flex items-baseline gap-3 pt-2 text-base font-semibold">
            <span className="flex-1">{t("counterRentals.ticket.payment.total")}</span>
            <span className="tabular-nums">{money(order.totalCents)}</span>
          </li>
        </ul>
        {payable ? (
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-center">
            <SheetCode value={payable} label={t("counterRentals.ticket.payment.scan")} size={32} />
            <p className="text-sm font-medium">{t("counterRentals.ticket.payment.scan")}</p>
            <a
              href={payable}
              target="_blank"
              rel="noreferrer"
              className={buttonClass({
                variant: "secondary",
                size: "sm",
                className: "print:hidden",
              })}
            >
              {t("counterRentals.ticket.payment.open")}
            </a>
          </div>
        ) : null}
      </div>
    </section>
  );
}
