import { buttonClass } from "@/components/ui/button";
import { DateField, Field } from "@/components/ui/form";
import type { RecordedPurchaseDay } from "@/features/money/recorded-purchases";
import { ORDER_COLLECTION_KEYS } from "@/i18n/order-labels";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate } from "@/lib/calendar-date";
import { formatMoneyCents, formatTimeZoneGeneric } from "@/lib/format";
import { shopPath } from "@/lib/staff-notices";
import type { OrdersSearch } from "../_lib/orders-search";

export function RecordedPurchaseDaySummary({
  data,
  shopSlug,
  locale,
  t,
  search,
}: {
  data: RecordedPurchaseDay | null;
  search: OrdersSearch;
  shopSlug: string;
  locale: string;
  t: StaffTranslator;
}) {
  if (!data) return null;
  const money = (cents: number | null, currency: string) =>
    cents === null ? t("orders.purchaseDay.unknown") : formatMoneyCents(cents, currency, locale);
  return (
    <details className="mt-6 rounded-lg border border-border p-4">
      <summary className="flex min-h-11 cursor-pointer items-center text-base font-medium">
        {/* The shop's own date and the zone's short name ("Jul 21, 2026 ·
            ET"), never "2026-07-21 · America/New_York". */}
        {t("orders.purchaseDay.title")} · {formatCalendarDate(data.day, locale)} ·{" "}
        {formatTimeZoneGeneric(locale, data.timezone)}
      </summary>
      <p className="mt-2 text-sm text-muted">{t("orders.purchaseDay.scope")}</p>
      <form
        method="get"
        action={shopPath(shopSlug, "orders")}
        className="mt-4 flex flex-wrap items-end gap-3"
      >
        {Object.entries(search)
          .filter(
            ([key, value]) =>
              key !== "receiptDay" &&
              key !== "purchase" &&
              key !== "add" &&
              typeof value === "string",
          )
          .map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
        <Field label={t("orders.purchaseDay.day")}>
          <DateField name="receiptDay" defaultValue={data.day} required />
        </Field>
        <button type="submit" className={buttonClass({ variant: "secondary" })}>
          {t("orders.purchaseDay.show")}
        </button>
      </form>
      {data.receipts.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.receipts.map((group) => {
            const key = ORDER_COLLECTION_KEYS[group.method as keyof typeof ORDER_COLLECTION_KEYS] as
              | StaffMessageKey
              | undefined;
            return (
              <section
                key={`${group.currency}:${group.method}`}
                className="rounded-lg bg-surface-sunken p-3"
              >
                <h3 className="text-base font-semibold">
                  {key ? t(key) : t("orders.purchaseDay.unknown")} · {group.currency.toUpperCase()}
                </h3>
                <dl className="mt-2 space-y-1 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt>{t("orders.purchaseDay.count")}</dt>
                    <dd>{group.count}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>{t("orders.purchaseDay.gross")}</dt>
                    <dd className="tabular-nums">{money(group.grossCents, group.currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>{t("orders.purchaseDay.tax")}</dt>
                    <dd className="tabular-nums">{money(group.taxCents, group.currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>{t("orders.purchaseDay.tip")}</dt>
                    <dd className="tabular-nums">{money(group.tipCents, group.currency)}</dd>
                  </div>
                </dl>
                {group.unknownTax ? (
                  <p className="mt-2 text-sm text-muted">
                    {t("orders.purchaseDay.unknownTax", { count: group.unknownTax })}
                  </p>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">{t("orders.purchaseDay.empty")}</p>
      )}
      {data.returns.length ? (
        <section className="mt-5">
          <h3 className="text-base font-semibold">{t("orders.purchaseDay.returns")}</h3>
          <p className="mt-1 text-sm text-muted">{t("orders.purchaseDay.returnScope")}</p>
          <ul className="mt-2 space-y-1">
            {data.returns.map((group) => (
              <li key={group.currency} className="text-sm">
                {group.currency.toUpperCase()} · {money(group.amountCents, group.currency)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {data.historyMayBePruned ? (
        <p className="mt-3 text-sm text-muted">{t("orders.purchaseDay.pruned")}</p>
      ) : null}
      {data.voided ? (
        <p className="mt-3 text-sm text-muted">
          {t("orders.purchaseDay.voided", { count: data.voided })}
        </p>
      ) : null}
    </details>
  );
}
