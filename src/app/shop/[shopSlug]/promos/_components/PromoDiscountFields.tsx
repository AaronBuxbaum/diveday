import { controlClass, Field } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyScanned } from "@/lib/format";
import { currencySymbol } from "@/lib/money";
import { promoDiscountOf } from "@/lib/promo-codes";

/** "15% off", or "$20 off each booking": what one code or deal takes off. */
export function promoDiscountText(
  t: StaffTranslator,
  row: { discountPercent: number | null; discountAmountCents: number | null },
  currency: string,
  locale: string,
): string {
  const discount = promoDiscountOf(row);
  return discount?.kind === "amount"
    ? t("promos.discountAmountOff", {
        amount: formatMoneyScanned(discount.amountCents, currency, locale),
      })
    : t("promos.discountOff", { percent: discount?.percent ?? 0 });
}

/**
 * A percent, or a fixed amount taken once off the whole booking
 * (`PromoDiscount`, src/lib/promo-codes.ts). Two boxes rather than one clever
 * one: the type is a choice the staffer makes, and the number means what the
 * type beside it says. The range is checked on the server, where a refusal
 * lands on the number.
 */
export function PromoDiscountFields({
  t,
  currency,
  locale,
  error,
}: {
  t: StaffTranslator;
  currency: string;
  locale: string;
  error: string | undefined;
}) {
  return (
    <>
      <Field label={t("promos.fields.discountKind")}>
        <select name="discountKind" defaultValue="percent" className={controlClass}>
          <option value="percent">{t("promos.fields.discountKindPercent")}</option>
          <option value="amount">
            {t("promos.fields.discountKindAmount", { currency: currencySymbol(currency, locale) })}
          </option>
        </select>
      </Field>
      <Field label={t("promos.fields.discount")} error={error}>
        <input
          name="discount"
          type="number"
          inputMode="decimal"
          required
          min={1}
          step="any"
          defaultValue={10}
          className={`${controlClass} tabular-nums`}
        />
      </Field>
    </>
  );
}
