import type { getOrder } from "@/db/orders";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents } from "@/lib/format";
import { KIND_KEYS } from "../order-detail-keys";

type OrderDetail = NonNullable<Awaited<ReturnType<typeof getOrder>>>;
/** The receipt's unchanged line ledger, separate from provider and return controls. */
export function OrderReceiptLines({
  lineItems,
  currency,
  taxCents,
  includedTax,
  locale,
  t,
}: {
  lineItems: OrderDetail["lineItems"];
  currency: string;
  taxCents: number;
  includedTax: boolean;
  locale: string;
  t: StaffTranslator;
}) {
  return (
    <>
      <ul className="mt-4 divide-y divide-border">
        {lineItems.map((item) => (
          <li key={item.id} className="flex items-baseline justify-between gap-3 py-2 text-base">
            <span className="min-w-0 break-words">
              {item.description}{" "}
              <span className="text-muted">
                ({t(KIND_KEYS[item.kind])}
                {item.quantity > 1 ? ` × ${item.quantity}` : ""})
              </span>
            </span>
            <span className="shrink-0 tabular-nums">
              {formatMoneyCents(item.unitAmountCents * item.quantity, currency, locale)}
            </span>
          </li>
        ))}
      </ul>

      {taxCents > 0 ? (
        <dl className="mt-3 flex justify-end gap-2 text-base">
          <dt className="text-muted">
            {t(includedTax ? "orders.purchase.includedTax" : "orders.detail.tax")}
          </dt>
          <dd className="font-medium tabular-nums">
            {formatMoneyCents(taxCents, currency, locale)}
          </dd>
        </dl>
      ) : null}
    </>
  );
}
