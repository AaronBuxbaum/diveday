import { ShopPageHeader } from "@/components/ShopPageHeader";
import { diverTranslator } from "@/i18n/messages";
import { courseCharges, perDiverBookingPriceCents } from "@/lib/courses";
import { cancellationDeadline, checkoutCharge } from "@/lib/deposits";
import { formatDateTimeTz, formatMoneyCents, formatShortDate, formatTimeRange } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import type { Shop, Trip } from "./types";

export function TripHeader({ shop, trip, locale }: { shop: Shop; trip: Trip; locale: string }) {
  const charge = checkoutCharge(trip, trip.course);
  const deadline = cancellationDeadline(trip);
  // Every figure in the hero is a list price, so it follows the shop's own
  // currency (docs ADR 20260731-shop-currency) — never a hardcoded "usd".
  const currency = toShopCurrency(shop.currency);
  const t = diverTranslator(locale);
  // The same total the booking section actually charges — course fee and
  // e-learning included — not the bare trip row (task 15). Before this fix a
  // course session could show one price in the hero and a higher one once
  // the diver reached the form.
  const perDiverPriceCents = perDiverBookingPriceCents(trip, trip.course);
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
  const cancellationContact = shop.contactEmail || shop.contactPhone;
  return (
    <div className="mt-4">
      <ShopPageHeader
        eyebrow={shop.name}
        title={trip.title}
        meta={
          <>
            <p className="text-lg text-muted">
              {formatShortDate(trip.startsAt, locale, shop.timezone)} ·{" "}
              {formatTimeRange(trip.startsAt, trip.endsAt, locale, shop.timezone)}
            </p>
            {trip.course ? (
              <p className="mt-2 text-sm font-medium text-primary">
                {t("trip.courseSession")} · {trip.course.title}
              </p>
            ) : null}
            {/* Minimum age was previously shown only on the course page, never here
                where a parent is actually about to book (task 23) — the trip page
                is a self-declared display only; enforcement stays out of scope
                pending a human-decision entry (see the booking form's attestation
                checkbox and docs/product/human-decisions.md H-08/H-22). */}
            {trip.course?.minimumAge ? (
              <p className="mt-1 text-sm text-muted">
                {t("trip.minimumAge", { age: trip.course.minimumAge })}
              </p>
            ) : null}
            {trip.description ? <p className="mt-3 text-muted">{trip.description}</p> : null}
            {perDiverPriceCents !== null ? (
              <p className="mt-3 text-lg font-semibold tabular-nums">
                {formatMoneyCents(perDiverPriceCents, currency, locale)}{" "}
                <span className="text-sm font-normal text-muted">{t("common.perDiver")}</span>
              </p>
            ) : null}
            {courseFeeCents !== null && eLearningFeeCents !== null ? (
              <p className="mt-1 text-sm text-muted tabular-nums">
                {t("trip.courseFeeBreakdown", {
                  course: formatMoneyCents(courseFeeCents, currency, locale),
                  eLearning: formatMoneyCents(eLearningFeeCents, currency, locale),
                })}
              </p>
            ) : null}
            {charge?.isDeposit ? (
              <p className="mt-1 text-sm text-muted tabular-nums">
                {t("trip.depositLine", {
                  deposit: formatMoneyCents(charge.amountCents, currency, locale),
                  balance: formatMoneyCents(charge.balanceDueCents, currency, locale),
                })}
              </p>
            ) : null}
            {deadline ? (
              <p className="mt-1 text-sm text-muted">
                {t("trip.freeCancellationUntil", {
                  when: formatDateTimeTz(deadline, locale, shop.timezone),
                })}
              </p>
            ) : cancellationContact ? (
              <p className="mt-1 text-sm text-muted">
                {t("trip.cancellationAskShop", { contact: cancellationContact })}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted">{t("trip.cancellationAskShopNoContact")}</p>
            )}
          </>
        }
      />
    </div>
  );
}
