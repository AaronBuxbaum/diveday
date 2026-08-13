import { ShopContactLinks } from "@/components/ShopContactLinks";
import { diverTranslator } from "@/i18n/messages";
import { courseCharges } from "@/lib/courses";
import { cancellationDeadline, checkoutCharge } from "@/lib/deposits";
import { formatDateTimeTz, formatMoneyCents } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import type { Shop, Trip } from "./types";

/**
 * The money fine print — course-fee split, deposit-versus-balance, and the
 * free-cancellation window — rendered beside the booking button, where the
 * decision it informs is made. These lines used to sit in the masthead, four
 * muted rows under the price, which both buried the date under fine print and
 * put the terms a whole page away from the tap they qualify.
 *
 * Server component: the page renders it once and hands the node into
 * `BookSpotSection` (a Client Component) as a prop, so the deposit/cancel
 * arithmetic in `src/lib/deposits.ts` never ships to the browser.
 */
export function TripTerms({
  shop,
  trip,
  locale,
  cancellationOnly = false,
}: {
  shop: Shop;
  trip: Trip;
  locale: string;
  /**
   * On the confirmation, the deposit split and course-fee breakdown are
   * superseded by the payment panel's own record of what was actually charged
   * — restating the pre-purchase arithmetic under it would say the same fact
   * twice (design/principles.md #9). The cancellation window is the one term
   * still ahead of a booked diver, so it is the one line that renders there.
   */
  cancellationOnly?: boolean;
}) {
  const t = diverTranslator(locale);
  // List prices in the shop's own currency (docs ADR 20260731-shop-currency).
  const currency = toShopCurrency(shop.currency);
  const charge = checkoutCharge(trip, trip.course);
  const deadline = cancellationDeadline(trip);
  const breakdown = trip.course
    ? courseCharges({
        title: trip.course.title,
        priceCents: trip.course.priceCents ?? trip.priceCents,
        eLearningPriceCents: trip.course.eLearningPriceCents,
      })
    : [];
  const courseFeeCents = breakdown.find((line) => line.kind === "course_fee")?.amountCents ?? null;
  const eLearningFeeCents =
    breakdown.find((line) => line.kind === "e_learning_fee")?.amountCents ?? null;
  const hasBreakdown = !cancellationOnly && courseFeeCents !== null && eLearningFeeCents !== null;
  const showDeposit = !cancellationOnly && Boolean(charge?.isDeposit);
  if (!hasBreakdown && !showDeposit && !deadline && !charge?.isDeposit) return null;
  return (
    <div className="mt-3 space-y-1 text-sm text-muted">
      {hasBreakdown ? (
        <p className="tabular-nums">
          {t("trip.courseFeeBreakdown", {
            course: formatMoneyCents(courseFeeCents, currency, locale),
            eLearning: formatMoneyCents(eLearningFeeCents, currency, locale),
          })}
        </p>
      ) : null}
      {showDeposit && charge ? (
        <p className="tabular-nums">
          {t("trip.depositLine", {
            deposit: formatMoneyCents(charge.amountCents, currency, locale),
            balance: formatMoneyCents(charge.balanceDueCents, currency, locale),
          })}
        </p>
      ) : null}
      {/* The cancellation line only speaks when cancelling could cost
          something. A stated free-cancellation window is always worth
          saying; past that, "Cancellation questions? Ask the shop" is
          only a real prompt for a diver who is about to put a deposit
          down — on a book-now-pay-later seat it invented a worry about
          money nobody had handed over, on every trip in the catalogue. */}
      {deadline ? (
        <p>
          {t("trip.freeCancellationUntil", {
            when: formatDateTimeTz(deadline, locale, shop.timezone),
          })}
        </p>
      ) : charge?.isDeposit ? (
        <p>
          {t("trip.cancellationAskShop")}{" "}
          <ShopContactLinks phone={shop.contactPhone} email={shop.contactEmail} />
        </p>
      ) : null}
    </div>
  );
}
