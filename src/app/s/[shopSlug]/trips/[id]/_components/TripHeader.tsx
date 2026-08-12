import Link from "next/link";
import { ShopContactLinks } from "@/components/ShopContactLinks";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { diverTranslator } from "@/i18n/messages";
import { courseCharges, perDiverBookingPriceCents } from "@/lib/courses";
import { cancellationDeadline, checkoutCharge } from "@/lib/deposits";
import {
  formatDateTimeTz,
  formatMoneyCents,
  formatShortDate,
  formatTimeRangeTz,
} from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { publicCoursePath } from "@/lib/public-routes";
import type { Shop, Trip, TripMeetingDay } from "./types";

export function TripHeader({
  shop,
  trip,
  meetingDays,
  locale,
}: {
  shop: Shop;
  trip: Trip;
  /**
   * Every consecutive day this departure meets on, in order. One entry is an
   * ordinary single-day trip; more is an Open Water weekend or a liveaboard,
   * and until now the diver was never told: the hero printed day one's date and
   * time range and stopped, so a three-day course read as a Tuesday morning and
   * a student found out about Wednesday and Thursday from the shop.
   */
  meetingDays: TripMeetingDay[];
  locale: string;
}) {
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
  const multiDay = meetingDays.length > 1;
  return (
    <div className="mt-4">
      <ShopPageHeader
        eyebrow={shop.name}
        title={trip.title}
        meta={
          <>
            {/* The one line on the one page where a diver decides to buy a
                seat, so it names the clock it is on: `formatTimeRangeTz` rather
                than the bare `formatTimeRange` the schedule list uses (review
                finding I18N-L2). A booker two timezones away reading "7:30 AM –
                11:00 AM" here has nothing else to tell them whose morning that
                is, and the confirmation they get afterwards has said "EDT" all
                along — which made this the one step of the flow that could
                disagree with the two around it. */}
            {multiDay ? (
              // A multi-day departure leads with its whole span, then names
              // every day. The days are listed rather than summarised as a
              // range because they are what a student has to clear a calendar
              // for, and because each carries its own hours — the staff editor
              // repeats one wall-clock window across the days, but a day edited
              // afterwards keeps its own, and this must show that rather than
              // imply day one's times run the week.
              <>
                <p className="text-lg text-muted">
                  {t("trip.meetingDaysSummary", {
                    count: meetingDays.length,
                    first: formatShortDate(meetingDays[0].startsAt, locale, shop.timezone),
                    last: formatShortDate(
                      meetingDays[meetingDays.length - 1].startsAt,
                      locale,
                      shop.timezone,
                    ),
                  })}
                </p>
                <ol className="mt-2 space-y-0.5 text-sm text-muted">
                  {meetingDays.map((day) => (
                    <li key={day.id}>
                      {t("trip.meetingDayLabel", {
                        number: day.dayNumber,
                        date: formatShortDate(day.startsAt, locale, shop.timezone),
                        timeRange: formatTimeRangeTz(
                          day.startsAt,
                          day.endsAt,
                          locale,
                          shop.timezone,
                        ),
                      })}
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <p className="text-lg text-muted">
                {formatShortDate(trip.startsAt, locale, shop.timezone)} ·{" "}
                {formatTimeRangeTz(trip.startsAt, trip.endsAt, locale, shop.timezone)}
              </p>
            )}
            {trip.course ? (
              <p className="mt-2 text-sm font-medium text-primary">
                {t("trip.courseSession")} ·{" "}
                <Link
                  href={publicCoursePath(shop.slug, trip.course.slug)}
                  className="underline-offset-2 hover:underline focus-visible:underline"
                >
                  {trip.course.title}
                </Link>
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
            {/* The cancellation line only speaks when cancelling could cost
                something. A stated free-cancellation window is always worth
                saying; past that, "Cancellation questions? Ask the shop" is
                only a real prompt for a diver who is about to put a deposit
                down — on a book-now-pay-later seat it invented a worry about
                money nobody had handed over, on every trip in the catalogue. */}
            {deadline ? (
              <p className="mt-1 text-sm text-muted">
                {t("trip.freeCancellationUntil", {
                  when: formatDateTimeTz(deadline, locale, shop.timezone),
                })}
              </p>
            ) : charge?.isDeposit ? (
              <p className="mt-1 text-sm text-muted">
                {t("trip.cancellationAskShop")}{" "}
                <ShopContactLinks phone={shop.contactPhone} email={shop.contactEmail} />
              </p>
            ) : null}
          </>
        }
      />
    </div>
  );
}
