import { ShopNotice } from "@/components/ShopPageHeader";
import { listPaidAfterCloseCheckouts } from "@/db/checkouts-paid-after-close";
import type { AppDb } from "@/db/client";
import { listStuckPaymentOperations } from "@/db/payment-operations";
import { latestShopPayouts, type ShopPayout } from "@/db/payouts";
import { listFailedRefunds } from "@/db/refund-failures";
import { listOwedShopCancellationRefunds } from "@/db/refunds";
import { payoutSentence } from "@/i18n/payout-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * The Orders index's back-office reads, each behind
 * `canPersonManagePaymentSettings` and none of them run for a reader who
 * cannot see it.
 *
 * - **Stuck operations**: Stripe calls the app started and never saw finish.
 * - **Owed refunds**: money the shop owes divers for departures it cancelled
 *   and could not refund by card — a counter payment, a disconnected Stripe
 *   account, a refund Stripe refused. The sweep that creates most of these
 *   runs hourly from a cron with no human near it, and it tells every
 *   affected diver the shop will be in touch; until this panel there was
 *   nothing on any screen that said so (ADR
 *   20260813-shop-cancellation-refunds-itself's own consequence).
 * - **Paid after close**: money Stripe captured on a checkout DiveDay had
 *   already closed (issue #2335): no seat was marked paid from it, so it is
 *   owed back.
 * - **Failed refunds**: refunds Stripe accepted and then reported failed
 *   (issue #2291): the money is back in the shop's balance and the diver is
 *   owed it again.
 * - **Payouts**: what Stripe last paid into the bank, and a payout that failed
 *   since (ADR 20261012-payouts-reach-diveday). Stored rows only, never a
 *   Stripe call.
 */
export async function readBackOffice(db: AppDb, shopId: string, visible: boolean) {
  if (!visible) {
    return {
      stuckPaymentOperations: [],
      owedRefunds: [],
      paidAfterClose: [],
      failedRefunds: [],
      payouts: { paid: null, failed: null },
    };
  }
  const [stuckPaymentOperations, owedRefunds, paidAfterClose, failedRefunds, payouts] =
    await Promise.all([
      listStuckPaymentOperations(db, shopId),
      listOwedShopCancellationRefunds(db, shopId),
      listPaidAfterCloseCheckouts(db, shopId),
      listFailedRefunds(db, shopId),
      latestShopPayouts(db, shopId),
    ]);
  return { stuckPaymentOperations, owedRefunds, paidAfterClose, failedRefunds, payouts };
}

/**
 * A failed payout is the shop's to fix in its own Stripe account, so it is
 * said where the money is read, warning-toned like the owed refunds; the last
 * paid one is a quiet line, the figure a bank statement is held against.
 */
export function PayoutLines({
  payouts,
  locale,
  timeZone,
  t,
}: {
  payouts: { paid: ShopPayout | null; failed: ShopPayout | null };
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  return (
    <>
      {payouts.failed ? (
        <section aria-label={t("reports.payouts.heading")} className="mb-6">
          <ShopNotice tone="warning" role="status">
            <p>{payoutSentence(t, payouts.failed, { locale, timeZone })}</p>
          </ShopNotice>
        </section>
      ) : null}
      {payouts.paid ? (
        <p className="mb-6 text-sm text-muted tabular-nums">
          {payoutSentence(t, payouts.paid, { locale, timeZone })}
        </p>
      ) : null}
    </>
  );
}
