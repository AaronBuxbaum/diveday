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
import { acceptsNewDivers, isFull, seatsOnSale } from "@/lib/trips";
import { uuidParam } from "@/lib/uuid";
import { diversTabState } from "./_arrivals/departure-record";
import { CoursePulse } from "./_components/CoursePulse";
import { DeskRefresh } from "./_components/DeskRefresh";
import { DiversTabBands } from "./_components/DiversTabBands";
import { departureConditionReads } from "./_components/departure-conditions";
import { departureStateOf } from "./_components/departure-states";
import { detailsReadRows } from "./_components/details-rows";
import { FlySafeFollowUps } from "./_components/FlySafeFollowUps";
import { PulseFacts, shownPulseFacts } from "./_components/PulseFacts";
import { tripRosterActions } from "./_components/roster-actions";
import { addBandFor } from "./_components/seat-request-band";
import { TripCancellation } from "./_components/TripCancellation";
import { TripDayOperations } from "./_components/TripDayOperations";
import { TripDeskConnectivity } from "./_components/TripDeskConnectivity";
import { TripDetailsPanel } from "./_components/TripDetailsPanel";
import { TripFolioHeader } from "./_components/TripFolioHeader";
import { TripHeaderBadges } from "./_components/TripHeaderBadges";
import { TripNoticeBanner } from "./_components/TripNoticeBanner";
import { TripRecordPanel } from "./_components/TripRecordPanel";
import { TripRosterContent } from "./_components/TripRosterContent";
import { TripTabs } from "./_components/TripTabs";
import { tripHeaderDaySpan, tripHeaderPrice } from "./_components/trip-header-price";
import { showsDetailsTab } from "./_components/trip-notice-tabs";
import { paymentAsks, tripPageNotices } from "./_components/trip-page-asks";
import { tripPulseFactsOf } from "./_components/trip-pulse-facts";
import { type TripPageSearchParams, tripFlashParams } from "./_components/trip-search-params";
import { tripTabsCopy } from "./_components/trip-tabs-copy";
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

/** Guests and The day share this route; Record keeps its own evidence view.
 * Preserves the trip identity from 20260919-one-idea. */
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

  const showDetails = showsDetailsTab(view, rest.add, tripNotice);
  const showRecord = view === "record" && !showDetails && !rest.add;
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

  const lifecycle = {
    ...trip,
    now,
    timeZone: shop.timezone,
    stage: stageReading,
    cancelled: false,
    meetingWindows: scheduleDays,
  };
  const detailsEditable = tripPhaseOf(lifecycle) !== "back";
  const mayChangeDeparture = !cancelled && !finalHomeSaid(lifecycle);
  const acceptsDivers = acceptsNewDivers(trip, now);
  // The desk while arrivals are open, or a finished departure's record; the stage is read with
  // it, since a diver counted out and not back keeps the departure open (`readDepartureStage`).
  const { shown, sailed, checkInOpen, desk, record } = await diversTabState({
    db,
    shopId: shop.id,
    shopSlug,
    tripId,
    trip,
    now,
    locale,
    timeZone: shop.timezone,
    t,
    onDivers: !showDetails && !showRecord,
    stage: stageReading,
    cancelled,
    meetingWindows: scheduleDays,
  });

  const tabsCopy = tripTabsCopy(t, checkInOpen ? { trip, shop, locale } : undefined);
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

  return (
    <>
      <FlashParams params={tripFlashParams({ held, form })} />
      {/* **One gap between every section, masthead included** (K-262). Each
          block used to hang its own margin — the masthead `mb-5`, the bands
          `mt-6`, the pulse links `mt-4`, the roster `mt-5`, the packing list
          `mt-10` — and the page stepped 16, 20, 24, 32 and 40px between
          sections of one kind. One `space-y-10` holds them all; the roster's
          own blocks are `display: contents`, in this flow, on the same stack
          (`TripRosterContent`). */}
      <div className="group/folio space-y-6 sm:space-y-10 group-has-[[data-guest-folio]]/folio:space-y-3">
        {/* **One header on all four tabs** (owner, 2026-10-05): the
            departure's name, its stage and seats, and when it sails. Divers
            and Details wore a header of their own — the hour as a giant
            name, the crew and boat in a line under it — so every tab change
            redrew the top of the page. */}
        <TripFolioHeader
          trip={trip}
          locale={locale}
          timeZone={shop.timezone}
          badge={
            <TripHeaderBadges {...{ trip, sailed, tabsCopy, t }} stage={shown?.stage ?? null} />
          }
          extraMeta={desk ? <TripDeskConnectivity active t={t} /> : undefined}
          price={tripHeaderPrice(trip, shop.currency, locale, t)}
          daySpan={tripHeaderDaySpan(scheduleDays, locale, shop.timezone, t)}
          doors={{
            tripHref: shopPath(shopSlug, "trips", tripId),
            allowAdd: acceptsDivers && !isFull(seatsOnSale(trip)),
            addLabel: t("trips.addDiver.heading"),
            addAriaLabel: t("trips.about.addDiverJump"),
            deckLabel: t("trips.folio.openDeck"),
          }}
        />
        {/* **The roll call is a tab on every departure, cancelled or not.** A
            blow-out cancels the trip and leaves every booking active, so the
            crew may still need the roll call to put people back ashore
            (dive-domain review 20260920). The tabs never hide on cancellation. */}
        <TripTabs
          shopSlug={shopSlug}
          tripId={tripId}
          current={showDetails ? "details" : showRecord ? "record" : "divers"}
          copy={tabsCopy}
        />

        <TripNoticeBanner notice={rootPageNotice} locale={locale} />
        <FlySafeFollowUps {...{ db, shop, shopSlug, tripId, now, locale }} />

        <TripCancellation
          {...{ cancelled, canConfigure, blowoutCalled, lifecycleStatus, shopSlug, tripId, t }}
        />

        {showRecord ? (
          <TripRecordPanel context={{ db, shop, session }} {...{ tripId, locale, t, guests }} />
        ) : details ? (
          <>
            <TripDetailsPanel
              context={{
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
              }}
              rows={await readRows}
              conservation={details.conservation}
              personId={session.user.personId}
            />
            <TripDayOperations
              context={{ db, shop, session }}
              {...{
                overview,
                tripId,
                locale,
                t,
                guests,
                tripNotice,
                mayChangeDeparture,
                lifecycleStatus,
              }}
              mayDiscount={staffGates.mayDiscount}
              refundsHeld={!mayWriteOffPayment}
              buddies={rest.buddies}
              buddyError={rest.buddyError}
            />
          </>
        ) : (
          <DeskRefresh
            open={Boolean(desk)}
            copy={{
              pulling: t("checkIn.pullToRefresh.pulling"),
              release: t("checkIn.pullToRefresh.release"),
              refreshing: t("checkIn.pullToRefresh.refreshing"),
            }}
          >
            <div className="space-y-6 group-has-[[data-guest-folio]]/folio:hidden">
              <DiversTabBands
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
                  notice === "participant-type-cert" && staffGates.mayOverrideCertBlock
                    ? bid
                    : undefined,
                mayWriteOffPayment,
                currency: shop.currency,
                ...staffGates,
                actions: rosterActions,
              }}
            />
          </DeskRefresh>
        )}
      </div>
    </>
  );
}
