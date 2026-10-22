import { formatMoneyScanned } from "@/lib/format";
import { cachedFormatter } from "@/lib/intl-cache";
import { earlyAccessPrice } from "@/lib/marketing";
import { FLAT_MONTHLY_CENTS, type PlanTerms } from "./pricing-plans";

/**
 * A plan's numbers as the figures copy interpolates (ADR
 * 20261022-pricing-ab-test). Figures only, never sentences: the words around
 * them are bundle strings, which take these as ICU parameters.
 *
 * Today's flat price renders as `earlyAccessPrice.price`, the published
 * figure, byte for byte; any other amount is formatted in the reader's locale,
 * whole dollars without their cents.
 */

/** A monthly amount in cents, as the reader reads money. */
export function planMoney(cents: number, locale: string): string {
  return cents === FLAT_MONTHLY_CENTS
    ? earlyAccessPrice.price
    : formatMoneyScanned(cents, "usd", locale);
}

/** Basis points as a percentage in the reader's locale: 300 is "3%", 250 is "2.5%". */
export function planPercent(basisPoints: number, locale: string): string {
  return cachedFormatter("num", Intl.NumberFormat, locale, {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(basisPoints / 10_000);
}

/** The ICU parameters every arm-aware string takes. */
export type PlanCopyParams = {
  /** The monthly fee: the flat plan's price, or the percent plan's base fee. */
  price: string;
  base: string;
  percent: string;
  /** `yes` when the percent plan carries a base fee, for `{hasBase, select, …}`. */
  hasBase: "yes" | "no";
};

export function planCopyParams(terms: PlanTerms, locale: string): PlanCopyParams {
  const money = planMoney(terms.monthlyCents, locale);
  return {
    price: money,
    base: money,
    percent: planPercent(terms.basisPoints, locale),
    hasBase: terms.monthlyCents > 0 ? "yes" : "no",
  };
}
