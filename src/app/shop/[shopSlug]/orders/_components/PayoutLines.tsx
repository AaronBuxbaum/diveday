import { ShopNotice } from "@/components/ShopPageHeader";
import { listPaidAfterCloseCheckouts } from "@/db/checkouts-paid-after-close";
import type { AppDb } from "@/db/client";
import { listStuckPaymentOperations } from "@/db/payment-operations";
import { latestShopPayouts, type ShopPayout } from "@/db/payouts";
import { listFailedRefunds } from "@/db/refund-failures";
import { listOwedShopCancellationRefunds } from "@/db/refunds";
import { type RoomChargeTotal, roomChargesByHotel } from "@/db/room-charges";
import { listUnattributedRefunds } from "@/db/unattributed-refunds";
import { payoutSentence } from "@/i18n/payout-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { monthNames } from "@/lib/format";
import { shopMonthBounds, utcToWallTime } from "@/lib/zoned";
import { RoomChargesLine } from "./RoomChargesLine";

/** Reads stored recovery and payout data for payment-settings managers; unattributed refunds stay separate (ADRs 20260813-shop-cancellation-refunds-itself and 20261012-payouts-reach-diveday). */
export async function readBackOffice(
  db: AppDb,
  shop: { id: string; timezone: string },
  visible: boolean,
) {
  const shopId = shop.id;
  if (!visible) {
    return {
      stuckPaymentOperations: [],
      owedRefunds: [],
      paidAfterClose: [],
      failedRefunds: [],
      unattributedRefunds: [],
      payouts: { paid: null, failed: null, roomCharges: null },
    };
  }
  // Owners and managers use monthly room totals to settle with the front desk (fifth-loop ideas, item 57).
  const wall = utcToWallTime(nowDate(), shop.timezone);
  const month = { year: wall.year, month: wall.month };
  const { from, to } = shopMonthBounds(month, shop.timezone);
  const [
    stuckPaymentOperations,
    owedRefunds,
    paidAfterClose,
    failedRefunds,
    unattributedRefunds,
    latest,
    totals,
  ] = await Promise.all([
    listStuckPaymentOperations(db, shopId, undefined, { withoutUnattributedRefunds: true }),
    listOwedShopCancellationRefunds(db, shopId),
    listPaidAfterCloseCheckouts(db, shopId),
    listFailedRefunds(db, shopId),
    listUnattributedRefunds(db, shopId),
    latestShopPayouts(db, shopId),
    roomChargesByHotel(db, shopId, from, to),
  ]);
  const payouts = { ...latest, roomCharges: { month: month.month, totals } };
  return {
    stuckPaymentOperations,
    owedRefunds,
    paidAfterClose,
    failedRefunds,
    unattributedRefunds,
    payouts,
  };
}

/** Shows failed payouts as warnings and the latest paid payout as a quiet bank-statement reference. */
export function PayoutLines({
  payouts,
  locale,
  timeZone,
  t,
}: {
  payouts: {
    paid: ShopPayout | null;
    failed: ShopPayout | null;
    /** This month's room charges per hotel; null for a reader who does not see money. */
    roomCharges?: { month: number; totals: RoomChargeTotal[] } | null;
  };
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
      {payouts.roomCharges ? (
        <RoomChargesLine
          totals={payouts.roomCharges.totals}
          month={monthNames(locale)[payouts.roomCharges.month - 1] ?? ""}
          locale={locale}
          t={t}
        />
      ) : null}
    </>
  );
}
