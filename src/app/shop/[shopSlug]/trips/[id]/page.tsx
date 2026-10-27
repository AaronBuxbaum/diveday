import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { ConnectivityStatus } from "@/components/ConnectivityStatus";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { TONE_PANEL_CLASS } from "@/components/ui/card";
import { FormStatus } from "@/components/ui/form";
import { canPersonRefund, canPersonRetireMedicalRefusal } from "@/db/authz";
import { listBoats } from "@/db/boats";
import { getDepartureNeeds } from "@/db/today-departure-needs";
import { listTripLenses } from "@/db/trip-lenses";
import { latestTripStage } from "@/db/trip-stages";
import { getTripGuests, getTripOverview, loadTripSharedReads } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { reportRenderQueries } from "@/lib/observability/query-timing";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { shopPath } from "@/lib/staff-notices";
import { acceptsNewDivers, isFull, seatsOnSale } from "@/lib/trips";
import { uuidParam } from "@/lib/uuid";
import { diversTabState } from "./_arrivals/departure-record";
import { DeskRefresh } from "./_components/DeskRefresh";
import { departureConditionReads } from "./_components/departure-conditions";
import { detailsReadRows } from "./_components/details-rows";
import { FlySafeFollowUps } from "./_components/FlySafeFollowUps";
import { MinimumSeatsBand } from "./_components/MinimumSeatsBand";
import { PulseFacts, shownPulseFacts } from "./_components/PulseFacts";
import { tripRosterActions } from "./_components/roster-actions";
import { TripAboutLinks } from "./_components/TripAboutLinks";
import { TripAboutSection } from "./_components/TripAboutSection";
import { TripAddBookingLink } from "./_components/TripAddBookingLink";
import { TripIncidentReports } from "./_components/TripIncidentReports";
import { TripMoreActions } from "./_components/TripMoreActions";
import { TripNoticeBanner } from "./_components/TripNoticeBanner";
import { TripCapacityBadge, TripPageHeader } from "./_components/TripPageHeader";
import { TripPromoteAndActivity, TripRosterContent } from "./_components/TripRosterContent";
import { TripStageBadge, TripTabs } from "./_components/TripTabs";
import { assignedCrewNames, tripAboutRows } from "./_components/trip-about-rows";
import { tripCrewNotes } from "./_components/trip-crew-notes";
import { tripHeaderDaySpan, tripHeaderPrice } from "./_components/trip-header-price";
import { DETAILS_FORMS } from "./_components/trip-notice-tabs";
import { paymentAsks, tripPageNotices } from "./_components/trip-page-asks";
import { tripPulseFactsOf } from "./_components/trip-pulse-facts";
import type { TripPageSearchParams } from "./_components/trip-search-params";
import { tripTabsCopy } from "./_components/trip-tabs-copy";
import { readStaffGates } from "./_lib/staff-gates";
import { reinstateTripAction } from "./details-actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
export const instant = true;

// Trip details and the roster share the same authorized shop context.
// The flying-guidance follow-up panel is visible from every departure.
// Staff dates follow the device's requested locale.
// Departure warnings follow the current shop.
export const metadata: Metadata = {
  title: "Manage trip — DiveDay",
};

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
      count,
      form,
      gate,
      noteBookingId,
      noteBody,
      confirmName,
      confirmEmail,
      confirmPhone,
      view,
      held,
      tell,
      ...paymentParams
    },
  ] = await Promise.all([params, searchParams]);
  // An unparseable UUID must not reach Postgres.
  if (!uuidParam(tripId)) notFound();
  const { session, db, shop } = await requireShopSurface(shopSlug);
  reportRenderQueries("/shop/[shopSlug]/trips/[id]", after);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const sharedReads = loadTripSharedReads(db, shop.id, tripId);
  const now = nowDate();
  const needs =
    view === "details" ? null : getDepartureNeeds(db, shop, tripId, { now, t, locale, session });
  const [
    overview,
    guests,
    shopBoats,
    shopLenses,
    mayWriteOffPayment,
    stageReading,
    mayRetireRefusal,
    staffGates,
  ] = await Promise.all([
    // Both read the trip, its requirements, readiness and prep list; started
    // once here and handed to each (`src/db/trips-shared-reads.ts`).
    getTripOverview(db, shop, tripId, session.user.personId, undefined, sharedReads),
    getTripGuests(db, shop, tripId, { diverQuery: diverq, confirmName }, sharedReads),
    // The fleet, for the Details form's hull select. Live hulls only: this is
    // a picker for what the departure will sail on, not a record of what it
    // did (`listBoatsForHistory` is the other one).
    shop.hasBoatDiving ? listBoats(db, shop.id) : [],
    // The shop's trip tags, for the select beside the
    // hull (ADR 20260904-reef-all-the-way-down, decision 2).
    listTripLenses(db, shop.id),
    canPersonRefund(db, shop.id, session.user.personId),
    latestTripStage(db, shop.id, tripId),
    // Who may give a refused seat a fresh release; the action re-checks.
    canPersonRetireMedicalRefusal(db, shop.id, session.user.personId),
    readStaffGates(db, shop.id, session.user.personId),
  ]);
  if (!overview || !guests) notFound();
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
  // One hull, one departure at a time (H-80, issue #1780). A called-off
  // departure holds no hull, and `boatClashes` answers nothing for one anyway.
  const crewNotes = tripCrewNotes({
    crew: overview.crew,
    diversPerDivemaster: shop.diversPerDivemaster,
    locale,
    t,
  });

  const { tripNotice, lifecycleStatus, rootPageNotice, rosterPageNotice } = tripPageNotices({
    notice,
    count,
    form,
    gate,
    tripId,
    locale,
    bid,
    roster: guests.roster,
    t,
  });

  const pulseFacts = tripPulseFactsOf(overview, {
    liveBoatClashes: cancelled ? [] : boatClashes,
    shopSlug,
    tripId,
    now,
    t,
    needs: overview.pulseNeeded ? await needs : null,
  });

  // **Details is its own tab**, and a save on it lands back on it.
  const showDetails =
    view === "details" || Boolean(tripNotice && DETAILS_FORMS.has(tripNotice.form));
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
  // The desk while arrivals are open, or a finished departure's record; the
  // stage is read with it, since a diver counted out and not back keeps the
  // departure open (`readDepartureStage`).
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
    params: paymentParams,
  });

  return (
    <>
      <FlashParams
        params={[
          "notice",
          "count",
          "form",
          "bid",
          "diverq",
          "inviteq",
          "rf",
          "noteBookingId",
          "noteBody",
          "confirmName",
          "confirmEmail",
          "confirmPhone",
        ]}
      />
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
          className=""
          boardHref={shopPath(shopSlug, "schedule", "board")}
          backLabel={t(STAFF_DESTINATION_LABEL_KEYS.board)}
          trip={trip}
          locale={locale}
          timeZone={shop.timezone}
          badge={
            <>
              <TripStageBadge stage={shown?.stage ?? null} copy={tabsCopy} />
              <TripCapacityBadge
                trip={trip}
                finished={sailed}
                cancelledLabel={t("trips.detail.cancelledBadge")}
                t={t}
              />
            </>
          }
          // The price is here because nothing else on Divers says it.
          // **Say it before the tap, not after.** The desk is live-only — the
          // boat has an encrypted device copy and this does not — so a dropped
          // signal means the list is stale and the next tap will not send
          // (issue #819).
          extraMeta={
            desk ? (
              <ConnectivityStatus
                offlineLabel={t("checkIn.offlineLabel")}
                onlyWhenOffline
                className="mt-2"
                copy={{
                  online: t("shared.connectivity.online"),
                  onlineTitle: t("shared.connectivity.onlineTitle"),
                  offlineTitle: t("shared.connectivity.offlineTitle"),
                }}
              />
            ) : undefined
          }
          price={tripHeaderPrice(trip, shop.currency, locale, t)}
          daySpan={tripHeaderDaySpan(scheduleDays, locale, shop.timezone, t)}
          // Only while the boat can take a seat (owner, 2026-10-06); a full
          // boat's wait list stays in the roster's own Add band.
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

        {cancelled && (canConfigure || blowoutCalled || lifecycleStatus) ? (
          // A card in a tone: the card's radius, bed and inset, so its words start
          // where the cards around it do; only border and fill differ (pixel-craft 3, 12).
          <section className={`${TONE_PANEL_CLASS} border-danger/40 bg-danger/10`}>
            <FormStatus tone={lifecycleStatus?.tone} className="mb-3">
              {lifecycleStatus?.text}
            </FormStatus>
            <div className="flex flex-wrap items-center gap-3">
              {canConfigure ? (
                <form action={reinstateTripAction.bind(null, shopSlug, tripId)}>
                  <SubmitButton
                    pendingLabel={t("trips.detail.reinstating")}
                    className={buttonClass()}
                  >
                    {t("trips.detail.reinstate")}
                  </SubmitButton>
                </form>
              ) : null}
              {blowoutCalled ? (
                <Link
                  href={shopPath(shopSlug, "schedule", "blowout", tripId)}
                  className={buttonClass({ variant: "secondary" })}
                >
                  {t("trips.detail.viewBlowout", { cause: blowoutCalled })}
                </Link>
              ) : null}
            </div>
          </section>
        ) : null}

        {showDetails ? (
          <>
            <TripAboutSection
              rows={[
                ...tripAboutRows({
                  overview,
                  crewNotes,
                  liveBoatClashes: cancelled ? [] : boatClashes,
                  shop,
                  shopSlug,
                  tripId,
                  locale,
                  t,
                  tripNotice,
                  shopBoats,
                  shopLenses,
                  automatedForecast,
                  tideLines,
                  held,
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

            <TripRosterContent
              context={{
                arrival: desk?.arrival,
                record,
                inWaterCrew: overview.crew.inWaterCrew,
                walkInOpen: desk?.walkInOpen,
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
                noteDeleted:
                  noteBookingId && noteBody
                    ? { bookingId: noteBookingId, body: noteBody }
                    : undefined,
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
                // The one paper-release refusal with a way through (issue #1573),
                // scoped to the seat the action named so a roster of minors does not
                // all sprout the staffer's confirmation.
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
