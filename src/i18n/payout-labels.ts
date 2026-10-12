import { formatMoneyCents, formatMonthDay } from "@/lib/format";
import { utcToWallTime } from "@/lib/zoned";
import type { StaffTranslator } from "./staff-messages";

/** What a payout line needs off the stored row (`ShopPayout`, `src/db/payouts.ts`). */
export type PayoutLineInput = {
  amountCents: number;
  currency: string;
  status: string;
  arrivalDate: Date;
  coveredFrom: Date | null;
  coveredTo: Date | null;
};

function dayIn(date: Date, timeZone: string, locale: string): string {
  const wall = utcToWallTime(date, timeZone);
  return formatMonthDay(wall.month, wall.day, locale);
}

/**
 * **One payout as a sentence** an owner can hold against a bank statement:
 * "Paid out $1,842.00 on October 3, covering September 27 to October 1"
 * (ADR 20261012-payouts-reach-diveday).
 *
 * The amount is cent-exact: this line is reconciled, not scanned. The arrival
 * day is Stripe's `arrival_date`, a calendar day Stripe states at UTC midnight,
 * so it is read in UTC; running it through the shop's zone would print the day
 * before for every shop west of Greenwich. The span is two instants, the
 * earliest and latest money the payout carried, so it is read in the shop's
 * zone like every other moment on these pages. A payout Stripe did not itemize
 * says when and how much, and no span.
 */
export function payoutSentence(
  t: StaffTranslator,
  payout: PayoutLineInput,
  { locale, timeZone }: { locale: string; timeZone: string },
): string {
  const amount = formatMoneyCents(payout.amountCents, payout.currency, locale);
  const date = dayIn(payout.arrivalDate, "UTC", locale);
  if (payout.status === "failed") return t("shared.payouts.failed", { amount, date });
  if (!payout.coveredFrom || !payout.coveredTo) {
    return t("shared.payouts.paidNoSpan", { amount, date });
  }
  const from = dayIn(payout.coveredFrom, timeZone, locale);
  const to = dayIn(payout.coveredTo, timeZone, locale);
  return from === to
    ? t("shared.payouts.paidOneDay", { amount, date, from })
    : t("shared.payouts.paid", { amount, date, from, to });
}
