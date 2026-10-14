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
import {
  canPersonManageOrders,
  canPersonManagePaymentSettings,
  canPersonOverrideCertBlock,
  canPersonRefund,
  canPersonRetireMedicalRefusal,
} from "@/db/authz";
import { listBoats } from "@/db/boats";
import { listTripLenses } from "@/db/trip-lenses";
import { latestTripStage } from "@/db/trip-stages";
import { getTripGuests, getTripOverview, loadTripSharedReads } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { reportRenderQueries } from "@/lib/observability/query-timing";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { type FormNotice, noticeForForm, noticeFromParam, shopPath } from "@/lib/staff-notices";
import { departureStage } from "@/lib/trip-phase";
import { acceptsNewDivers, isFull, seatsOnSale } from "@/lib/trips";
import { uuidParam } from "@/lib/uuid";
import { diversTabState } from "./_arrivals/departure-record";
import { DESK_NOTICES } from "./_arrivals/notices";
import { DeskRefresh } from "./_components/DeskRefresh";
import { departureConditionReads } from "./_components/departure-conditions";
import { openSeatsDetailsRows } from "./_components/details-rows";
import { MinimumSeatsBand } from "./_components/MinimumSeatsBand";
import { PulseFacts, shownPulseFacts } from "./_components/PulseFacts";
import { tripRosterActions } from "./_components/roster-actions";
import { TripAboutLinks } from "./_components/TripAboutLinks";
import { TripAboutSection } from "./_components/TripAboutSection";
import { TripIncidentReports } from "./_components/TripIncidentReports";
import { TripMoreActions } from "./_components/TripMoreActions";
import { resolveTripNotice, TripNoticeBanner } from "./_components/TripNoticeBanner";
import { TripAddDiverLink, TripCapacityBadge, TripPageHeader } from "./_components/TripPageHeader";
import { TripPromoteAndActivity, TripRosterContent } from "./_components/TripRosterContent";
import { TripStageBadge, TripTabs } from "./_components/TripTabs";
import { assignedCrewNames, tripAboutRows } from "./_components/trip-about-rows";
import { tripCrewNotes } from "./_components/trip-crew-notes";
import { tripHeaderDaySpan, tripHeaderPrice } from "./_components/trip-header-price";
import { DETAILS_FORMS, pageNoticesFor } from "./_components/trip-notice-tabs";
import { tripPulseFacts } from "./_components/trip-pulse-facts";
import type { TripPageSearchParams } from "./_components/trip-search-params";
import { tripTabsCopy } from "./_components/trip-tabs-copy";
import { reinstateTripAction } from "./details-actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
export const instant = true;

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
    },
  ] = await Promise.all([params, searchParams]);
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(tripId)) notFound();
  const { session, db, shop } = await requireShopSurface(shopSlug);
  reportRenderQueries("/shop/[shopSlug]/trips/[id]", after);
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  // Locale and the trip row both depend on `shop` but not on each other.
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const sharedReads = loadTripSharedReads(db, shop.id, tripId);
  const [
    overview,
    guests,
    shopBoats,
    shopLenses,
    mayDiscount,
    mayWriteOffPayment,
    stageReading,
    mayRetireRefusal,
    canManageOrders,
    mayOverrideCertBlock,
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
    canPersonManagePaymentSettings(db, shop.id, session.user.personId),
    canPersonRefund(db, shop.id, session.user.personId),
    latestTripStage(db, shop.id, tripId),
    // Who may give a refused seat a fresh release; the action re-checks.
    canPersonRetireMedicalRefusal(db, shop.id, session.user.personId),
    // The per-seat "Create order" door (issue #1925): read for itself, not
    // borrowed from `mayDiscount`, though both are owner/manager today.
    canPersonManageOrders(db, shop.id, session.user.personId),
    // Who is offered "Change anyway" past a missing card; the action re-checks.
    canPersonOverrideCertBlock(db, shop.id, session.user.personId),
  ]);
  if (!overview || !guests) notFound();
  const {
    trip,
    cancelled,
    pulseNeeded,
    requirement,
    tripDiveList,
    series,
    scheduleDays,
    canConfigure,
    blowoutCalled,
    pulse,
    boatClashes,
    crew,
  } = overview;
  // One hull, one departure at a time (H-80, issue #1780). A called-off
  // departure holds no hull, and `boatClashes` answers nothing for one anyway.
  const liveBoatClashes = cancelled ? [] : boatClashes;
  const { crewGap } = crew;
  const crewNotes = tripCrewNotes({
    crew,
    diversPerDivemaster: shop.diversPerDivemaster,
    locale,
    t,
  });

  // One resolution, handed to the section it belongs to. Whatever no rendered
  // section claims — a page-level permission refusal, or a section this
  // staffer's role means we never rendered — falls through to the banner.
  // The desk's own refusals and walk-in outcomes (`_arrivals/notices.ts`) are
  // page-level: they have no form on the roster to sit beside, and a code the
  // roster's own vocabulary also speaks is the roster's.
  const deskNoticeDefinition = noticeFromParam(notice, DESK_NOTICES);
  const tripNotice: FormNotice | undefined =
    resolveTripNotice({ notice, count, form, gate, tripId, locale }) ??
    (deskNoticeDefinition
      ? { form: "page", tone: deskNoticeDefinition.tone, text: t(deskNoticeDefinition.key) }
      : undefined);
  const lifecycleStatus = noticeForForm(tripNotice, "lifecycle");

  const now = nowDate();
  const pulseFacts = tripPulseFacts({
    pulseNeeded,
    pulse,
    crewGap,
    requirement,
    cancelled,
    course: trip.course,
    liveBoatClashes,
    shopSlug,
    tripId,
    startsAt: trip.startsAt,
    now,
    t,
  });

  // **Details is its own tab**, and a save on it lands back on it.
  const showDetails =
    view === "details" || Boolean(tripNotice && DETAILS_FORMS.has(tripNotice.form));
  const openSeatsRows = openSeatsDetailsRows({ db, shop, tripId, t, locale, shown: showDetails });
  const { automatedForecast, tideLines } = departureConditionReads({
    showDetails,
    trip,
    tripDiveList,
    scheduleDayCount: scheduleDays.length,
    shop,
    locale,
    t,
  });

  const { rootPageNotice, rosterPageNotice } = pageNoticesFor(tripNotice);
  const acceptsDivers = acceptsNewDivers(trip, now);
  const { shown, finished, checkInOpen } = departureStage({
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    now,
    timeZone: shop.timezone,
    stage: stageReading,
    cancelled,
  });
  // The desk while arrivals are open, or a finished departure's record.
  const { desk, record } = await diversTabState({
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
    finished,
  });

  const tabsCopy = tripTabsCopy(t, checkInOpen ? { trip, shop, locale } : undefined);
  const rosterActions = await tripRosterActions({
    db,
    shop,
    shopSlug,
    tripId,
    trip,
    locale,
    now,
    mayRetireRefusal,
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
                finished={finished}
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
          // Only while the boat can take a seat: full, sailed, held or
          // cancelled, and the header offers nothing (owner, 2026-10-06). A
          // full boat's wait list stays in the roster's own Add band.
          actions={
            !acceptsDivers || isFull(seatsOnSale(trip)) ? undefined : (
              <TripAddDiverLink
                // The roster's own band, on the Divers tab: from Details the
                // anchor is not on the page.
                href={`${shopPath(shopSlug, "trips", tripId)}#add-diver`}
                label={t("trips.addDiver.addDiver")}
                compactLabel={t("trips.about.add")}
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

        {cancelled && (canConfigure || blowoutCalled || lifecycleStatus) ? (
          // A card in a tone: the card's radius, bed and inset, so its words
          // start where the cards around it do; only the border and fill are its
          // own (pixel-craft classes 3 and 12).
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
                  liveBoatClashes,
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
                  held: notice === "saved" ? held : undefined,
                  tell,
                }),
                ...(await openSeatsRows),
              ]}
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
              mayDiscount={mayDiscount}
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
            {pulseNeeded && !finished ? (
              <MinimumSeatsBand
                trip={trip}
                booked={trip.booked}
                locale={locale}
                timeZone={shop.timezone}
                t={t}
              />
            ) : null}

            <PulseFacts
              facts={shownPulseFacts(pulseFacts, { desk, finished })}
              foldLabel={(count) => t("trips.pulse.toSort", { count })}
            />

            <TripRosterContent
              context={{
                arrival: desk?.arrival,
                record,
                walkInOpen: desk?.walkInOpen,
                acceptsDivers,
                guests,
                shopSlug,
                shopName: shop.name,
                locale,
                timezone: shop.timezone,
                depthUnit: shop.depthUnit,
                shopRentalItems: shop.rentalItems,
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
                // Every row folds its fixes now, so whatever a save inside a row
                // reports, the row it names stays open on the way back: the
                // staffer lands where they were working, not on a closed list.
                // A removed seat has no row to hold.
                keepOpenBookingId: notice?.startsWith("booking-removed") ? undefined : bid,
                // The one paper-release refusal with a way through (issue #1573),
                // scoped to the seat the action named so a roster of minors does not
                // all sprout the staffer's confirmation.
                namesakeRefusedBookingId: notice === "waiver-guardian-name" ? bid : undefined,
                participantTypeCertBookingId:
                  notice === "participant-type-cert" && mayOverrideCertBlock ? bid : undefined,
                mayWriteOffPayment,
                canManageOrders,
                compact: true,
                actions: rosterActions,
              }}
            />
          </DeskRefresh>
        )}
      </div>
    </>
  );
}
