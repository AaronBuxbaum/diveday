import { notFound } from "next/navigation";
import { after } from "next/server";
import { FlashParams } from "@/components/FlashParams";
import { waitForNavigationGate } from "@/features/e2e-test-routes";
import { requireShopSurface } from "@/features/session";
import { readTripPage } from "@/features/trip-page";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { reportRenderQueries } from "@/lib/observability/query-timing";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { shopPath } from "@/lib/staff-notices";
import { acceptsNewDivers, isFull, seatsOnSale } from "@/lib/trips";
import { uuidParam } from "@/lib/uuid";
import { diversTabState } from "./_arrivals/departure-record";
import { ConservationPanel } from "./_components/ConservationPanel";
import { CoursePulse } from "./_components/CoursePulse";
import { DeskRefresh } from "./_components/DeskRefresh";
import { departureConditionReads } from "./_components/departure-conditions";
import { departureStateOf } from "./_components/departure-states";
import { detailsReadRows } from "./_components/details-rows";
import { FlySafeFollowUps } from "./_components/FlySafeFollowUps";
import { MinimumSeatsBand } from "./_components/MinimumSeatsBand";
import { PulseFacts, shownPulseFacts } from "./_components/PulseFacts";
import { tripRosterActions } from "./_components/roster-actions";
import { addBandFor } from "./_components/seat-request-band";
import { TripAboutLinks } from "./_components/TripAboutLinks";
import { TripAboutSection } from "./_components/TripAboutSection";
import { TripAddBookingLink } from "./_components/TripAddBookingLink";
import { TripCancellation } from "./_components/TripCancellation";
import { TripDeskConnectivity } from "./_components/TripDeskConnectivity";
import { TripHeaderBadges } from "./_components/TripHeaderBadges";
import { TripIncidentReports } from "./_components/TripIncidentReports";
import { TripMoreActions } from "./_components/TripMoreActions";
import { TripNoticeBanner } from "./_components/TripNoticeBanner";
import { TripPageHeader } from "./_components/TripPageHeader";
import { TripPromoteAndActivity, TripRosterContent } from "./_components/TripRosterContent";
import { TripTabs } from "./_components/TripTabs";
import { assignedCrewNames, tripAboutRows } from "./_components/trip-about-rows";
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

/**
 * Two of a departure's four tabs (ADR 20261001-logbook, decision 3): Divers,
 * the grouped roster of the people coming, and Details (`?view=details`), the
 * departure's definition laid flat. Boat and Gear are their own routes beside
 * this one.
 *
 * **Divers is also the desk** (owner, 2026-10-05). Check-in was a fifth tab
 * listing the same people with the same blockers and the same fixes; once a
 * departure's arrivals open, this roster gains the count and each cleared row
 * its check-in tap (`_arrivals/arrival-desk.tsx`), and there is one list.
 *
 * ADR 20260919-one-idea's hour masthead and drawn hull are retired here (owner,
 * 2026-10-05): every tab wears one `TripPageHeader`, and the roster is the
 * only reading of who is aboard.
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
      held,
      tell,
      ...rest
    },
  ] = await Promise.all([params, searchParams]);
  // An unparseable UUID must not reach Postgres.
  if (!uuidParam(tripId)) notFound();
  // The test gate exists only in the isolated E2E server and lets its real
  // loading boundary stream while a test holds this page's dynamic read.
  if (process.env.DIVEDAY_E2E === "1") await waitForNavigationGate(tripId);
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
    series,
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
    onDivers: !showDetails,
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
      <div className="space-y-10">
        {/* **One header on all four tabs** (owner, 2026-10-05): the
            departure's name, its stage and seats, and when it sails. Divers
            and Details wore a header of their own — the hour as a giant
            name, the crew and boat in a line under it — so every tab change
            redrew the top of the page. */}
        <TripPageHeader
          backLabel={t(STAFF_DESTINATION_LABEL_KEYS.board)}
          trip={trip}
          locale={locale}
          timeZone={shop.timezone}
          badge={
            <TripHeaderBadges {...{ trip, sailed, tabsCopy, t }} stage={shown?.stage ?? null} />
          }
          extraMeta={desk ? <TripDeskConnectivity active t={t} /> : undefined}
          price={tripHeaderPrice(trip, shop.currency, locale, t)}
          daySpan={tripHeaderDaySpan(scheduleDays, locale, shop.timezone, t)}
          // A full boat's wait list stays in the roster's Add band.
          actions={
            !acceptsDivers || isFull(seatsOnSale(trip)) ? undefined : (
              <TripAddBookingLink
                tripHref={shopPath(shopSlug, "trips", tripId)}
                label={t("trips.addDiver.heading")}
                ariaLabel={t("trips.about.addDiverJump")}
              />
            )
          }
        />
        {/* **The roll call is a tab on every departure, cancelled or not.** A
            blow-out cancels the trip and leaves every booking active, so the
            crew may still need the roll call to put people back ashore
            (dive-domain review 20260920). The tabs never hide on cancellation. */}
        <TripTabs
          shopSlug={shopSlug}
          tripId={tripId}
          current={showDetails ? "details" : "divers"}
          copy={tabsCopy}
        />

        <TripNoticeBanner notice={rootPageNotice} locale={locale} />
        <FlySafeFollowUps {...{ db, shop, shopSlug, tripId, now, locale }} />

        <TripCancellation
          {...{ cancelled, canConfigure, blowoutCalled, lifecycleStatus, shopSlug, tripId, t }}
        />

        {details ? (
          <>
            <TripAboutSection
              rows={[
                ...tripAboutRows({
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
                }),
                ...(await readRows),
              ]}
              editLabel={t("trips.about.edit")}
              actions={
                <TripAboutLinks
                  shop={shop}
                  personId={session.user.personId}
                  shopSlug={shopSlug}
                  tripId={tripId}
                  t={t}
                />
              }
            />
            <ConservationPanel
              shopSlug={shopSlug}
              panel={details.conservation}
              tripId={tripId}
              t={t}
              locale={locale}
              timeZone={shop.timezone}
            />
            <TripIncidentReports shop={shop} personId={session.user.personId} tripId={tripId} />
            <TripPromoteAndActivity
              guests={guests}
              shopSlug={shopSlug}
              locale={locale}
              shop={shop}
              tripNotice={tripNotice}
              mayDiscount={staffGates.mayDiscount}
              more={
                cancelled ? undefined : (
                  <TripMoreActions
                    shop={shop}
                    personId={session.user.personId}
                    shopSlug={shopSlug}
                    tripId={tripId}
                    startsAt={trip.startsAt}
                    series={canConfigure ? series : null}
                    crewNames={assignedCrewNames(overview)}
                    lifecycleStatus={lifecycleStatus}
                    refundsHeld={!mayWriteOffPayment}
                    locale={locale}
                    t={t}
                  />
                )
              }
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
            {pulseNeeded && !sailed ? (
              <MinimumSeatsBand
                trip={trip}
                booked={trip.booked}
                locale={locale}
                timeZone={shop.timezone}
                t={t}
              />
            ) : null}

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
