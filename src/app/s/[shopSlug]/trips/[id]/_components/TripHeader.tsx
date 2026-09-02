import Link from "next/link";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { diverTranslator } from "@/i18n/messages";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { formatMoneyScanned, formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { publicCoursePath, publicSchedulePath } from "@/lib/public-routes";
import type { Shop, Trip, TripMeetingDay } from "./types";

/**
 * The masthead answers exactly what a diver arrives with — when is it, what is
 * it, how much — with type scale and space, not a stack of same-weight muted
 * lines. It used to carry up to nine of those (meeting days, course link,
 * minimum age, description, price, fee breakdown, deposit, cancellation,
 * contact links), which made the date indistinguishable from the fine print.
 * The money terms now live beside the booking button (`TripTerms`), where the
 * decision they inform is actually made, and the minimum age is stated by the
 * booking form's own attestation checkbox rather than twice.
 */
export function TripHeader({
  shop,
  trip,
  meetingDays,
  locale,
  embed,
  showMeetingPoint = true,
}: {
  shop: Shop;
  trip: Trip;
  /**
   * Exact meeting details are a booked-diver benefit. Public booking pages
   * still answer when and how much without publishing the arrival destination.
   */
  showMeetingPoint?: boolean;
  /**
   * Every consecutive day this departure meets on, in order. One entry is an
   * ordinary single-day trip; more is an Open Water weekend or a liveaboard,
   * and until now the diver was never told: the hero printed day one's date and
   * time range and stopped, so a three-day course read as a Tuesday morning and
   * a student found out about Wednesday and Thursday from the shop.
   */
  meetingDays: TripMeetingDay[];
  locale: string;
  /**
   * Who carries the shop's identity. Outside the frame the chrome bar above
   * already names the shop, so a brand block *and* a shop-name eyebrow under
   * it named the shop three times in 150px, with the tagline floating between
   * them and a fourth element — a hand-rolled "← All trips" link — as the way
   * up (2026-08-28 diver-views review, finding 8). There the eyebrow is now
   * the one way back (principle 10's single grammar for up) and the brand
   * block stands down. Inside the frame there is no chrome above, which is
   * the one place the brand block earns its keep.
   */
  embed: boolean;
}) {
  // Every figure in the hero is a list price, so it follows the shop's own
  // currency (docs ADR 20260731-shop-currency) — never a hardcoded "usd".
  const currency = toShopCurrency(shop.currency);
  const t = diverTranslator(locale);
  // The same total the booking section actually charges — course fee and
  // e-learning included — not the bare trip row (task 15). Before this fix a
  // course session could show one price in the hero and a higher one once
  // the diver reached the form.
  const perDiverPriceCents = perDiverBookingPriceCents(trip, trip.course);
  const multiDay = meetingDays.length > 1;
  return (
    <div className="mt-4">
      <ShopPageHeader
        eyebrow={embed ? shop.name : t("trip.backToAllTrips")}
        {...(embed ? {} : { eyebrowHref: publicSchedulePath(shop.slug) })}
        title={trip.title}
        titleFace="brand"
        {...(embed
          ? {
              brand: {
                logoUrl: shop.logoUrl,
                tagline: shop.tagline,
                description: shop.description,
              },
            }
          : {})}
        meta={
          <>
            {/* The one line on the one page where a diver decides to buy a
                seat, so it names the clock it is on: `formatTimeRangeTz` rather
                than the bare `formatTimeRange` the schedule list uses (review
                finding I18N-L2). A booker two timezones away reading "7:30 AM –
                11:00 AM" here has nothing else to tell them whose morning that
                is, and the confirmation they get afterwards has said "EDT" all
                along — which made this the one step of the flow that could
                disagree with the two around it. Foreground weight on purpose:
                "when" is one of the two facts this page exists to answer, and
                it spent its whole life in the muted ink reserved for asides. */}
            {multiDay ? (
              // A multi-day departure leads with its whole span, then names
              // every day. The days are listed rather than summarised as a
              // range because they are what a student has to clear a calendar
              // for, and because each carries its own hours — the staff editor
              // repeats one wall-clock window across the days, but a day edited
              // afterwards keeps its own, and this must show that rather than
              // imply day one's times run the week.
              <>
                <p className="text-lg font-medium">
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
              <p className="text-lg font-medium">
                {formatShortDate(trip.startsAt, locale, shop.timezone)} ·{" "}
                {formatTimeRangeTz(trip.startsAt, trip.endsAt, locale, shop.timezone)}
              </p>
            )}
            {showMeetingPoint && trip.meetingPointLabel ? (
              <p className="mt-2 text-sm font-medium text-muted">
                {trip.meetingPointAddress
                  ? t("trip.meetingPointWithAddress", {
                      label: trip.meetingPointLabel,
                      address: trip.meetingPointAddress,
                    })
                  : trip.meetingPointLabel}
              </p>
            ) : null}
            {trip.isPrivate ? (
              <p className="mt-2 text-sm font-medium text-primary">{t("trip.privateCharter")}</p>
            ) : null}
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
            {trip.description ? <p className="mt-3 text-muted">{trip.description}</p> : null}
            {/* "How much" is the other fact this page exists to answer, so it
                gets a real typographic moment instead of one more muted line.
                The deposit split, cancellation window, and course-fee
                breakdown that used to trail it are `TripTerms`, beside the
                button — fine print belongs with the signature. */}
            {perDiverPriceCents !== null ? (
              <p className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-semibold tracking-tight tabular-nums">
                  {formatMoneyScanned(perDiverPriceCents, currency, locale)}
                </span>
                <span className="text-sm text-muted">{t("common.perDiver")}</span>
              </p>
            ) : null}
          </>
        }
      />
    </div>
  );
}
