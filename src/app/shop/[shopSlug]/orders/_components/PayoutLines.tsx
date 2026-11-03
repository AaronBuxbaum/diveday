import { ShopNotice } from "@/components/ShopNotice";
import type { ShopPayout } from "@/db/payouts";
import type { RoomChargeTotal } from "@/db/room-charges";
import { payoutSentence } from "@/i18n/payout-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { monthNames } from "@/lib/format";
import { RoomChargesLine } from "./RoomChargesLine";

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
