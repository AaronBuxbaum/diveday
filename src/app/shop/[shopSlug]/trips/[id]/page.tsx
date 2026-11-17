import { notFound } from "next/navigation";
import { after } from "next/server";
import { FlashParams } from "@/components/FlashParams";
import { getBoatById } from "@/features/boats";
import { rosterRowIsBlocked } from "@/features/roster-filters";
import { requireShopSurface } from "@/features/session";
import { readTripPage } from "@/features/trip-page";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { dockCallAt } from "@/lib/dock-call";
import { meetingPointOfRows } from "@/lib/meeting-point";
import { reportRenderQueries } from "@/lib/observability/query-timing";
import { shopPath } from "@/lib/staff-notices";
import {
  CLOCK_PHASES,
  type ClockPhase,
  clockPhaseOf,
  nextMeetingStart,
  phaseWhens,
  shownClockPhase,
} from "@/lib/trip-clock";
import { boatStageOf, finalHomeSaid, tripPhaseOf } from "@/lib/trip-phase";
import { acceptsNewDivers, seatsOnSale } from "@/lib/trips";
import { uuidParam } from "@/lib/uuid";
import { diversTabState } from "./_arrivals/departure-record";
import { CoursePulse } from "./_components/CoursePulse";
import { DeskRefresh } from "./_components/DeskRefresh";
import { departureConditionReads } from "./_components/departure-conditions";
import { departureStateOf } from "./_components/departure-states";
import { detailsReadRows } from "./_components/details-rows";
import { FlySafeFollowUps } from "./_components/FlySafeFollowUps";
import { GuestBands } from "./_components/GuestBands";
import { PulseFacts, shownPulseFacts } from "./_components/PulseFacts";
import { CheckInPhase } from "./_components/phases/CheckInPhase";
import { EditTrip } from "./_components/phases/EditTrip";
import { FillingPhase } from "./_components/phases/FillingPhase";
import { ReadyPhase } from "./_components/phases/ReadyPhase";
import { WaterPhase } from "./_components/phases/WaterPhase";
import { WrappedPhase } from "./_components/phases/WrappedPhase";
import { tripRosterActions } from "./_components/roster-actions";
import { addBandFor } from "./_components/seat-request-band";
import { TripCancellation } from "./_components/TripCancellation";
import { TripDeskConnectivity } from "./_components/TripDeskConnectivity";
import { TripHeader, tripFacts } from "./_components/TripHeader";
import { TripNoticeBanner } from "./_components/TripNoticeBanner";
import { TripPhaseStrip } from "./_components/TripPhaseStrip";
import { TripRosterContent } from "./_components/TripRosterContent";
import { TripSentenceLine } from "./_components/TripSentenceLine";
import { phaseStripCopy } from "./_components/trip-clock-copy";
import { tripHeaderDaySpan } from "./_components/trip-header-price";
import { showsEditTrip } from "./_components/trip-notice-views";
import { paymentAsks, tripPageNotices } from "./_components/trip-page-asks";
import { tripPulseFactsOf } from "./_components/trip-pulse-facts";
import { type TripPageSearchParams, tripFlashParams } from "./_components/trip-search-params";
import { tripSentence } from "./_components/trip-sentence";
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
    now,
    t,
    locale,
    session,
    filters: { diverQuery: diverq, confirmName },
  });
  const { departureNeeds } = reading;
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
  const clockInput = { ...lifecycle, cancelled };
  const currentPhase = clockPhaseOf(clockInput);
  const shownPhase: ClockPhase = shownClockPhase(askedPhase, currentPhase);
  const pulseFacts = tripPulseFactsOf(overview, {
    liveBoatClashes: cancelled ? [] : boatClashes,
    shopSlug,
    tripId,
    now,
    t,
    needs: overview.pulseNeeded && !showDetails ? await departureNeeds() : null,
  });

  const details = showDetails ? await reading.details() : null;
  const readRows = detailsReadRows({ db, shop, overview, t, locale, shown: showDetails });
  const { automatedForecast, tideLines } = departureConditionReads({
    showDetails,
    trip,
    tripDiveList,
    scheduleDayCount: scheduleDays.length,
    shop,
    locale,
    t,
  });

  const detailsEditable = tripPhaseOf(lifecycle) !== "back";
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

  // The counts the strip and the sentence say, off the roster already read.
  const active = guests.roster.filter(({ booking }) => booking.status !== "no_show");
  const here = active.filter((entry) => entry.checkedIn).length;
  const blocked = active.filter(({ booking }) =>
    rosterRowIsBlocked(guests.byBooking.readiness.get(booking.id)?.readiness),
  ).length;
  const capacity = seatsOnSale(trip).capacity;
  const nextStartsAt = nextMeetingStart(clockInput);
  const boat = trip.boatId ? await getBoatById(db, shop.id, trip.boatId) : null;
  const facts = tripFacts({
    trip,
    daySpan: tripHeaderDaySpan(scheduleDays, locale, shop.timezone, t),
    boatName: boat?.name,
    meetingPlace: meetingPointOfRows(shop, trip).label,
    locale,
    timeZone: shop.timezone,
  });
  const stripCopy = phaseStripCopy(
    t,
    phaseWhens({ ...clockInput, booked: trip.booked, capacity, here }),
    { locale, timeZone: shop.timezone },
  );
  const sentence = tripSentence(
    {
      phase: shownPhase,
      cancelled,
      now,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      nextStartsAt,
      dockCallAt: dockCallAt(nextStartsAt, shop.dockCallMinutes),
      booked: trip.booked,
      capacity,
      guests: active.length,
      here,
      blocked,
      notBack: unaccounted.size,
      stage: boatStageOf(clockInput),
      homeSaid: finalHomeSaid(clockInput),
      locale,
      timeZone: shop.timezone,
    },
    t,
  );
  // **Roll call has a door from Check-in on, and on every cancelled trip**: a blow-out
  // cancels the trip and leaves every booking active, so the crew may still need the
  // roll call to put people back ashore (dive-domain review 20260920). Before
  // Check-in it is in More.
  const rollCallDoor =
    currentPhase === null || CLOCK_PHASES.indexOf(currentPhase) >= CLOCK_PHASES.indexOf("checkin");
  const tripPath = shopPath(shopSlug, "trips", tripId);

  const guestList = showDetails ? null : (
    <DeskRefresh
      open={Boolean(desk)}
      copy={{
        pulling: t("checkIn.pullToRefresh.pulling"),
        release: t("checkIn.pullToRefresh.release"),
        refreshing: t("checkIn.pullToRefresh.refreshing"),
      }}
    >
      <div className="space-y-6 group-has-[[data-guest-folio]]/folio:hidden">
        <GuestBands
          overview={overview}
          showMinimum={pulseNeeded && !sailed}
          shopSlug={shopSlug}
          locale={locale}
          timeZone={shop.timezone}
          t={t}
        />

        <PulseFacts
          facts={shownPulseFacts(pulseFacts, { desk, finished: sailed })}
          foldLabel={(count) => t("trips.pulse.needsYou", { count })}
        />

        <CoursePulse
          shopSlug={shopSlug}
          pulse={coursePulse}
          tripId={tripId}
          locale={locale}
          timeZone={shop.timezone}
        />
      </div>
      <TripRosterContent
        context={{
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
            notice === "participant-type-cert" && staffGates.mayOverrideCertBlock ? bid : undefined,
          mayWriteOffPayment,
          currency: shop.currency,
          ...staffGates,
          actions: rosterActions,
        }}
      />
    </DeskRefresh>
  );
  const recordContext = { context: { db, shop, session }, tripId, locale, t };

  return (
    <>
      <FlashParams params={tripFlashParams({ held, form })} />
      {/* **One gap between every section, masthead included** (K-262). The
          roster's own blocks are `display: contents`, in this flow, on the
          same stack (`TripRosterContent`). */}
      <div className="group/folio space-y-6 sm:space-y-10 group-has-[[data-guest-folio]]/folio:space-y-3">
        <TripHeader
          trip={trip}
          facts={facts}
          shopSlug={shopSlug}
          tripId={tripId}
          rollCallInMore={!rollCallDoor}
          addGuest={acceptsDivers && capacity > trip.booked}
          locale={locale}
          timeZone={shop.timezone}
          t={t}
        />
        {/* **The phase strip is on every trip, cancelled or not**: a cancelled trip opens on
            Wrapped up, and every phase stays a tap away. */}
        <TripPhaseStrip
          shopSlug={shopSlug}
          tripId={tripId}
          current={currentPhase}
          shown={showDetails ? null : shownPhase}
          copy={stripCopy}
        />
        {showDetails ? null : (
          <TripSentenceLine
            sentence={sentence}
            rollCall={
              rollCallDoor
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
        ) : shownPhase === "filling" ? (
          <FillingPhase guests={guestList} />
        ) : shownPhase === "ready" ? (
          <ReadyPhase guests={guestList} />
        ) : shownPhase === "checkin" ? (
          <CheckInPhase guests={guestList} />
        ) : shownPhase === "water" ? (
          <WaterPhase guests={guestList} record={recordContext} />
        ) : (
          <WrappedPhase guests={guestList} record={{ ...recordContext, guests }} />
        )}
      </div>
    </>
  );
}
