import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import type { getTripOverview } from "@/db/trips";
// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { requireShopSurface } from "@/lib/session";
import type { FormNotice } from "@/lib/staff-notices";
import { cancelTripAction } from "../details-actions";
import {
  applySeriesDetailsAction,
  cancelSeriesAction,
  setSeriesRepeatAction,
} from "../series-actions";
import { BlowoutDoors } from "./BlowoutDoors";
import { SeriesMoreActions } from "./SeriesSection";
import { TripMoreDisclosure } from "./TripAboutSection";

type TripOverview = NonNullable<Awaited<ReturnType<typeof getTripOverview>>>;
type ShopSurface = Awaited<ReturnType<typeof requireShopSurface>>["shop"];

/**
 * The About section's "More" disclosure on a live departure: the series'
 * apply-to-all, stop and repeat doors (to a staffer who may configure it), the
 * blow-out doors, and cancelling the departure behind a confirm. It opens
 * itself when a lifecycle form reported back.
 */
export function TripMoreActions({
  shop,
  personId,
  shopSlug,
  tripId,
  startsAt,
  series,
  crewNames,
  lifecycleStatus,
  refundsHeld,
  locale,
  t,
}: {
  shop: ShopSurface;
  personId: string;
  shopSlug: string;
  tripId: string;
  startsAt: Date;
  /** The departure's series, to a staffer who may configure it; null otherwise. */
  series: TripOverview["series"] | null;
  /** Who crews this departure, for the series' standing-crew question. */
  crewNames: string[];
  lifecycleStatus: FormNotice | undefined;
  /** True when this staffer may not refund: a call-off leaves the card refunds for an owner or manager (H-20261013-call-off-queues-refunds). */
  refundsHeld: boolean;
  locale: string;
  t: StaffTranslator;
}) {
  return (
    <TripMoreDisclosure label={t("trips.about.more")} open={Boolean(lifecycleStatus)}>
      <FormStatus tone={lifecycleStatus?.tone} className="mb-2">
        {lifecycleStatus?.text}
      </FormStatus>
      {series ? (
        <SeriesMoreActions
          series={series}
          crewNames={crewNames}
          applyAction={applySeriesDetailsAction.bind(null, shopSlug, tripId, series.id)}
          cancelAction={cancelSeriesAction.bind(null, shopSlug, tripId, series.id)}
          repeatAction={setSeriesRepeatAction.bind(null, shopSlug, tripId, series.id)}
          refundsHeld={refundsHeld}
          locale={locale}
        />
      ) : null}
      <BlowoutDoors
        shop={shop}
        personId={personId}
        tripId={tripId}
        startsAt={startsAt}
        tripLabel={t("trips.detail.weatherBlowout")}
        dayLabel={t("trips.detail.dayBlowout")}
      />
      <form action={cancelTripAction.bind(null, shopSlug, tripId)} className="w-full">
        <InlineConfirm
          triggerLabel={t("trips.about.cancel")}
          message={t("trips.detail.cancelHint")}
          confirmLabel={t("trips.detail.cancelConfirm")}
          cancelLabel={t("trips.roster.neverMind")}
          pendingLabel={t("trips.detail.cancelling")}
          triggerClassName={buttonClass({
            variant: "danger-ghost",
            size: "sm",
            flush: true,
          })}
          confirmClassName={buttonClass({ variant: "danger", size: "sm" })}
        />
      </form>
    </TripMoreDisclosure>
  );
}
