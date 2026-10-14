import Link from "next/link";
import type { OrderBookingContext } from "@/db/order-booking";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents, formatShortDate } from "@/lib/format";
import { shopPath } from "@/lib/staff-notices";

/**
 * **Which departure, and what the seat still owes** (third UX review, item
 * 32). A deposit is half a payment: the new-order form named the booking it
 * was raised for and the sent order lost it. The line names it in the form's
 * own words, links to the departure, and gives the balance off the seat's own
 * price and payment row (`seatBalanceOwedCents`).
 */
export function OrderBookingLine({
  booking,
  personName,
  currency,
  shopSlug,
  locale,
  timezone,
  t,
}: {
  booking: OrderBookingContext;
  personName: string;
  currency: string;
  shopSlug: string;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  return (
    <div className="mt-3 text-sm">
      <p>
        {t("orders.new.linkedTo", {
          personName,
          tripTitle: booking.tripTitle,
          date: formatShortDate(booking.tripStartsAt, locale, timezone),
        })}{" "}
        <Link
          href={shopPath(shopSlug, "trips", booking.tripId)}
          className="font-medium text-primary hover:underline print:hidden"
        >
          {t("orders.detail.openTrip")}
        </Link>
      </p>
      {booking.balanceOwedCents !== null ? (
        <p className="mt-1 text-muted tabular-nums">
          {t("orders.detail.balanceOwed", {
            amount: formatMoneyCents(booking.balanceOwedCents, currency, locale),
          })}
        </p>
      ) : null}
    </div>
  );
}
