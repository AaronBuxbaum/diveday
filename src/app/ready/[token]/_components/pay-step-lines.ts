import type { DiverTranslator } from "@/i18n/messages";

/** What the Pay step needs from the booking's receipt. */
type Receipt = {
  amountCents: number | null;
  currency: string;
  isDeposit: boolean;
  balanceDueCents: number;
} | null;

/**
 * The Pay step's two lines, composed for the readiness thread.
 *
 * `paidLine` is what the step says once it has settled: the figure, which is
 * the one thing the step's own word ("Paid") cannot carry. The receipt's
 * currency, not the shop's — a shop that switches currency next season must
 * not restate last season's charge (ADR 20260731-shop-currency).
 *
 * "N package dives left" (owner decision 2026-10-09) rides on it: the one
 * number a diver who bought a package asks, said where the money already is.
 * The caller counts it as `countSpendableDives` does, so a lapsed or spent dive
 * is never offered, and a diver who holds none hears nothing about packages.
 */
export function payStepLines(
  t: DiverTranslator,
  money: (cents: number, currency: string) => string,
  receipt: Receipt,
  packageDivesLeft: number,
): { paidLine: string; depositBalanceLine: string | null } {
  const paid =
    receipt && receipt.amountCents !== null
      ? money(receipt.amountCents, receipt.currency)
      : t("ready.checklistDetail.paymentDone");
  return {
    paidLine:
      packageDivesLeft > 0
        ? t("ready.packageDivesLeft", { line: paid, count: packageDivesLeft })
        : paid,
    depositBalanceLine:
      receipt?.isDeposit && receipt.balanceDueCents > 0
        ? t("booking.paymentDepositBalance", {
            balance: money(receipt.balanceDueCents, receipt.currency),
          })
        : null,
  };
}
