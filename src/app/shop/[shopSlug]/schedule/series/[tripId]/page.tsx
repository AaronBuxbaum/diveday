import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { resolveTripNotice } from "@/app/shop/[shopSlug]/trips/[id]/_components/trip-notice-resolution";
import {
  applySeriesDetailsAction,
  cancelOffCadenceSeriesAction,
  cancelSeriesAction,
  setSeriesRepeatAction,
  updateSeriesCadenceAction,
} from "@/app/shop/[shopSlug]/trips/[id]/series-actions";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { requireShopSurface } from "@/features/accounts/session";
import { getSeriesPage } from "@/features/trips/trip-page";
import { requestLocale } from "@/i18n/request";
import { repeatsRowText } from "@/i18n/series-sentences";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate, weekdayNames } from "@/lib/format";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { SeriesCadenceEditor, SeriesMoreActions } from "./_components/SeriesSection";

// The staff family's contract (ADR 20260804-instant-navigation): this
// segment's `loading.tsx` paints first, and nothing above it reads the request.
export const instant = true;

export const metadata: Metadata = { title: "Repeats — DiveDay" };

/**
 * **A run, under Schedule** (ADR 20261117-trip-page-clock): the cadence, and
 * the run-wide acts (apply this date's details to every upcoming date, stop
 * or start repeating, cancel every upcoming date), opened from one of its
 * dates. The trip's Edit trip shows the run as one line and links here. Every
 * act keeps its own gate (`requireTripConfig`); a staffer who may not change
 * the run reads its line and nothing else.
 */
export default async function SeriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; tripId: string }>;
  searchParams: Promise<{ notice?: string; count?: string; form?: string }>;
}) {
  const [{ shopSlug, tripId }, { notice, count, form }] = await Promise.all([params, searchParams]);
  if (!uuidParam(tripId)) notFound();
  const { db, shop, session } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const reading = await getSeriesPage(db, shop, tripId, session.user.personId);
  if (!reading) notFound();
  const { overview, series, mayRefund } = reading;
  const status = resolveTripNotice({ notice, count, form, tripId, locale });
  const crewNames = overview.staff
    .filter((entry) => overview.crew.crewIds.includes(entry.person.id))
    .map((entry) => entry.person.fullName);
  // A call-off by a staffer who may not refund leaves the card refunds for an
  // owner or manager (H-20261013-call-off-queues-refunds).
  const refundsHeld = !mayRefund;
  return (
    <StaffPage>
      <ShopPageHeader
        eyebrow={overview.trip.title}
        returnTo={shopPath(shopSlug, "trips", tripId)}
        title={t("trips.about.repeats")}
        description={repeatsRowText(t, locale, series)}
      />
      {overview.canConfigure ? (
        <div className="mt-8 space-y-6">
          <section className={sectionCardClass({ padding: "lg" })}>
            <SeriesCadenceEditor
              intervalWeeks={series.intervalWeeks}
              weekdays={series.weekdayMask}
              endsOn={series.endsOn}
              anchorDate={series.anchorDate}
              offCadence={overview.offCadence.map((date) => ({
                id: date.id,
                title: date.title,
                // Formatted here, where the request locale and the shop's zone
                // both are: the panel is handed words, never instants.
                label: formatShortDate(date.startsAt, locale, shop.timezone),
                booked: date.booked,
              }))}
              weekdayNames={weekdayNames(locale)}
              status={status?.form === "series" ? status : undefined}
              cadenceAction={updateSeriesCadenceAction.bind(null, shopSlug, tripId, series.id)}
              cancelOffCadenceAction={cancelOffCadenceSeriesAction.bind(
                null,
                shopSlug,
                tripId,
                series.id,
              )}
              refundsHeld={refundsHeld}
              locale={locale}
            />
          </section>
          <section
            className={sectionCardClass({
              padding: "lg",
              className: "flex flex-col items-start gap-2",
            })}
          >
            <SeriesMoreActions
              series={series}
              crewNames={crewNames}
              applyAction={applySeriesDetailsAction.bind(null, shopSlug, tripId, series.id)}
              cancelAction={cancelSeriesAction.bind(null, shopSlug, tripId, series.id)}
              repeatAction={setSeriesRepeatAction.bind(null, shopSlug, tripId, series.id)}
              refundsHeld={refundsHeld}
              locale={locale}
            />
          </section>
        </div>
      ) : null}
    </StaffPage>
  );
}
