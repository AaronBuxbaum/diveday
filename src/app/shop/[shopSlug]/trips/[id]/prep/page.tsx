import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { buttonClass } from "@/components/ui/button";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { requireShopSurface } from "@/features/accounts/session";
import { getTripPrepPage } from "@/features/trips/trip-prep";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { isPrepGrouping, type PrepGrouping } from "@/lib/dive-prep";
import { PREP_SECTION_ID } from "@/lib/element-id";
import { meetingPointOfRows } from "@/lib/meeting-point";
import { shopPath } from "@/lib/staff-notices";
import { clockPhaseOf, phaseWhens } from "@/lib/trip-clock";
import { seatsOnSale } from "@/lib/trips";
import { uuidParam } from "@/lib/uuid";
import { TripHeader, tripFacts } from "../_components/TripHeader";
import { TripPhaseStrip } from "../_components/TripPhaseStrip";
import { phaseStripCopy } from "../_components/trip-clock-copy";
import { tripHeaderDaySpan } from "../_components/trip-header-price";
import { PrepBody } from "./_components/PrepBody";
import { RentalTicketSheet } from "./_components/RentalTicketSheet";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Gear — DiveDay",
};

/**
 * **Gear**: the morning packing list, under the Trip page's own header and
 * phase strip (ADR 20261117-trip-page-clock), with no phase marked as shown. Everything above the assignments section is
 * derived from the roster's rental fits and the trip's dive plan — the
 * counts and sizes reserve nothing. The one exception is deliberate: a shop
 * that keeps its fleet on the gear register can assign tagged units to
 * renting divers here, and only that act reserves anything (ADR
 * 20260815-minimal-gear-register; a shop with no register sees no change).
 * It is a page to work down with your hands full, so it prints, and the two
 * ways it can be wrong (a missing fit, an unverified nitrox card) are stated
 * at the top rather than buried.
 *
 * The packing list itself is read two ways, chosen by `?group=` and resolved
 * server-side: down the rack (`item`, the default — six BCDs together with
 * their sizes) or down the roster (`diver` — one row per person with their
 * pieces). Both are the same pieces out of one `buildDivePrepChecklist` call,
 * so the choice is a sort rather than a second source of truth, and it lives
 * in the URL so a link to it survives being shared with whoever is loading
 * the van (same shape as the shop home's `?view=`).
 */
export default async function TripPrepPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{
    notice?: string;
    /** The number a counted gear notice names (`noticeCountParam`). */
    count?: string;
    /** Which grouping; anything unrecognised reads as the by-item default. */
    group?: string;
    /** One booking: the page is that diver's rental slip, to print and hand over. */
    diver?: string;
  }>;
}) {
  const { shopSlug, id: tripId } = await params;
  const { notice, count, group, diver } = await searchParams;
  const grouping: PrepGrouping = isPrepGrouping(group) ? group : "item";
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(tripId)) notFound();
  if (diver !== undefined) {
    const bookingId = uuidParam(diver);
    if (!bookingId) notFound();
    return <RentalTicketSheet shopSlug={shopSlug} tripId={tripId} bookingId={bookingId} />;
  }
  const { session, db, shop } = await requireShopSurface(shopSlug);
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  // The reader this tab shares with the packet's packing-list sheet: the
  // packing list, the crew's word for the header chip, whether the boat has
  // left the dock, and (once home) every unit still out on this boat.
  const view = await getTripPrepPage(db, shop, tripId, nowDate(), session.user.personId);
  if (!view) notFound();
  const { prep, sailed, finished, backFromBoat, stageReading, meetingWindows, boat } = view;
  const { trip } = prep;
  const clockInput = {
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    now: nowDate(),
    timeZone: shop.timezone,
    stage: stageReading,
    cancelled: trip.status === "cancelled",
    meetingWindows,
  };
  const currentPhase = clockPhaseOf(clockInput);

  const body = (
    <PrepBody
      prep={prep}
      t={t}
      locale={locale}
      shopSlug={shopSlug}
      tripId={tripId}
      rentalItems={shop.rentalItems}
      notice={notice}
      noticeCount={count}
      grouping={grouping}
      cancelled={trip.status === "cancelled"}
      sailed={sailed}
      home={finished}
      backFromBoat={backFromBoat}
      groupPath={shopPath(shopSlug, "trips", tripId, "prep")}
      emptyState={
        <EmptyState
          title={t("tripPrep.emptyHeading")}
          body={t("tripPrep.noDivers")}
          action={
            <Link href={shopPath(shopSlug, "trips", tripId)} className={buttonClass({})}>
              {t("tripPrep.emptyAction")}
            </Link>
          }
        />
      }
      className="space-y-10"
    />
  );

  return (
    <>
      <FlashParams params={["notice", "count"]} />
      <div className="space-y-6 sm:space-y-10">
        <TripHeader
          trip={trip}
          facts={tripFacts({
            trip,
            daySpan: tripHeaderDaySpan(meetingWindows ?? [], locale, shop.timezone, t),
            boatName: boat?.name,
            meetingPlace: meetingPointOfRows(shop, trip).label,
            locale,
            timeZone: shop.timezone,
          })}
          shopSlug={shopSlug}
          tripId={tripId}
          rollCall="more"
          addGuest={false}
          reportIncident={view.mayReportIncident}
          locale={locale}
          timeZone={shop.timezone}
          t={t}
        />
        <TripPhaseStrip
          shopSlug={shopSlug}
          tripId={tripId}
          current={currentPhase}
          shown={null}
          copy={phaseStripCopy(
            t,
            phaseWhens({
              ...clockInput,
              booked: trip.booked,
              capacity: seatsOnSale(trip).capacity,
            }),
            { locale, timeZone: shop.timezone },
          )}
        />
        <h2 className={SECTION_TITLE_CLASS}>{t("trips.clock.gear")}</h2>
      </div>
      {/* The anchor every "fix the packing list" link lands on. */}
      <div id={PREP_SECTION_ID} className="mt-10 scroll-mt-6">
        {body}
      </div>
    </>
  );
}
