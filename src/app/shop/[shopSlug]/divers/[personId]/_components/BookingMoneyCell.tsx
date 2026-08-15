import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";
import {
  bookingMoney,
  bookingMoneyStatusKey,
  bookingMoneyStatusTone,
  type DiverProfile,
} from "./shared";

/**
 * A booking's money, on the booking's own row: what it stands at, and the one
 * thing to do about it next.
 *
 * Both lists that show a booking — Upcoming and the history below — render
 * this, so the same seat can never read "paid" in one and "no payment" in the
 * other. It also carries the per-booking billing door that used to live in the
 * Payments section: `orders/new` takes the booking as a query param and has no
 * picker of its own, so without a link from the booking there is no way to
 * raise an invoice against a specific trip at all.
 */
export function BookingMoneyCell({
  diver,
  bookingId,
  shopSlug,
  personId,
  paymentsConnected,
  t,
}: {
  diver: DiverProfile;
  bookingId: string;
  shopSlug: string;
  personId: string;
  /** No payable Stripe account means `orders/new` refuses and bounces straight back. */
  paymentsConnected: boolean;
  t: StaffTranslator;
}) {
  const money = bookingMoney(diver, bookingId);
  const statusKey = bookingMoneyStatusKey(money);
  return (
    <span className="flex flex-wrap items-center gap-2">
      {/* The canonical `Badge`, tone and word read off the same row by the
          same pair of helpers. This used to be a flat grey pill that gave
          "Unpaid", "Paid" and "Refunded" one non-answer, sitting a few rows
          from the real badges the same page renders. */}
      <Badge tone={bookingMoneyStatusTone(money)} className="whitespace-nowrap">
        {statusKey ? t(statusKey) : t("divers.payments.noOrder")}
      </Badge>
      {money.order ? (
        <Link
          href={`/shop/${shopSlug}/orders/${money.order.order.id}`}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {t("divers.payments.openPayment")}
        </Link>
      ) : paymentsConnected ? (
        <Link
          href={`/shop/${shopSlug}/orders/new?personId=${personId}&bookingId=${bookingId}`}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {t("divers.payments.createOrder")}
        </Link>
      ) : // A shop with no payable account can't raise an order on any row, so
      // offering the fix on every one of them just repeats the same button
      // down the list. The Payments section's own header carries it once.
      null}
    </span>
  );
}
