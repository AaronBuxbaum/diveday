import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { seatExistingDiverAction, seatNewDiverAction } from "@/app/actions/seat-diver";
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
import { formatMoneyCents } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { reportRenderQueries } from "@/lib/observability/query-timing";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { type FormNotice, noticeForForm, noticeFromParam, shopPath } from "@/lib/staff-notices";
import { tripPhaseOf } from "@/lib/trip-phase";
import { acceptsNewDivers, isFull } from "@/lib/trips";
import { uuidParam } from "@/lib/uuid";
import { buildArrivalDesk } from "./_arrivals/arrival-desk";
import { DESK_NOTICES } from "./_arrivals/notices";
import { courseRosterActions } from "./_components/course-roster-actions";
import { DeskRefresh } from "./_components/DeskRefresh";
import { departureConditionReads } from "./_components/departure-conditions";
import { MinimumSeatsBand } from "./_components/MinimumSeatsBand";
import { PulseFacts } from "./_components/PulseFacts";
import { TripAboutLinks } from "./_components/TripAboutLinks";
import { TripAboutSection } from "./_components/TripAboutSection";
import { TripMoreActions } from "./_components/TripMoreActions";
import { resolveTripNotice, TripNoticeBanner } from "./_components/TripNoticeBanner";
import { TripAddDiverLink, TripCapacityBadge, TripPageHeader } from "./_components/TripPageHeader";
import { TripPromoteAndActivity, TripRosterContent } from "./_components/TripRosterContent";
import { TripStageBadge, TripTabs } from "./_components/TripTabs";
import { tripAboutRows } from "./_components/trip-about-rows";
import { tripCrewNotes } from "./_components/trip-crew-notes";
import { DETAILS_FORMS, ROSTER_FORMS } from "./_components/trip-notice-tabs";
import { tripPulseFacts } from "./_components/trip-pulse-facts";
import { tripTabsCopy } from "./_components/trip-tabs-copy";
import {
  addInternalNoteAction,
  addToWaitlistAction,
  confirmDiverIdentityAction,
  createDirectTripInvitationAction,
  deleteInternalNoteAction,
  markPaymentAction,
  markWaiverInPersonAction,
  recordTripInvitationAction,
  reinstateTripAction,
  removeBookingAction,
  restoreInternalNoteAction,
  saveRosterEmergencyContactAction,
  sendNewWaiverAction,
  setParticipantTypeAction,
  splitDiverIdentityAction,
  undoRemoveBookingAction,
  updateBookingPickupAction,
} from "./actions";

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
  searchParams: Promise<{
    notice?: string;
    bid?: string;
    diverq?: string;
    inviteq?: string;
    count?: string;
    /** Which form on this page the notice answers — see `resolveTripNotice`. */
    form?: string;
    /** Signed, and verified against this route's own `id` — src/lib/trip-admission-gate.ts. */
    gate?: string | string[];
    rf?: string;
    noteBookingId?: string;
    noteBody?: string;
    confirmName?: string;
    confirmEmail?: string;
    confirmPhone?: string;
    /** `details` opens the Details tab; anything else is the Divers tab. */
    view?: string;
  }>;
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
    t,
  });

  // **Details is its own tab**, and a save on it lands back on it.
  const showDetails =
    view === "details" || Boolean(tripNotice && DETAILS_FORMS.has(tripNotice.form));
  const { automatedForecast, tideLines } = departureConditionReads({
    showDetails,
    trip,
    tripDiveList,
    scheduleDayCount: scheduleDays.length,
    shop,
    locale,
    t,
  });

  const rootPageNotice =
    tripNotice && !DETAILS_FORMS.has(tripNotice.form) && !ROSTER_FORMS.has(tripNotice.form)
      ? tripNotice
      : undefined;
  const rosterPageNotice = tripNotice && tripNotice.form === "roster" ? tripNotice : undefined;
  const now = nowDate();
  const acceptsDivers = acceptsNewDivers(trip, now);
  const phase = tripPhaseOf({
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    now,
    timeZone: shop.timezone,
    stage: stageReading,
    cancelled,
  });
  // The desk, on the Divers tab of a departure whose arrivals are open; null
  // otherwise, and the roster is exactly what it is the rest of the week.
  const desk = showDetails
    ? null
    : await buildArrivalDesk({
        db,
        shopId: shop.id,
        shopSlug,
        tripId,
        trip,
        now,
        locale,
        timeZone: shop.timezone,
        t,
      });
  // The count leads the desk and says "1 person can't board yet" itself, so the
  // pulse's door to the same rows stands down while it is on screen.
  const shownPulseFacts = desk?.arrival.instrument
    ? pulseFacts.filter((fact) => !fact.href.endsWith("#roster"))
    : pulseFacts;

  const tabsCopy = tripTabsCopy(t);
  const rosterActions = {
    addBookingAction: seatNewDiverAction.bind(null, "trip-guests", shopSlug),
    addExistingDiverAction: seatExistingDiverAction.bind(null, "trip-guests", shopSlug),
    addToWaitlistAction: addToWaitlistAction.bind(null, shopSlug, tripId),
    createDirectTripInvitationAction: createDirectTripInvitationAction.bind(null, shopSlug, tripId),
    markWaiverInPersonAction: markWaiverInPersonAction.bind(null, shopSlug, tripId),
    markPaymentAction: markPaymentAction.bind(null, shopSlug, tripId),
    removeBookingAction: removeBookingAction.bind(null, shopSlug, tripId),
    setParticipantTypeAction: setParticipantTypeAction.bind(null, shopSlug, tripId),
    // One door on this tab, desk or not: the arrivals window opens 36 hours
    // ahead, so a confirm made inside it is no evidence the diver was standing
    // at the counter (dive-domain review 2026-10-05).
    confirmDiverIdentityAction: confirmDiverIdentityAction.bind(null, shopSlug, tripId),
    splitDiverIdentityAction: splitDiverIdentityAction.bind(null, shopSlug, tripId),
    sendNewWaiverAction: mayRetireRefusal
      ? sendNewWaiverAction.bind(null, shopSlug, tripId)
      : undefined,
    ...courseRosterActions(Boolean(trip.course), shopSlug, tripId),
    addInternalNoteAction: addInternalNoteAction.bind(null, shopSlug, tripId),
    deleteInternalNoteAction: deleteInternalNoteAction.bind(null, shopSlug, tripId),
    saveRosterEmergencyContactAction: saveRosterEmergencyContactAction.bind(null, shopSlug, tripId),
    updateBookingPickupAction: updateBookingPickupAction.bind(null, shopSlug, tripId),
    recordTripInvitationAction: recordTripInvitationAction.bind(null, shopSlug, tripId),
    undoRemoveBookingAction: undoRemoveBookingAction.bind(null, shopSlug, tripId),
    restoreInternalNoteAction: restoreInternalNoteAction.bind(null, shopSlug, tripId),
  };

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
              <TripStageBadge phase={phase} copy={tabsCopy} />
              <TripCapacityBadge
                trip={trip}
                cancelledLabel={t("trips.detail.cancelledBadge")}
                t={t}
              />
            </>
          }
          // **The price is here because nothing else on Divers says it**: a
          // staffer quoting a walk-in should not have to open Details.
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
          price={
            trip.priceCents === null
              ? undefined
              : `${formatMoneyCents(trip.priceCents, toShopCurrency(shop.currency), locale)} ${t("trips.about.perSeat")}`
          }
          // Only while the boat can take a seat: full, sailed, held or
          // cancelled, and the header offers nothing (owner, 2026-10-06). A
          // full boat's wait list stays in the roster's own Add band.
          actions={
            !acceptsDivers || isFull(trip) ? undefined : (
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
                  {t("trips.detail.viewBlowout")}
                </Link>
              ) : null}
            </div>
          </section>
        ) : null}

        {showDetails ? (
          <>
            <TripAboutSection
              rows={tripAboutRows({
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
              })}
              actions={
                <TripAboutLinks
                  db={db}
                  shopId={shop.id}
                  personId={session.user.personId}
                  shopSlug={shopSlug}
                  tripId={tripId}
                  t={t}
                />
              }
            />
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
            {pulseNeeded ? (
              <MinimumSeatsBand
                trip={trip}
                booked={trip.booked}
                locale={locale}
                timeZone={shop.timezone}
                t={t}
              />
            ) : null}

            <PulseFacts
              facts={shownPulseFacts}
              foldLabel={(count) => t("trips.pulse.toSort", { count })}
            />

            <TripRosterContent
              arrival={desk?.arrival}
              walkInOpen={desk?.walkInOpen}
              acceptsDivers={acceptsDivers}
              guests={guests}
              shopSlug={shopSlug}
              shopName={shop.name}
              locale={locale}
              timezone={shop.timezone}
              depthUnit={shop.depthUnit}
              shopRentalItems={shop.rentalItems}
              tripNotice={tripNotice}
              pageNotice={rosterPageNotice}
              noteDeleted={
                noteBookingId && noteBody ? { bookingId: noteBookingId, body: noteBody } : undefined
              }
              confirmName={confirmName}
              confirmEmail={confirmEmail}
              confirmPhone={confirmPhone}
              undoBookingId={
                notice?.startsWith("booking-removed") && notice !== "booking-removed-refunded"
                  ? bid
                  : undefined
              }
              // Every row folds its fixes now, so whatever a save inside a row
              // reports, the row it names stays open on the way back: the
              // staffer lands where they were working, not on a closed list.
              // A removed seat has no row to hold.
              keepOpenBookingId={notice?.startsWith("booking-removed") ? undefined : bid}
              // The one paper-release refusal with a way through (issue #1573),
              // scoped to the seat the action named so a roster of minors does not
              // all sprout the staffer's confirmation.
              namesakeRefusedBookingId={notice === "waiver-guardian-name" ? bid : undefined}
              participantTypeCertBookingId={
                notice === "participant-type-cert" && mayOverrideCertBlock ? bid : undefined
              }
              mayWriteOffPayment={mayWriteOffPayment}
              canManageOrders={canManageOrders}
              compact
              actions={rosterActions}
            />
          </DeskRefresh>
        )}
      </div>
    </>
  );
}
