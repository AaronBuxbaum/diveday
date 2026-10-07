import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { seatExistingDiverAction, seatNewDiverAction } from "@/app/actions/seat-diver";
import { ConnectivityStatus } from "@/components/ConnectivityStatus";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { TONE_PANEL_CLASS } from "@/components/ui/card";
import { FormStatus } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import {
  canPersonManageOrders,
  canPersonManagePaymentSettings,
  canPersonRefund,
  canPersonRetireMedicalRefusal,
} from "@/db/authz";
import { listBoats } from "@/db/boats";
import { listTripLenses } from "@/db/trip-lenses";
import { latestTripStage } from "@/db/trip-stages";
import { getTripGuests } from "@/db/trips-guests";
import { getTripOverview } from "@/db/trips-overview";
import { languageNameIn } from "@/i18n/language-labels";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { staffTideStationText, staffTideWindowText } from "@/i18n/tide-labels";
import { ratingLapsedDetailText } from "@/i18n/today-labels";
import { nowDate } from "@/lib/clock";
import { DSD_RATIO } from "@/lib/course-ratios";
import { oneWindowPerSite, tideWindowsForDeparture } from "@/lib/departure-tides";
import { depthInUnit } from "@/lib/depth-units";
import { parseDockDayRhythm } from "@/lib/diver-planning";
import { PREP_SECTION_ID } from "@/lib/element-id";
import { formatMoneyCents, formatShortDate, formatTime, weekdayNames } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import {
  fetchAutomatedMarineForecast,
  hasCrewPrediction,
  shouldShowAutomatedForecast,
} from "@/lib/marine-forecast";
import { toShopCurrency } from "@/lib/money";
import { publicTripPath } from "@/lib/public-routes";
import { recurrenceSummary } from "@/lib/recurrence";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { type FormNotice, noticeForForm, noticeFromParam, shopPath } from "@/lib/staff-notices";
import { temperatureUnitFor } from "@/lib/temperature-units";
import { tripPhaseOf } from "@/lib/trip-phase";
import { acceptsNewDivers, isFull } from "@/lib/trips";
import { uuidParam } from "@/lib/uuid";
import { buildArrivalDesk } from "./_arrivals/arrival-desk";
import { CheckInQueueRefresh } from "./_arrivals/CheckInQueueRefresh";
import { DESK_NOTICES } from "./_arrivals/notices";
import { ConditionsSection } from "./_components/ConditionsSection";
import { CopyLinkButton } from "./_components/CopyLinkButton";
import { CrewSection } from "./_components/CrewSection";
import { DetailsSection } from "./_components/DetailsSection";
import { MinimumSeatsBand } from "./_components/MinimumSeatsBand";
import { PrintTripBundleButton } from "./_components/PrintTripBundleButton";
import { RequirementsSection } from "./_components/RequirementsSection";
import {
  recurrenceSummaryText,
  SeriesCadenceEditor,
  SeriesMoreActions,
} from "./_components/SeriesSection";
import { TripAboutSection, TripMoreDisclosure } from "./_components/TripAboutSection";
import { resolveTripNotice, TripNoticeBanner } from "./_components/TripNoticeBanner";
import { TripAddDiverLink, TripCapacityBadge, TripPageHeader } from "./_components/TripPageHeader";
import { TripPromoteAndActivity, TripRosterContent } from "./_components/TripRosterContent";
import { TripStageBadge, TripTabs } from "./_components/TripTabs";
import { tripTabsCopy } from "./_components/trip-tabs-copy";
import {
  addInternalNoteAction,
  addToWaitlistAction,
  applySeriesDetailsAction,
  cancelOffCadenceSeriesAction,
  cancelSeriesAction,
  cancelTripAction,
  certifyDiverFromRosterAction,
  clearConditionsAction,
  confirmDiverIdentityAction,
  createDirectTripInvitationAction,
  deleteInternalNoteAction,
  markPaymentAction,
  markWaiverInPersonAction,
  recordTripInvitationAction,
  recordTripPrintPdfAction,
  reinstateTripAction,
  removeBookingAction,
  restoreInternalNoteAction,
  saveConditionsAction,
  saveCourseNextStepAction,
  saveDetails,
  saveRequirementsAction,
  saveRosterEmergencyContactAction,
  sendNewWaiverAction,
  setSeriesRepeatAction,
  splitDiverIdentityAction,
  undoRemoveBookingAction,
  updateBookingPickupAction,
  updateSeriesCadenceAction,
  updateTripCrewAction,
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
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  // Locale and the trip row both depend on `shop` but not on each other.
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
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
  ] = await Promise.all([
    getTripOverview(db, shop, tripId, session.user.personId),
    getTripGuests(db, shop, tripId, { diverQuery: diverq, confirmName }),
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
  ]);
  if (!overview || !guests) notFound();
  const {
    trip,
    cancelled,
    pulseNeeded,
    staff,
    requirement,
    diveSiteList,
    tripDiveList,
    siteRequirement,
    series,
    scheduleDays,
    canConfigure,
    blowoutCalled,
    offCadence,
    diveSites,
    startWall,
    endWall,
    pulse,
    boatClashes,
    crew,
  } = overview;
  // One hull, one departure at a time (H-80, issue #1780). A called-off
  // departure holds no hull, and `boatClashes` answers nothing for one anyway.
  const liveBoatClashes = cancelled ? [] : boatClashes;
  const boatClashText = (clash: (typeof boatClashes)[number]) =>
    t("trips.pulse.boatClash", { boat: clash.boatName, departure: clash.otherTitle });
  const {
    crewIds,
    tripRoleByPerson,
    crewGap,
    ratioGap,
    languageGap,
    lapsedCrew,
    onShiftIds,
    clashes,
  } = crew;
  // Who a lapsed rating took down a rung (issue #1853), in Today's own
  // sentence: one fact, one set of words wherever a staffer meets it.
  const ratingLapsedNote =
    lapsedCrew.length > 0 ? ratingLapsedDetailText(t, locale, lapsedCrew) : null;
  // Same tone as underTargetNote below: informs, refuses nothing (issue
  // #708). Each missing language is named in the reader's own locale
  // (`languageNameIn`), matching the team settings form's convention —
  // unlike the diver-facing badge, which uses each language's own endonym.
  const languageGapNote =
    languageGap.code === "none"
      ? null
      : t("trips.crew.languageGap", {
          languages: cachedListFormat(locale, { style: "long", type: "conjunction" }).format(
            languageGap.missing.map((code) => languageNameIn(code, locale) ?? code),
          ),
        });
  const underTargetNote =
    ratioGap.code === "none"
      ? null
      : t("trips.crew.underTarget", {
          divers: ratioGap.divers,
          divemasters: ratioGap.divemasterCount,
          ratio: shop.diversPerDivemaster,
          // The total the target wants, not the shortfall: "wants 1 more" than
          // none reads as arithmetic about nothing when the boat has no
          // divemaster at all, which is the case that matters most.
          needed: ratioGap.needed,
        });
  // Two rules, two sentences: the entry-level cap is PADI's published Open
  // Water training figure and a certified assistant raises it; the intro cap is
  // PADI's tighter published Discover Scuba open-water figure (HD-6) that an
  // assistant does not move. One generic string told a DSD manager to add a
  // divemaster, which cannot work, and cited the wrong PADI number at them. The
  // per-instructor figure is interpolated from `DSD_RATIO` so the sentence
  // cannot drift away from the cap the gate actually enforces.
  const overRatioWarning =
    crewGap.code !== "over_ratio"
      ? null
      : crewGap.ratio === "intro"
        ? t("trips.detail.overRatioWarningIntro", {
            booked: crewGap.booked,
            cap: crewGap.capacity,
            perInstructor: DSD_RATIO.openWaterStudentsPerInstructor,
          })
        : t("trips.detail.overRatioWarning", { booked: crewGap.booked, cap: crewGap.capacity });

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
  // One notice per About row, resolved once: a refusal that lands inside a
  // closed row is a form the staffer cannot see failed.
  const detailsStatus = noticeForForm(tripNotice, "details");
  const conditionsStatus = noticeForForm(tripNotice, "conditions");
  const requirementsStatus = noticeForForm(tripNotice, "requirements");
  const seriesStatus = noticeForForm(tripNotice, "series");

  // Capacity moved into the masthead ring in slice 5e. Non-seat pulse facts
  // remain as quiet links so the redesign changes their home and emphasis,
  // not the actions they lead to.
  const pulseFacts = pulseNeeded
    ? [
        ...(pulse.blocked > 0
          ? [
              {
                text: t("trips.pulse.blocked", { count: pulse.blocked }),
                // The ledger's "Still to clear" group leads the roster, so the
                // plain anchor lands on the blocked rows (slice 5d retired the
                // `?rf=` filter with the chips).
                href: `${shopPath(shopSlug, "trips", tripId)}#roster`,
                tone: "danger" as const,
              },
            ]
          : []),
        // A course session whose crew can't cover it is a can-this-boat-sail fact
        // in the pulse's exact register — until it surfaces here, the strip's
        // quiet reads as an all clear the Crew panel three screens down would
        // contradict. The panel keeps the full sentence; this is the door to it,
        // and since #1125 these two read at the length a door is. They used to
        // be whole sentences ("This course session has no instructor yet"),
        // which the staffing week's ~135px day column — the *other* surface
        // rendering these two keys — wrapped onto four lines beside its
        // two-word codes.
        //
        // Shortened to a requirement rather than a state, on a
        // `dive-domain-expert` read: a fun dive with no instructor is an
        // ordinary Tuesday, and a course session without one cannot take a
        // single enrolment. "No instructor" described the harmless one. And
        // "Over student ratio" rather than "Over ratio" because DiveDay has two
        // ratios and the other one renders in the same column as "Under target"
        // — the agency's published training cap refuses seats, the shop's own
        // diver:divemaster target binds nothing (docs/product/glossary.md).
        ...(crewGap.code === "no_instructor"
          ? [
              {
                text: t("trips.pulse.needsInstructor"),
                href: "?view=details#crew",
                tone: "danger" as const,
              },
            ]
          : []),
        // No requirements row blocks every diver at boarding
        // (`requirements_not_configured`), and the fix lives on Details.
        ...(requirement === null && !cancelled && !trip.course
          ? [
              {
                text: t("trips.pulse.noRequirements"),
                href: "?view=details#requirements",
                tone: "danger" as const,
              },
            ]
          : []),
        // The hull is on another departure at these hours. It holds the boat
        // up as squarely as a missing instructor does, and the fix is on one
        // of the two departures, so the door opens the other one.
        ...liveBoatClashes.map((clash) => ({
          text: boatClashText(clash),
          href: shopPath(shopSlug, "trips", clash.otherTripId),
          tone: "danger" as const,
        })),
        ...(crewGap.code === "over_ratio"
          ? [
              {
                text: t("trips.pulse.overRatio"),
                href: "?view=details#crew",
                tone: "danger" as const,
              },
            ]
          : []),
        ...(pulse.prepGaps > 0
          ? [
              {
                text: t("trips.pulse.prepGaps", { count: pulse.prepGaps }),
                // The packing list is the Gear tab (ADR 20261001-logbook).
                href: `${shopPath(shopSlug, "trips", tripId, "prep")}#${PREP_SECTION_ID}`,
              },
            ]
          : []),
        // Money owed is work, not a boarding hazard — so it reads in the pulse's
        // neutral ink, below the facts that hold the boat up, and it is the one
        // fact here whose fix lives off the trip entirely. `range=all` because the
        // count is unwindowed: a seat sold months ahead was invoiced months ago,
        // and the index's default 90-day window would open on fewer orders than
        // the fact just promised.
        ...(pulse.openOrders > 0
          ? [
              {
                text: t("trips.pulse.awaitingPayment", { count: pulse.openOrders }),
                href: `${shopPath(shopSlug, "orders")}?tripId=${tripId}&status=open&range=all`,
              },
            ]
          : []),
      ]
    : [];

  const siteWithForecast = tripDiveList.find(
    ({ diveSite }) =>
      diveSite && diveSite.forecastLatitude !== null && diveSite.forecastLongitude !== null,
  )?.diveSite;
  const forecastPoint =
    siteWithForecast &&
    siteWithForecast.forecastLatitude !== null &&
    siteWithForecast.forecastLongitude !== null
      ? {
          latitude: siteWithForecast.forecastLatitude,
          longitude: siteWithForecast.forecastLongitude,
        }
      : null;
  const automatedForecast =
    forecastPoint && shouldShowAutomatedForecast(trip.startsAt)
      ? await fetchAutomatedMarineForecast(forecastPoint, trip.startsAt)
      : null;
  // One sentence per stationed site, read at the boat's own arrival there
  // (ADR 20260907-noaa-tide-predictions). Empty on most departures.
  const rhythm = parseDockDayRhythm(shop);
  const tideWindows = rhythm
    ? await tideWindowsForDeparture({
        startsAt: trip.startsAt,
        plannedDives: trip.plannedDives,
        diveMode: trip.diveMode,
        dives: tripDiveList.map(({ dive, diveSite }) => ({
          diveNumber: dive.diveNumber,
          travelMinutes: dive.travelMinutes,
          site: diveSite
            ? {
                name: diveSite.name,
                tideStationId: diveSite.tideStationId,
                tidePreference: diveSite.tidePreference,
                expectedBottomTimeMinutes: diveSite.expectedBottomTimeMinutes,
              }
            : null,
        })),
        rhythm,
        timeZone: shop.timezone,
        scheduleDayCount: scheduleDays.length,
      })
    : [];
  // A site dived twice reads its water once (`oneWindowPerSite`).
  const tideLines = oneWindowPerSite(tideWindows).map((entry) => ({
    site: entry.siteName,
    text: staffTideWindowText(
      t,
      entry.window,
      entry.preference,
      formatTime(entry.window.nearestTurn.at, locale, shop.timezone),
    ),
    station: entry.stationLabel ? staffTideStationText(t, entry.stationLabel) : null,
  }));

  const aboutForms = new Set([
    "details",
    "requirements",
    "conditions",
    "crew",
    "series",
    "lifecycle",
    // Promote lives on Details (`TripPromoteAndActivity`), so its answer does.
    "last-minute-deal",
  ]);
  const rosterForms = new Set(["roster", "add-diver"]);
  const rootPageNotice =
    tripNotice && !aboutForms.has(tripNotice.form) && !rosterForms.has(tripNotice.form)
      ? tripNotice
      : undefined;
  const rosterPageNotice = tripNotice && tripNotice.form === "roster" ? tripNotice : undefined;
  // **Details is its own tab**, and a save on it lands back on it: the About
  // forms redirect to the departure with their `form`, which is enough to
  // know which tab the answer belongs to, so no action needs to know the tab.
  const showDetails = view === "details" || Boolean(tripNotice && aboutForms.has(tripNotice.form));
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
  // The count leads the desk and says "1 diver can't board yet" itself, so the
  // pulse's door to the same rows stands down while it is on screen.
  const shownPulseFacts = desk?.arrival.instrument
    ? pulseFacts.filter((fact) => !fact.href.endsWith("#roster"))
    : pulseFacts;

  const siteNames = diveSites.sites.map((site) => site.name);
  const planSummary = siteNames.length > 0 ? siteNames.join(" + ") : t("trips.about.noneSet");
  const requirementsSummary =
    requirement === null
      ? t("trips.about.noRequirements")
      : [
          requirement.minimumCertificationLevel
            ? t("trips.requirements.summaryCert", {
                level: t(CERTIFICATION_LEVEL_KEYS[requirement.minimumCertificationLevel]),
              })
            : null,
          requirement.requiresWaiver ? t("trips.requirements.summaryWaiver") : null,
          !trip.course && requirement.requiresPayment
            ? t("trips.requirements.summaryPayment")
            : null,
          ...(!trip.course
            ? requirement.requiredSpecialties.map((specialty) =>
                t("trips.requirements.summarySpecialtyCard", {
                  specialty: t(SPECIALTY_KEYS[specialty]),
                }),
              )
            : []),
          !trip.course && requirement.requiresNitrox
            ? t("trips.requirements.summaryNitroxCard")
            : null,
        ]
          .filter((part): part is string => Boolean(part))
          .join(" · ") || t("trips.requirements.summaryNoneRequired");
  const conditionParts = [
    trip.conditionsSummary,
    trip.surfaceConditions,
    trip.visibilityMeters !== null
      ? t("trips.conditions.visibilityFact", {
          value: `${depthInUnit(trip.visibilityMeters, shop.depthUnit)} ${t(
            shop.depthUnit === "feet" ? "shared.depth.feet" : "shared.depth.meters",
          )}`,
        })
      : null,
  ].filter((part): part is string => Boolean(part));
  // The tide stands in for the at-rest line only when there is nothing else:
  // "No conditions yet" beside a known slack would be the summary
  // contradicting its own panel. It never joins a line that already has the
  // crew's read — the strip is one line and truncates, and a full sentence
  // appended to four readings pushes the readings off the end of it.
  const conditionsSummary = trip.conditionsHold
    ? t("trips.conditions.holdOnSummary")
    : // Deliberately no tide fallback here. `tideLines[0]` is *one site's*
      // water, and the strip strips the site prefix the panel below adds for
      // exactly that reason -- so on a two-stationed-site day it stated dive
      // one's tide as the whole departure's conditions. The tide is not the
      // crew's conditions read, and the panel below already carries it in full.
      conditionParts.join(" · ") || t("trips.about.noConditions");
  const assignedCrew = staff
    .filter((entry) => crewIds.includes(entry.person.id))
    .map((entry) => entry.person.fullName);
  // The fleet's row for this departure's boat, for its name on the about line.
  // A shore dive or a pool session finds nothing here.
  const boat = shopBoats.find((row) => row.id === trip.boatId);
  const boatName = boat?.name;
  const boatAndCrew = [boatName, ...assignedCrew].filter((part): part is string => Boolean(part));
  const boatCrewSummary = boatAndCrew.join(" · ") || t("trips.about.noBoat");

  const tabsCopy = tripTabsCopy(t);
  const repeatsSummary = series
    ? recurrenceSummaryText(
        t,
        locale,
        recurrenceSummary({
          intervalWeeks: series.intervalWeeks,
          weekdays: series.weekdayMask,
          endsOn: series.endsOn,
        }),
      )
    : t("trips.about.oneTime");
  // How much of the run is still on the board — a fact the cadence sentence
  // alone does not carry, and the one the "cancel every upcoming date" confirm
  // is counting. It rides on the row rather than on the collapsed strip, which
  // is one truncating line and has the cadence to fit first.
  const repeatsRowValue = series
    ? series.futureScheduledCount > 0
      ? t("tripSeries.panel.summaryWithFuture", {
          summary: repeatsSummary,
          count: series.futureScheduledCount,
        })
      : t("tripSeries.panel.summaryAllDone", { summary: repeatsSummary })
    : repeatsSummary;
  // The clash is a fact about two boats that will both sail, so a called-off
  // departure drops it with the rest of the live-trip nudges — `crewClashes`
  // answers nothing for one anyway, and this keeps the two from ever
  // disagreeing on screen.
  const liveClashes = cancelled ? [] : clashes;
  // The crew row opens itself whenever there is crew work to do — nobody
  // assigned, a standing clash, a course without its instructor, a shortfall
  // against the shop's own target, or a language nobody aboard speaks. A
  // settled crew collapses to the one line that names them (principles.md §9).
  // A shop that plans no crew here is not nagged with an open editor for an
  // empty crew list; a course still is, through its own instructor gap.
  const crewRowOpen =
    Boolean(noticeForForm(tripNotice, "crew")) ||
    (shop.crewScheduleEnabled && crewIds.length === 0) ||
    liveClashes.length > 0 ||
    (!cancelled &&
      (crewGap.code !== "none" ||
        underTargetNote !== null ||
        languageGapNote !== null ||
        ratingLapsedNote !== null));
  const rosterActions = {
    addBookingAction: seatNewDiverAction.bind(null, "trip-guests", shopSlug),
    addExistingDiverAction: seatExistingDiverAction.bind(null, "trip-guests", shopSlug),
    addToWaitlistAction: addToWaitlistAction.bind(null, shopSlug, tripId),
    createDirectTripInvitationAction: createDirectTripInvitationAction.bind(null, shopSlug, tripId),
    markWaiverInPersonAction: markWaiverInPersonAction.bind(null, shopSlug, tripId),
    markPaymentAction: markPaymentAction.bind(null, shopSlug, tripId),
    removeBookingAction: removeBookingAction.bind(null, shopSlug, tripId),
    // One door on this tab, desk or not: the arrivals window opens 36 hours
    // ahead, so a confirm made inside it is no evidence the diver was standing
    // at the counter (dive-domain review 2026-10-05).
    confirmDiverIdentityAction: confirmDiverIdentityAction.bind(null, shopSlug, tripId),
    splitDiverIdentityAction: splitDiverIdentityAction.bind(null, shopSlug, tripId),
    sendNewWaiverAction: mayRetireRefusal
      ? sendNewWaiverAction.bind(null, shopSlug, tripId)
      : undefined,
    certifyDiverAction: trip.course
      ? certifyDiverFromRosterAction.bind(null, shopSlug, tripId)
      : undefined,
    // The two course acts travel together: a roster that could certify a
    // student but not tell them what comes next is half a session's record.
    saveCourseNextStepAction: trip.course
      ? saveCourseNextStepAction.bind(null, shopSlug, tripId)
      : undefined,
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
              rows={[
                {
                  id: "details",
                  label: t("trips.about.plan"),
                  // The missing price rides on the row rather than inside the editor
                  // it is about: it is the one thing about the plan that is a
                  // problem, and the board's "Set a price for …" link lands here
                  // (task 150, UX persona lens 17).
                  value:
                    trip.priceCents === null && !cancelled ? (
                      <>
                        {planSummary}
                        <span className="mt-0.5 block font-medium text-warning-strong">
                          {t("trips.details.summaryNoPrice")}
                        </span>
                      </>
                    ) : (
                      planSummary
                    ),
                  editLabel: t("trips.details.edit"),
                  editorOpen: Boolean(detailsStatus),
                  editor: canConfigure ? (
                    <DetailsSection
                      action={saveDetails.bind(null, shopSlug, tripId)}
                      status={detailsStatus}
                      trip={trip}
                      diveSiteList={diveSiteList}
                      tripDiveList={tripDiveList}
                      startWall={startWall}
                      endWall={endWall}
                      dayCount={Math.max(1, scheduleDays.length)}
                      locale={locale}
                      currency={toShopCurrency(shop.currency)}
                      boats={shopBoats.map((boat) => ({ id: boat.id, name: boat.name }))}
                      lenses={shopLenses.map((lens) => ({ id: lens.id, name: lens.name }))}
                      hasBoatDiving={shop.hasBoatDiving}
                      hasShoreDiving={shop.hasShoreDiving}
                      hasPoolDiving={shop.hasPoolDiving}
                    />
                  ) : undefined,
                },
                {
                  id: "conditions",
                  label: t("trips.about.conditions"),
                  value: conditionsSummary,
                  editLabel: hasCrewPrediction(trip)
                    ? t("trips.conditions.editPublished")
                    : t("trips.conditions.editEmpty"),
                  editorOpen: Boolean(conditionsStatus),
                  /* Conditions are crew-entered (glossary) — open to all staff. Its
               fields are uncontrolled (`defaultValue`, not `value`), so a save
               or clear that lands via a same-route re-render rather than a
               fresh mount leaves the old value on screen — the same
               cacheComponents-can-skip-a-remount class ADR
               20260802-cache-components-cross-render-state and ADR
               20260801-cache-components-activity-state both hit, just in the
               opposite direction. Keying on the fields themselves (not
               `conditionsUpdatedAt`, which the e2e harness's frozen clock
               would hold identical across a save-then-clear in the same test)
               forces the remount `defaultValue` needs on any actual change to
               what these inputs show. */
                  editor: (
                    <ConditionsSection
                      key={[
                        trip.waterTemperatureC,
                        trip.visibilityMeters,
                        trip.surfaceConditions,
                        trip.conditionsSummary,
                      ].join("|")}
                      saveAction={saveConditionsAction.bind(null, shopSlug, tripId)}
                      clearAction={clearConditionsAction.bind(null, shopSlug, tripId)}
                      status={conditionsStatus}
                      trip={trip}
                      locale={locale}
                      timezone={shop.timezone}
                      temperatureUnit={temperatureUnitFor(shop)}
                      depthUnit={shop.depthUnit}
                      automatedForecast={automatedForecast}
                      tideLines={tideLines}
                    />
                  ),
                },
                {
                  id: "requirements",
                  label: t("trips.about.whoCanBook"),
                  value: requirementsSummary,
                  // A course session's gate is frozen — `saveRequirementsAction`
                  // refuses to edit it — so its row opens onto where the rules come
                  // from rather than onto a form, and says so in the word on the
                  // control.
                  editLabel: trip.course ? t("trips.about.details") : t("trips.requirements.edit"),
                  // Fail-closed, open: with no requirements row readiness blocks
                  // every diver, so that state may never wait behind a tap. A frozen
                  // course gate opens for the opposite reason — one read-only
                  // sentence has nothing worth folding away.
                  editorOpen:
                    Boolean(requirementsStatus) || requirement === null || Boolean(trip.course),
                  editor: canConfigure ? (
                    <RequirementsSection
                      action={saveRequirementsAction.bind(null, shopSlug, tripId)}
                      status={requirementsStatus}
                      trip={trip}
                      requirement={requirement}
                      siteRequirement={siteRequirement}
                      siteNames={diveSites.sites.map((site) => site.name)}
                      locale={locale}
                    />
                  ) : undefined,
                },
                // **On every departure, whatever the crew schedule says**: who
                // is aboard is manifest data (the crew roll call, the souls-on-
                // board count), not planning (ADR 20261005-crew-schedule-is-a-setting).
                {
                  id: "about-crew",
                  label: t("trips.about.boatAndCrew"),
                  // The Details form is the door that changes the boat, and it
                  // redirects here, so the hull's clash rides on this row as
                  // well as on the Divers tab's pulse.
                  value:
                    liveBoatClashes.length > 0 ? (
                      <>
                        {boatCrewSummary}
                        {liveBoatClashes.map((clash) => (
                          <Link
                            key={clash.otherTripId}
                            href={shopPath(shopSlug, "trips", clash.otherTripId)}
                            className="mt-0.5 block font-medium text-danger hover:underline"
                          >
                            {boatClashText(clash)}
                          </Link>
                        ))}
                      </>
                    ) : (
                      boatCrewSummary
                    ),
                  editLabel: t("trips.crew.edit"),
                  // **A row with open work stays open** (principles.md §9's
                  // "collapse the settled row", read the other way). A boat with
                  // nobody on it, a clash, a course with no instructor, a shortfall
                  // against the shop's own target or a language nobody aboard
                  // speaks are all things a staffer is here to fix — and the two
                  // safety-adjacent ones are also linked from the pulse above,
                  // which is what makes `#crew` land on something rather than on a
                  // closed row.
                  editorOpen: crewRowOpen,
                  /* Who's aboard is manifest accuracy (glossary) — open to all
               staff. Per-person assign/unassign (updateTripCrewAction), the
               same mutation the schedule board uses — not a whole-set replace
               — so two staff editing crew at once can no longer clobber each
               other (Lens 17 task 139). */
                  editor: (
                    <CrewSection
                      shopSlug={shopSlug}
                      tripId={tripId}
                      staff={staff}
                      crewIds={crewIds}
                      crewRoles={Object.fromEntries(tripRoleByPerson)}
                      // A cancelled departure isn't sailing, so its crew panel drops
                      // the live-trip nudges — the ratio gates, the shop's target,
                      // and the shift-coverage badges are all about a boat that will
                      // leave.
                      onShiftIds={cancelled ? null : onShiftIds}
                      clashes={liveClashes}
                      crewGapCode={cancelled ? "none" : crewGap.code}
                      updateCrewAction={updateTripCrewAction.bind(null, shopSlug)}
                      copy={{
                        heading: t("trips.crew.heading"),
                        courseNeedsInstructor: t("trips.crew.courseNeedsInstructor"),
                        overRatioWarning,
                        underTargetNote: cancelled ? null : underTargetNote,
                        languageGapNote: cancelled ? null : languageGapNote,
                        ratingLapsedNote: cancelled ? null : ratingLapsedNote,
                        noStaff: t("trips.crew.noCrew"),
                        notAssignedYet: t("trips.crew.notAssignedYet"),
                        assignLabel: t("trips.crew.assignLabel"),
                        assignOption: t("trips.crew.assignOption"),
                        unassignAria: t.raw("trips.crew.unassignAria"),
                        assignFailed: t("trips.crew.assignFailed"),
                        // `t.raw`: `{name}` is whoever the staffer just picked,
                        // which only the component knows (src/i18n/fill.ts).
                        assignClash: t.raw("trips.crew.assignClash"),
                        // `t.raw`: `{departure}` is the other boat's own title,
                        // which only the component has per row (src/i18n/fill.ts).
                        clash: t.raw("trips.crew.clash"),
                        roleAria: t.raw("trips.crew.roleAria"),
                        roleUnspecified: t("trips.crew.roleUnspecified"),
                        roleOptions: {
                          instructor: t("trips.crew.roleInstructor"),
                          divemaster: t("trips.crew.roleDivemaster"),
                          captain: t("trips.crew.roleCaptain"),
                          crew: t("trips.crew.roleCrew"),
                        },
                        onShift: t("trips.crew.onShift"),
                        notOnShift: t("trips.crew.notOnShift"),
                        manageShifts: shop.crewScheduleEnabled
                          ? t("trips.crew.manageShifts")
                          : null,
                      }}
                    />
                  ),
                },
                {
                  id: "series",
                  label: t("trips.about.repeats"),
                  value: repeatsRowValue,
                  editLabel: t("tripSeries.panel.editCadence"),
                  editorOpen: Boolean(seriesStatus),
                  editor:
                    canConfigure && series ? (
                      <SeriesCadenceEditor
                        intervalWeeks={series.intervalWeeks}
                        weekdays={series.weekdayMask}
                        endsOn={series.endsOn}
                        anchorDate={series.anchorDate}
                        offCadence={offCadence.map((date) => ({
                          id: date.id,
                          title: date.title,
                          // Formatted here, where the request locale and the shop's
                          // zone both are — the panel is handed words, never
                          // instants.
                          label: formatShortDate(date.startsAt, locale, shop.timezone),
                          booked: date.booked,
                        }))}
                        weekdayNames={weekdayNames(locale)}
                        status={seriesStatus}
                        cadenceAction={updateSeriesCadenceAction.bind(
                          null,
                          shopSlug,
                          tripId,
                          series.id,
                        )}
                        cancelOffCadenceAction={cancelOffCadenceSeriesAction.bind(
                          null,
                          shopSlug,
                          tripId,
                          series.id,
                        )}
                        locale={locale}
                      />
                    ) : undefined,
                },
              ]}
              actions={
                <>
                  {/* All three flush, so whichever starts a line — the first, or one
                  wrapped on a phone — puts its word on the panel's column; the
                  row's gap hands back what they gave up (TripAboutSection). */}
                  <CopyLinkButton
                    path={publicTripPath(shopSlug, tripId)}
                    label={t("trips.detail.copyBookingLink")}
                    copiedLabel={t("trips.detail.linkCopied")}
                    failedLabel={t("trips.detail.linkCopyFailed")}
                    flush
                  />
                  <Link
                    href={publicTripPath(shopSlug, tripId)}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonClass({ variant: "ghost", size: "sm", flush: true })}
                  >
                    {t("trips.about.viewPublic")}
                  </Link>
                  <PrintTripBundleButton
                    href={shopPath(shopSlug, "trips", tripId, "print")}
                    label={t("trips.about.printPacket")}
                    popupBlockedLabel={t("shared.printButton.popupBlocked")}
                    recordAction={recordTripPrintPdfAction.bind(null, shopSlug, tripId)}
                    flush
                  />
                </>
              }
            />
            <TripPromoteAndActivity
              guests={guests}
              shopSlug={shopSlug}
              locale={locale}
              timezone={shop.timezone}
              tripNotice={tripNotice}
              mayDiscount={mayDiscount}
              more={
                cancelled ? undefined : (
                  <TripMoreDisclosure label={t("trips.about.more")} open={Boolean(lifecycleStatus)}>
                    <FormStatus tone={lifecycleStatus?.tone} className="mb-2">
                      {lifecycleStatus?.text}
                    </FormStatus>
                    {canConfigure && series ? (
                      <SeriesMoreActions
                        futureScheduledCount={series.futureScheduledCount}
                        endsOn={series.endsOn}
                        applyAction={applySeriesDetailsAction.bind(
                          null,
                          shopSlug,
                          tripId,
                          series.id,
                        )}
                        cancelAction={cancelSeriesAction.bind(null, shopSlug, tripId, series.id)}
                        repeatAction={setSeriesRepeatAction.bind(null, shopSlug, tripId, series.id)}
                        locale={locale}
                      />
                    ) : null}
                    {/* The blow-out carries no caption here because the page it
                    opens is one: "This cancels {trip} and sends every booked
                    diver one message…" is its first line, and it is the confirm
                    (ADR 20260804-blowout-cascade). */}
                    <Link
                      href={shopPath(shopSlug, "schedule", "blowout", tripId)}
                      className={buttonClass({ variant: "danger-ghost", size: "sm", flush: true })}
                    >
                      {t("trips.detail.weatherBlowout")}
                    </Link>
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

            {/* **The stack's gap is measured to the words** (K-262). Each fact is
            a 44px link round a 20px line, and its words sat 12px inside each
            40px gap. Each link gives that unseen 12px back as `-my-3`, so the
            row is its words' height and the targets overhang the gaps;
            `gap-y-7` keeps a wrapped line's box 4px clear of the one above.
            Not on the row: the stack's end margin is `:where()`, and the
            row's own `-my-3` would replace it and pull the roster up. */}
            {shownPulseFacts.length > 0 ? (
              <div className="flex flex-wrap gap-x-4 gap-y-7">
                {shownPulseFacts.map((fact) => (
                  <Link
                    key={fact.href}
                    href={fact.href}
                    className={`-my-3 inline-flex min-h-11 items-center text-sm font-medium hover:underline ${
                      fact.tone === "danger" ? "text-danger" : "text-primary"
                    }`}
                  >
                    {fact.text}
                  </Link>
                ))}
              </div>
            ) : null}

            <TripRosterContent
              arrival={desk?.arrival}
              walkIn={desk?.walkIn}
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
              mayDiscount={mayDiscount}
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

/**
 * Pull-to-refresh while the desk is open — a phone at the counter re-reads the
 * list with the same gesture the boat's roll call uses. The rest of the week
 * the roster is an ordinary page, and its stack lies in the page's flow.
 */
function DeskRefresh({
  open,
  copy,
  children,
}: {
  open: boolean;
  copy: { pulling: string; release: string; refreshing: string };
  children: React.ReactNode;
}) {
  if (!open) return <>{children}</>;
  return (
    <CheckInQueueRefresh copy={copy}>
      <div className="space-y-10">{children}</div>
    </CheckInQueueRefresh>
  );
}
