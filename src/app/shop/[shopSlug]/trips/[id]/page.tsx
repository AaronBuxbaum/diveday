import { notFound } from "next/navigation";
import { after } from "next/server";
import { FlashParams } from "@/components/FlashParams";
import { requireShopSurface } from "@/features/session";
import { readTripPage } from "@/features/trip-page";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { reportRenderQueries } from "@/lib/observability/query-timing";
import { shopPath } from "@/lib/staff-notices";
import { finalHomeSaid, tripPhaseOf } from "@/lib/trip-phase";
import { acceptsNewDivers } from "@/lib/trips";
import { uuidParam } from "@/lib/uuid";
import { diversTabState } from "./_arrivals/departure-record";
import { departureConditionReads } from "./_components/departure-conditions";
import { departureStateOf } from "./_components/departure-states";
import { detailsReadRows } from "./_components/details-rows";
import { FlySafeFollowUps } from "./_components/FlySafeFollowUps";
import { CheckInPhase } from "./_components/phases/CheckInPhase";
import { EditTrip } from "./_components/phases/EditTrip";
import { FillingPhase } from "./_components/phases/FillingPhase";
import { phaseSlots } from "./_components/phases/phase-slots";
import { ReadyPhase } from "./_components/phases/ReadyPhase";
import { WaterPhase } from "./_components/phases/WaterPhase";
import { WrappedPhase } from "./_components/phases/WrappedPhase";
import { tripRosterActions } from "./_components/roster-actions";
import { addBandFor } from "./_components/seat-request-band";
import { TripCancellation } from "./_components/TripCancellation";
import { TripDeskConnectivity } from "./_components/TripDeskConnectivity";
import { TripGuestList } from "./_components/TripGuestList";
import { TripHeader } from "./_components/TripHeader";
import { TripNoticeBanner } from "./_components/TripNoticeBanner";
import { TripPhaseStrip } from "./_components/TripPhaseStrip";
import { TripRosterContent } from "./_components/TripRosterContent";
import { TripSentenceLine } from "./_components/TripSentenceLine";
import { tripFrame } from "./_components/trip-frame";
import { showsEditTrip } from "./_components/trip-notice-views";
import { paymentAsks, tripPageNotices } from "./_components/trip-page-asks";
import { type TripPageSearchParams, tripFlashParams } from "./_components/trip-search-params";
import { readStaffGates } from "./_lib/staff-gates";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
export const instant = true;

export { departureMetadata as generateMetadata } from "./_components/departure-states";

/**
 * **The Trip page as The Clock** (ADR 20261117-trip-page-clock): the header,
 * the five-phase strip, one sentence, then one phase's panel, picked by
 * `?phase=` or, absent it, the phase the trip is in now; `?view=edit` is Edit
 * trip. Preserves the trip identity from 20260919-one-idea.
 */
export default async function ManageTripPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<TripPageSearchParams>;
}) {
  const [
    { shopSlug, id: tripId },
    {
      notice,
      bid,
      diverq,
      form,
      noteId,
      confirmName,
      confirmEmail,
      confirmPhone,
      view,
      phase: askedPhase,
      held,
      tell,
      ...rest
    },
  ] = await Promise.all([params, searchParams]);
  // An unparseable UUID must not reach Postgres.
  if (!uuidParam(tripId)) notFound();
  const state = await departureStateOf(shopSlug, tripId, { ...rest, notice });
  if (state) return state;
  const { session, db, shop } = await requireShopSurface(shopSlug);
  reportRenderQueries("/shop/[shopSlug]/trips/[id]", after);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const now = nowDate();
  const reading = readTripPage(db, shop, tripId, {
    session,
    filters: { diverQuery: diverq, confirmName },
  });
  const [manifest, staffGates] = await Promise.all([
    reading.manifest,
    readStaffGates(db, shop.id, session.user.personId),
  ]);
  if (!manifest) notFound();
  const {
    overview,
    coursePulse,
    guests,
    stage: stageReading,
    can: { refund: mayWriteOffPayment, retireMedicalRefusal: mayRetireRefusal },
  } = manifest;
  const {
    trip,
    cancelled,
    pulseNeeded,
    tripDiveList,
    scheduleDays,
    canConfigure,
    blowoutCalled,
    boatClashes,
  } = overview;
  // One hull, one departure at a time (H-20260916-may-one-hull-carry, issue #1780). A called-off
  // departure holds no hull, and `boatClashes` answers nothing for one anyway.

  const { tripNotice, lifecycleStatus, rootPageNotice, rosterPageNotice } = tripPageNotices({
    // `count`, `gate` and the yard day `on` ride in `rest`.
    ...rest,
    notice,
    form,
    tripId,
    locale,
    bid,
    roster: guests.roster,
    t,
  });

  const showDetails = showsEditTrip(view, rest.add, tripNotice);
  const lifecycle = {
    ...trip,
    now,
    timeZone: shop.timezone,
    stage: stageReading,
    cancelled: false,
    meetingWindows: scheduleDays,
  };
  const details = showDetails ? await reading.details() : null;
  const readRows = detailsReadRows({ db, shop, overview, t, locale, shown: showDetails });
  // A cancelled departure's plan is closed with it (`tripDetailsAreEditable`).
  const detailsEditable = !cancelled && tripPhaseOf(lifecycle) !== "back";
  const mayChangeDeparture = !cancelled && !finalHomeSaid(lifecycle);
  const acceptsDivers = acceptsNewDivers(trip, now);
  // The desk while arrivals are open, or a finished departure's record; the stage is read with
  // it, since a diver counted out and not back keeps the departure open (`readDepartureStage`).
  const { sailed, desk, record, unaccounted } = await diversTabState({
    db,
    shopId: shop.id,
    shopSlug,
    tripId,
    trip,
    now,
    locale,
    timeZone: shop.timezone,
    t,
    onDivers: !showDetails,
    stage: stageReading,
    cancelled,
    meetingWindows: scheduleDays,
  });

  const rosterActions = await tripRosterActions({
    db,
    shop,
    shopSlug,
    tripId,
    overview,
    locale,
    now,
    mayRetireRefusal,
  });

  const { paymentMarkRetry, partyPreview } = await paymentAsks(db, {
    shopId: shop.id,
    tripId,
    notice,
    bookingId: bid,
    params: rest,
  });

  const frame = tripFrame({
    clock: { ...lifecycle, cancelled },
    trip,
    shop,
    roster: guests.roster,
    readiness: guests.byBooking.readiness,
    notBack: unaccounted.size,
    askedPhase,
    boatName: (await reading.boat(trip.boatId))?.name,
    locale,
    t,
  });
  const tripPath = shopPath(shopSlug, "trips", tripId);
  const { automatedForecast, tideLines } = departureConditionReads({
    showDetails: showDetails || frame.shown === "ready" || frame.shown === "checkin",
    trip,
    tripDiveList,
    scheduleDayCount: scheduleDays.length,
    shop,
    locale,
    t,
  });

  const slots = phaseSlots({
    ...{ frame, overview, shop, shopSlug, tripId, now, locale, t },
    gearToPack: reading.gearToPack,
    water: { automatedForecast, tideLines },
  });

  const guestList = showDetails ? null : (
    <TripGuestList
      deskOpen={Boolean(desk)}
      overview={overview}
      showMinimum={pulseNeeded && !sailed}
      coursePulse={coursePulse}
      shopSlug={shopSlug}
      tripId={tripId}
      locale={locale}
      timeZone={shop.timezone}
      t={t}
      roster={
        <TripRosterContent
          context={{
            phase: slots.phase,
            tripFixes: slots.fixes,
            afterReady: slots.afterReady,
            beside: slots.beside,
            addGuestHref: `${tripPath}?phase=${frame.shown}&add=1#add-a-booking`,
            arrival: desk?.arrival,
            record,
            inWaterCrew: overview.crew.inWaterCrew,
            addBand: await addBandFor(db, { shop, shopSlug, tripId, t }, { ...rest, diverq }),
            acceptsDivers,
            guests,
            shopSlug,
            shopName: shop.name,
            locale,
            timezone: shop.timezone,
            shopRentalItems: shop.rentalItems,
            offersHotelPickup: shop.offersHotelPickup,
            tripNotice,
            pageNotice: rosterPageNotice,
            noteDeleted: noteId ? { noteId } : undefined,
            confirmName,
            confirmEmail,
            confirmPhone,
            undoBookingId:
              notice?.startsWith("booking-removed") && notice !== "booking-removed-refunded"
                ? bid
                : undefined,
            // Keep refused booking operations open at their source row.
            keepOpenBookingId: notice?.startsWith("booking-removed") ? undefined : bid,
            paymentMarkRetry,
            partyPreview,
            // The one paper-release refusal with a way through (issue #1573), scoped to
            // the seat it named, so a roster of minors does not all sprout the confirmation.
            namesakeRefusedBookingId: notice === "waiver-guardian-name" ? bid : undefined,
            participantTypeCertBookingId:
              notice === "participant-type-cert" && staffGates.mayOverrideCertBlock
                ? bid
                : undefined,
            mayWriteOffPayment,
            currency: shop.currency,
            ...staffGates,
            actions: rosterActions,
          }}
        />
      }
    />
  );
  const recordContext = { context: { db, shop, session }, tripId, locale, t };

  return (
    <>
      <FlashParams params={tripFlashParams({ held, form })} />
      {/* **One gap between every section, masthead included** (K-262). The
          roster's own blocks are `display: contents`, in this flow, on the
          same stack (`TripRosterContent`). */}
      <div className="space-y-6 sm:space-y-10">
        <TripHeader
          trip={trip}
          facts={frame.facts}
          shopSlug={shopSlug}
          tripId={tripId}
          rollCallInMore={!frame.rollCallDoor}
          addGuest={acceptsDivers && frame.capacity > trip.booked}
          locale={locale}
          timeZone={shop.timezone}
          t={t}
        />
        {/* **The phase strip is on every trip, cancelled or not**: a cancelled trip opens on
            Wrapped up, and every phase stays a tap away. */}
        <TripPhaseStrip
          shopSlug={shopSlug}
          tripId={tripId}
          current={frame.current}
          shown={showDetails ? null : frame.shown}
          copy={frame.strip}
        />
        {showDetails ? null : (
          <TripSentenceLine
            sentence={frame.sentence}
            rollCall={
              frame.rollCallDoor
                ? { href: `${tripPath}/manifest`, label: t("trips.clock.rollCall") }
                : null
            }
          />
        )}
        {desk ? <TripDeskConnectivity active t={t} /> : null}

        <TripNoticeBanner notice={rootPageNotice} locale={locale} />
        <FlySafeFollowUps {...{ db, shop, shopSlug, tripId, now, locale }} />

        <TripCancellation
          {...{ cancelled, canConfigure, blowoutCalled, lifecycleStatus, shopSlug, tripId, t }}
        />

        {details ? (
          <EditTrip
            labels={{ heading: t("trips.clock.editTrip"), done: t("trips.clock.editDone") }}
            doneHref={tripPath}
            details={{
              context: {
                overview,
                liveBoatClashes: cancelled ? [] : boatClashes,
                shop,
                shopSlug,
                tripId,
                locale,
                t,
                tripNotice,
                shopBoats: details.boats,
                shopLenses: details.lenses,
                automatedForecast,
                tideLines,
                held: held ? { id: held, section: form } : undefined,
                tell,
                refundsHeld: !mayWriteOffPayment,
                detailsEditable,
              },
              rows: await readRows,
              conservation: details.conservation,
              personId: session.user.personId,
            }}
            operations={{
              context: { db, shop, session },
              overview,
              tripId,
              locale,
              t,
              guests,
              tripNotice,
              mayChangeDeparture,
              lifecycleStatus,
              mayDiscount: staffGates.mayDiscount,
              refundsHeld: !mayWriteOffPayment,
              buddies: rest.buddies,
              buddyError: rest.buddyError,
            }}
          />
        ) : frame.shown === "filling" ? (
          <FillingPhase guests={guestList} next={slots.panel} />
        ) : frame.shown === "ready" ? (
          <ReadyPhase guests={guestList} prep={slots.panel} />
        ) : frame.shown === "checkin" ? (
          <CheckInPhase guests={guestList} quiet={slots.panel} />
        ) : frame.shown === "water" ? (
          <WaterPhase guests={guestList} record={recordContext} />
        ) : (
          <WrappedPhase guests={guestList} record={{ ...recordContext, guests }} />
        )}
      </div>
    </>
  );
}
