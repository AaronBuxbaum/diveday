import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { seatExistingDiverAction, seatNewDiverAction } from "@/app/actions/seat-diver";
import type { DayStripProps } from "@/components/day/DayStrip";
import { FlashParams } from "@/components/FlashParams";
import { EyebrowBackLink } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { TONE_PANEL_CLASS } from "@/components/ui/card";
import { FormStatus } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { canPersonManagePaymentSettings, canPersonRefund } from "@/db/authz";
import { listBoats } from "@/db/boats";
import { listTripLenses } from "@/db/trip-lenses";
import { getTripGuests } from "@/db/trips-guests";
import { getTripOverview } from "@/db/trips-overview";
import { languageNameIn } from "@/i18n/language-labels";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { staffTideStationText, staffTideWindowText } from "@/i18n/tide-labels";
import { nowDate } from "@/lib/clock";
import { DSD_RATIO } from "@/lib/course-ratios";
import { dayStripGeometry, dayStripTicks, dayStripWindow } from "@/lib/day-strip";
import { tideWindowsForDeparture } from "@/lib/departure-tides";
import { depthInUnit } from "@/lib/depth-units";
import { isPrepGrouping } from "@/lib/dive-prep";
import { parseDockDayRhythm } from "@/lib/diver-planning";
import { PREP_SECTION_ID } from "@/lib/element-id";
import {
  formatHourShort,
  formatMoneyCents,
  formatShortDate,
  formatTime,
  weekdayNames,
} from "@/lib/format";
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
import { daylightProgressAt, skyReadingFor } from "@/lib/sky-scheme";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { noticeForForm, shopPath } from "@/lib/staff-notices";
import { temperatureUnitFor } from "@/lib/temperature-units";
import { uuidParam } from "@/lib/uuid";
import { calendarDayNoons, dayHourBoundaries, utcToWallTime as wallTimeOf } from "@/lib/zoned";
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
import { TripAboutSection } from "./_components/TripAboutSection";
import { resolveTripNotice, TripNoticeBanner } from "./_components/TripNoticeBanner";
import { TripAddDiverLink, TripCapacityBadge, TripSurfaceLink } from "./_components/TripPageHeader";
import { TripPrepSection } from "./_components/TripPrepSection";
import { TripRosterContent } from "./_components/TripRosterContent";
import { VoyageHeader } from "./_components/VoyageHeader";
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
  setSeriesRepeatAction,
  undoRemoveBookingAction,
  updateBookingPickupAction,
  updateSeriesCadenceAction,
  updateTripCrewAction,
} from "./actions";
import { PrepBodySkeleton } from "./prep/_components/PrepBodySkeleton";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
export const instant = true;

/**
 * Every fragment that has to open the About panel: each row's own anchor, plus
 * `#crew`, which is the crew *region* inside its row — the schedule board's
 * "Set a price for …" link and the pulse's crew facts both land here, and a
 * client-side transition runs no native reveal (`AutoOpenDetails`).
 */
const ABOUT_ROW_HASHES = ["details", "conditions", "requirements", "about-crew", "crew", "series"];

export const metadata: Metadata = {
  title: "Manage trip — DiveDay",
};

/**
 * Trip is the departure's working home: a compact About panel for its
 * definition followed by the grouped roster for the people coming. Manifest
 * remains who is aboard and Prep remains what is loaded. This is slice 5e from
 * ADR 20260827-the-departure-is-two-working-surfaces.
 *
 * The composition is masthead → three surface tabs → compact About → one
 * grouped roster ledger. The complete existing editors stay behind About's
 * disclosure, so moving the roster does not discard setup or lifecycle work.
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
    /** The packing list's grouping; anything unrecognised reads as by-item. */
    group?: string;
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
      group,
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
  const [overview, guests, shopBoats, shopLenses, mayDiscount, mayWriteOffPayment] =
    await Promise.all([
      getTripOverview(db, shop, tripId, session.user.personId),
      getTripGuests(db, shop, tripId, { diverQuery: diverq, confirmName }),
      // The fleet, for the Details form's hull select. Live hulls only: this is
      // a picker for what the departure will sail on, not a record of what it
      // did (`listBoatsForHistory` is the other one).
      shop.hasBoatDiving ? listBoats(db, shop.id) : [],
      // The shop's own words for its kinds of day, for the select beside the
      // hull (ADR 20260904-reef-all-the-way-down, decision 2).
      listTripLenses(db, shop.id),
      canPersonManagePaymentSettings(db, shop.id, session.user.personId),
      canPersonRefund(db, shop.id, session.user.personId),
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
    crew,
  } = overview;
  const { crewIds, tripRoleByPerson, crewGap, ratioGap, languageGap, onShiftIds, clashes } = crew;
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
  const tripNotice = resolveTripNotice({ notice, count, form, gate, tripId, locale });
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
                href: "#crew",
                tone: "danger" as const,
              },
            ]
          : []),
        ...(crewGap.code === "over_ratio"
          ? [
              {
                text: t("trips.pulse.overRatio"),
                href: "#crew",
                tone: "danger" as const,
              },
            ]
          : []),
        ...(pulse.prepGaps > 0
          ? [
              {
                text: t("trips.pulse.prepGaps", { count: pulse.prepGaps }),
                // An anchor, like every other fact on this strip. It pointed
                // at `/prep` back when that was a tab; now the list is further
                // down this very page, and navigating off it to a second copy
                // of what the reader is already looking at is a round trip to
                // nowhere (dive-domain review 20260920).
                href: `#${PREP_SECTION_ID}`,
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
  const tideLines = tideWindows.map((entry) => ({
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
  ]);
  const rosterForms = new Set(["roster", "add-diver", "last-minute-deal"]);
  const rootPageNotice =
    tripNotice && !aboutForms.has(tripNotice.form) && !rosterForms.has(tripNotice.form)
      ? tripNotice
      : undefined;
  const rosterPageNotice = tripNotice && tripNotice.form === "roster" ? tripNotice : undefined;
  const aboutOpen = Boolean(tripNotice && aboutForms.has(tripNotice.form));

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
  // The fleet's row for this departure's boat: its name for the about line,
  // and its colour for the hull above the roster (ADR 20260919-one-idea,
  // decision I · Tide). A shore dive or a pool session finds nothing here and
  // gets no hull, which is correct — it has a roster and no boat.
  const boat = shopBoats.find((row) => row.id === trip.boatId);
  const boatName = boat?.name;
  const boatCrewSummary =
    [boatName, ...assignedCrew].filter(Boolean).join(" · ") || t("trips.about.noBoat");

  /**
   * **The voyage, drawn** — ADR 20260919-one-idea, decision I · Tide, slice
   * 23c. The same picture the home carries, zoomed from the whole day down to
   * this one departure: lines off, each dive where the water puts it, the way
   * back, the sun over it and a line for now.
   *
   * It reads the same three functions the home does, so the two pictures can
   * never disagree about where an hour sits, and like every sky in this product
   * it gates nothing.
   */
  // Read once for the whole picture: the sky, the now line and the window all
  // have to agree about what time it is, and two `nowDate()` calls a few
  // statements apart do not.
  const now = nowDate();
  const voyageSky = skyReadingFor({
    at: now,
    timeZone: shop.timezone,
    latitude: shop.latitude,
    longitude: shop.longitude,
  });
  /**
   * **The sun the strip draws is the sun of the day the boat sails**, and that
   * is not the sky the band wears.
   *
   * The band is the sky over the shop *now* — a departure read at 6:58 opens
   * in the dawn the reader is standing in. The strip is the voyage, and its
   * axis is the departure's own hours, so the arc drawn across it has to be
   * that day's or it is a picture of some other day's sun.
   *
   * It was `voyageSky` for both, and the captured pixels are where that shows:
   * `dayStripGeometry` maps the arc's ends through the window, so today's
   * sunrise on an August window lands far off the left edge and the sun
   * vanishes from the strip entirely — the two-day course capture had no arc
   * at all. Same family as the tick bug on this PR's first review: a helper
   * answered for "the day" and the caller meant a different one.
   */
  const departureSky = skyReadingFor({
    at: trip.startsAt,
    timeZone: shop.timezone,
    latitude: shop.latitude,
    longitude: shop.longitude,
  });
  /**
   * **A sun for every day the voyage touches**, not just the day it sails.
   *
   * `departureSky` above answers for `trip.startsAt`, which is the right sky
   * for the band and only the first day of the strip. The seeded two-day
   * course runs 08:00 Wednesday to 16:00 Thursday — 32 hours — and drew one
   * morning, a bare line through the night, and nothing at all over the day
   * the divers surface on (issue #1904).
   *
   * The almanac is asked **once per calendar day in the shop's own zone**,
   * never once per hour and never per instant: `calendarDayNoons` hands back
   * one noon per day the window touches, and noon is the hour no clock change
   * can take away. A single-day voyage yields one entry and the picture does
   * not move.
   */
  const voyageDaylight = calendarDayNoons(
    { from: trip.startsAt, to: trip.endsAt },
    shop.timezone,
  ).map((noon) => {
    const sky = skyReadingFor({
      at: noon,
      timeZone: shop.timezone,
      latitude: shop.latitude,
      longitude: shop.longitude,
    });
    return { sunriseAt: sky.sunriseAt, sunsetAt: sky.sunsetAt };
  });
  /**
   * The walked half of an arc is where the *reader's* clock sits on it, and at
   * most one of the days can hold it — so ask each in turn and take the one
   * that answers. Reading next week's charter walks none of them, and null is
   * how the strip says so. `dayStripGeometry` picks the matching arc by the
   * same test, so the two cannot disagree about which day it is.
   */
  const voyageDaylightProgress =
    voyageDaylight.reduce<number | null>(
      (found, day) => found ?? daylightProgressAt(now, day.sunriseAt, day.sunsetAt),
      null,
    ) ?? null;
  /**
   * Each dive on the hour the boat is actually over the site, not the hour it
   * left the dock. `tideWindowsForDeparture` already lays the shop's own dock-day
   * rhythm over `startsAt` to answer exactly that, and a shop that has not set a
   * rhythm has no honest answer — so it gets the voyage's two ends and no dives,
   * rather than a guess drawn to the minute.
   */
  const voyageDiveMarks = (tideWindows ?? []).map((entry) => ({
    id: `dive-${entry.diveNumber}`,
    at: entry.arrival,
    name: entry.siteName,
  }));
  const voyageMarks = [trip.startsAt, ...voyageDiveMarks.map((mark) => mark.at), trip.endsAt];
  // The window is the voyage's own content — `dayStripWindow` pads it and holds
  // a floor, so a 90-minute pool session still gets a readable strip instead of
  // a wire, and a day-long charter is not padded past its own day.
  const voyageWindow = dayStripWindow({
    dayFrom: trip.startsAt,
    dayTo: trip.endsAt,
    now,
    sunriseAt: departureSky.sunriseAt,
    sunsetAt: departureSky.sunsetAt,
    marks: voyageMarks,
  });
  const voyageTicks = dayStripTicks({
    ...voyageWindow,
    hours: dayHourBoundaries(voyageWindow, shop.timezone),
    count: 4,
  });
  /**
   * The boat, its crew, how full it is, which day it is and what a seat costs —
   * joined the way `boatCrewSummary` above joins its own parts.
   *
   * **The price is here because nothing else on this page says it.** Retiring
   * the capacity ring from the header was deliberate (the count is in words
   * beside it), but the price rode the same component, and the only other place
   * it appears on this page is as an editable field behind About's disclosure.
   * A staffer quoting a walk-in should not have to open an editor to read it.
   */
  const voyageLine = [
    t("trips.voyage.line", {
      boat: boatCrewSummary,
      booked: trip.booked,
      capacity: trip.capacity,
    }),
    formatShortDate(trip.startsAt, locale, shop.timezone),
    trip.priceCents === null
      ? null
      : `${formatMoneyCents(trip.priceCents, toShopCurrency(shop.currency), locale)} ${t("trips.about.perSeat")}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const voyageStrip: DayStripProps = {
    geometry: dayStripGeometry({
      from: voyageWindow.from,
      to: voyageWindow.to,
      now,
      daylight: voyageDaylight,
      daylightProgress: voyageDaylightProgress,
      marks: [
        { id: "off", at: trip.startsAt },
        ...voyageDiveMarks.map(({ id, at }) => ({ id, at })),
        { id: "back", at: trip.endsAt },
      ],
      ticks: voyageTicks,
    }),
    label: t("trips.voyage.stripLabel", { title: trip.title }),
    /**
     * **Lines off carries a dot and no word.** Its time is the largest thing on
     * the page, three centimetres above the strip — a label repeating it is the
     * same fact twice, and on a short voyage it crowds the first dive's site
     * name off the left edge as well.
     */
    markLabels: {
      back: formatTime(trip.endsAt, locale, shop.timezone),
      ...Object.fromEntries(voyageDiveMarks.map(({ id, name }) => [id, name])),
    },
    // The hour alone under a tick — "6 AM", never "6:00 AM"; the minute on a
    // tick is a digit nobody reads, and four full times touch at 390.
    tickLabels: voyageTicks.map((at) =>
      formatHourShort(wallTimeOf(at, shop.timezone).hour, locale),
    ),
    nowLabel: formatTime(now, locale, shop.timezone),
  };
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
  const aboutSummary = [planSummary, boatCrewSummary, series ? repeatsSummary : null]
    .filter(Boolean)
    .join(" · ");
  // The clash is a fact about two boats that will both sail, so a called-off
  // departure drops it with the rest of the live-trip nudges — `crewClashes`
  // answers nothing for one anyway, and this keeps the two from ever
  // disagreeing on screen.
  const liveClashes = cancelled ? [] : clashes;
  // The crew row opens itself whenever there is crew work to do — nobody
  // assigned, a standing clash, a course without its instructor, a shortfall
  // against the shop's own target, or a language nobody aboard speaks. A
  // settled crew collapses to the one line that names them (principles.md §9).
  const crewRowOpen =
    Boolean(noticeForForm(tripNotice, "crew")) ||
    crewIds.length === 0 ||
    liveClashes.length > 0 ||
    (!cancelled &&
      (crewGap.code !== "none" || underTargetNote !== null || languageGapNote !== null));
  // **The weight lands where somebody sees it** (issue #1695, dive-domain-expert
  // review 2026-09-12). `CrewSection`'s per-person sentence is two layers deep:
  // inside the Crew panel, inside an About disclosure that is closed on every
  // ordinary visit — and nothing inside a closed `<details>` is in the
  // accessibility tree, so the line announced to nobody and was read by nobody.
  // The one line a staffer *does* read at rest is this summary strip, which
  // carries `boatCrewSummary` and carried no mark at all.
  //
  // So the strip takes one word in the warning ink and the naming sentences
  // stay inside, which is the relationship `MinimumSeatsBand` already has to
  // the Details panel that sets the minimum. It **leads** the strip rather than
  // trailing it because the strip is a single `truncate`d line: appended, the
  // mark is the first thing a narrow screen throws away.
  const aboutSummaryText = aboutSummary || t("trips.about.noneSet");
  const aboutSummaryNode =
    liveClashes.length > 0 ? (
      <>
        <span className="font-semibold text-warning-strong">{t("trips.about.crewClash")}</span>
        {` · ${aboutSummaryText}`}
      </>
    ) : (
      aboutSummaryText
    );
  const rosterActions = {
    addBookingAction: seatNewDiverAction.bind(null, "trip-guests", shopSlug),
    addExistingDiverAction: seatExistingDiverAction.bind(null, "trip-guests", shopSlug),
    addToWaitlistAction: addToWaitlistAction.bind(null, shopSlug, tripId),
    createDirectTripInvitationAction: createDirectTripInvitationAction.bind(null, shopSlug, tripId),
    markWaiverInPersonAction: markWaiverInPersonAction.bind(null, shopSlug, tripId),
    markPaymentAction: markPaymentAction.bind(null, shopSlug, tripId),
    removeBookingAction: removeBookingAction.bind(null, shopSlug, tripId),
    confirmDiverIdentityAction: confirmDiverIdentityAction.bind(null, shopSlug, tripId),
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
      {/* **The departure is an hour** (ADR 20260919-one-idea, decision I ·
          Tide, slice 23c). The hour the boat leaves is the page's one name,
          over the sky at the hour it is being read, with the voyage drawn
          beneath it. The capacity ring retires here: "9 of 12" is in the line
          under the title, in words, and a ring saying it again beside it was
          the same fact twice.

          Trip only, for now. `TripPageHeader` still dresses Manifest and Prep,
          and the sky reaching them belongs with the slice that makes the three
          one page — which touches the roll call, so it gets its own
          `dive-domain-expert` review rather than riding along with this one. */}
      <VoyageHeader
        scheme={voyageSky.scheme}
        back={
          <EyebrowBackLink onSky href={shopPath(shopSlug, "schedule", "board")}>
            {t(STAFF_DESTINATION_LABEL_KEYS.board)}
          </EyebrowBackLink>
        }
        hour={formatTime(trip.startsAt, locale, shop.timezone)}
        title={trip.title}
        line={voyageLine}
        strip={voyageStrip}
        badge={
          cancelled ? (
            <TripCapacityBadge
              trip={trip}
              cancelledLabel={t("trips.detail.cancelledBadge")}
              t={t}
            />
          ) : undefined
        }
        action={
          <>
            {/* **The departure's one way to the roll call, on every departure
                there is.** The tab strip is gone (ADR 20260919-one-idea, slice
                23c) and the manifest is the one surface that could not fold in
                with Prep — it is a `?checkpoint=` URL contract with external
                deep-links, a service worker and an encrypted offline store
                hanging off it. So it stands here, in the band, where a crew on
                a dock reaches it in one tap rather than by scrolling to find
                it.

                **Not gated on `cancelled`**, unlike the hull below it and the
                Add diver beside it. Those two are predictions — a boat that is
                not going and a seat nobody should sell — and a roll call is
                evidence. A blow-out cancels the *trip* and leaves every
                booking active (the glossary's *Blow-out*), so the call that
                comes at 06:40 with six people already tapped aboard is exactly
                when a crew needs the roll call most, to put them back ashore
                and close the count. `pulseNeeded` is false on a cancellation
                too, so gating this left the page with no door to any other
                surface at all (dive-domain review 20260920).

                And not on the hull: a shore dive has a roll call and no
                boat. */}
            <TripSurfaceLink
              onSky
              icon="checkIn"
              href={shopPath(shopSlug, "trips", tripId, "manifest")}
              label={t("trips.surfaces.manifest")}
            />
            {cancelled ? null : (
              <TripAddDiverLink
                onSky
                href="#add-diver"
                label={t("trips.addDiver.addDiver")}
                compactLabel={t("trips.about.add")}
                ariaLabel={t("trips.about.addDiverJump")}
              />
            )}
          </>
        }
      />

      <TripNoticeBanner notice={rootPageNotice} locale={locale} />

      {cancelled && (canConfigure || blowoutCalled || lifecycleStatus) ? (
        // A card in a tone: the card's radius, bed and inset, so its words
        // start where the cards around it do; only the border and fill are its
        // own (pixel-craft classes 3 and 12).
        <section className={`mt-6 ${TONE_PANEL_CLASS} border-danger/40 bg-danger/10`}>
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

      <TripAboutSection
        heading={t("trips.about.heading")}
        detailsLabel={t("trips.about.details")}
        closeLabel={t("trips.about.close")}
        summary={aboutSummaryNode}
        conditionsSummary={conditionsSummary}
        open={aboutOpen}
        openOnHash={ABOUT_ROW_HASHES}
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
            editorOpen: Boolean(requirementsStatus) || requirement === null || Boolean(trip.course),
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
          {
            id: "about-crew",
            label: t("trips.about.boatAndCrew"),
            value: boatCrewSummary,
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
                // Marked on the About summary strip as well
                // (`aboutSummaryNode` above), because this row is inside a
                // disclosure that is closed on an ordinary visit.
                clashes={liveClashes}
                crewGapCode={cancelled ? "none" : crewGap.code}
                updateCrewAction={updateTripCrewAction.bind(null, shopSlug)}
                copy={{
                  heading: t("trips.crew.heading"),
                  courseNeedsInstructor: t("trips.crew.courseNeedsInstructor"),
                  overRatioWarning,
                  underTargetNote: cancelled ? null : underTargetNote,
                  languageGapNote: cancelled ? null : languageGapNote,
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
                  manageShifts: t("trips.crew.manageShifts"),
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
                  cadenceAction={updateSeriesCadenceAction.bind(null, shopSlug, tripId, series.id)}
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
        moreLabel={t("trips.about.more")}
        moreOpen={Boolean(lifecycleStatus)}
        more={
          cancelled ? undefined : (
            <>
              <FormStatus tone={lifecycleStatus?.tone} className="mb-2">
                {lifecycleStatus?.text}
              </FormStatus>
              {canConfigure && series ? (
                <SeriesMoreActions
                  futureScheduledCount={series.futureScheduledCount}
                  endsOn={series.endsOn}
                  applyAction={applySeriesDetailsAction.bind(null, shopSlug, tripId, series.id)}
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
            </>
          )
        }
      />

      {pulseNeeded ? (
        <MinimumSeatsBand
          trip={trip}
          booked={trip.booked}
          locale={locale}
          timeZone={shop.timezone}
          t={t}
        />
      ) : null}

      {pulseFacts.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
          {pulseFacts.map((fact) => (
            <Link
              key={fact.href}
              href={fact.href}
              className={`inline-flex min-h-11 items-center text-sm font-medium hover:underline ${
                fact.tone === "danger" ? "text-danger" : "text-primary"
              }`}
            >
              {fact.text}
            </Link>
          ))}
        </div>
      ) : null}

      <TripRosterContent
        guests={guests}
        hull={boat ? { name: boat.name, color: boat.hullColor, crew: assignedCrew } : null}
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
        keepOpenBookingId={
          notice === "contact-saved" || notice === "contact-incomplete" || notice === "payment"
            ? bid
            : undefined
        }
        // The one paper-release refusal with a way through (issue #1573),
        // scoped to the seat the action named so a roster of minors does not
        // all sprout the staffer's confirmation.
        namesakeRefusedBookingId={notice === "waiver-guardian-name" ? bid : undefined}
        mayDiscount={mayDiscount}
        mayWriteOffPayment={mayWriteOffPayment}
        compact
        actions={rosterActions}
        // **Who is aboard, then what to pull for them.** The packing list is
        // derived from the roster directly above it, so it reads as that
        // list's consequence rather than a fourth tab (ADR 20260919-one-idea,
        // slice 23c). It waits behind its own boundary because its six gear
        // reads are nobody else's to wait on.
        afterRoster={
          // **The anchor is outside the boundary, not inside it.** Five links
          // land on `#packing-list` — the day's two prep rows, this page's own
          // pulse fact, the rental slip's way back and the returning-diver
          // demo story.
          //
          // Measured both ways on a cold navigation straight to the hash, and
          // they scroll identically: Next resolves a hash target that arrives
          // with the stream. So this is not a fix for a broken jump. It is
          // there so the *skeleton* holds the anchor's position while the six
          // gear queries run — the id on a wrapper that always renders means
          // the scroll lands once, rather than landing late and moving when
          // the section replaces a fallback that was not the target.
          //
          // **And it takes no room when the list has nothing to say.** On a
          // departure nobody is booked on, the list renders no node at all
          // (the roster above already says the boat is empty), and the pixel
          // probe measured this wrapper 0px tall still holding its `mt-10`
          // open: 40px where its siblings sit 20px apart.
          // `empty:hidden` removes it then and only then. Suspense's markers
          // are comments, which `:empty` ignores, and the skeleton or a
          // read-failure banner inside it is a child, which it does not.
          <div id={PREP_SECTION_ID} className="mt-10 scroll-mt-6 empty:hidden">
            <Suspense fallback={<PrepBodySkeleton />}>
              <TripPrepSection
                shop={shop}
                tripId={tripId}
                cancelled={cancelled}
                locale={locale}
                notice={notice}
                grouping={isPrepGrouping(group) ? group : "item"}
              />
            </Suspense>
          </div>
        }
      />
    </>
  );
}
