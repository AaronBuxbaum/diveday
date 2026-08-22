import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { EmptyState } from "@/components/EmptyState";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { canPersonConfigureTrips } from "@/db/authz";
import { listBoats, listBoatsForHistory } from "@/db/boats";
import { listDateRequestsByIds } from "@/db/course-inquiries";
import { listActiveCourses } from "@/db/courses";
import { listDiveSites } from "@/db/dive-sites";
import { canPersonViewShopReports } from "@/db/reporting";
import { openAfterDiveRollCalls } from "@/db/today";
import {
  pagedUpcomingTripsWithCounts,
  tripCrewByTrip,
  tripScheduleDayCounts,
  upcomingScheduleRange,
} from "@/db/trips";
import { CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { requestTranslator } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { maxConcurrentTrips, overlappingBoatIds } from "@/lib/boats";
import { nowDate } from "@/lib/clock";
import {
  formatDayParts,
  formatMoneyCents,
  formatShortDate,
  formatTimeRange,
  weekdayNames,
} from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import { currencyFractionDigits, maxPriceMajor, toShopCurrency } from "@/lib/money";
import { publicSchedulePath } from "@/lib/public-routes";
import { adviseRequests, departureShapeFor } from "@/lib/request-advisor";
import {
  decodeCursorStack,
  encodeCursorStack,
  popCursor,
  pushCursor,
} from "@/lib/schedule-pagination";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam, noticeRole } from "@/lib/staff-notices";
import { MAX_TRIP_DAYS, MIN_TRIP_DAYS } from "@/lib/trip-days";
import { uuidParam } from "@/lib/uuid";
import { toDateInputValue, toTimeInputValue, utcToWallTime } from "@/lib/zoned";
import {
  type BuilderCopy,
  type BuilderDay,
  type BuilderInitialCourse,
  type BuilderInitialSite,
  type BuilderMoreOptions,
  type BuilderPriceInput,
  type BuilderRequestPlan,
  ScheduleBuilder,
} from "./_components/ScheduleBuilder";
import {
  addDepartureAction,
  duplicateDepartureAction,
  loadBuilderOptionsAction,
  moveDepartureAction,
  removeDepartureAction,
} from "./actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately. Not a claim of a static shell: the staff shell layout declares
// `instant = false` (read its comment for why), so a cold direct visit still
// blocks on the session and shop row. What this validates is the navigation
// staff make all day — arriving from another `/shop` page, where the shell
// is already mounted. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Board — DiveDay",
  // Staff-only operations surface, never a public document.
  robots: { index: false, follow: false },
};

/**
 * What the board says after a builder action, keyed by the `outcome.reason`
 * code the mutation returns (see `moveTrip`/`duplicateTrip`/`deleteTrip` in
 * src/db/trips.ts). Every outcome gets a sentence — including the refusals,
 * which are the interesting ones: a departure that won't move or won't delete
 * is protecting a roster or a head count, and the staff member needs to know
 * which, not just that nothing happened. The message itself is a lookup into
 * the staff bundle, never English baked into this map (docs `i18n-copy` skill).
 */
const BUILDER_NOTICE_KEYS: Record<
  string,
  { tone: "success" | "danger" | "warning"; key: StaffMessageKey }
> = {
  added: { tone: "success", key: "schedule.notices.added" },
  moved: { tone: "success", key: "schedule.notices.moved" },
  copied: { tone: "success", key: "schedule.notices.copied" },
  removed: { tone: "success", key: "schedule.notices.removed" },
  invalid: { tone: "danger", key: "schedule.notices.invalid" },
  "end-before-start": { tone: "danger", key: "schedule.notices.endBeforeStart" },
  "not-authorized": { tone: "danger", key: "schedule.notices.notAuthorized" },
  "not-found": { tone: "danger", key: "schedule.notices.notFound" },
  "not-scheduled": { tone: "warning", key: "schedule.notices.notScheduled" },
  "already-sailed": { tone: "warning", key: "schedule.notices.alreadySailed" },
  "has-roster": { tone: "warning", key: "schedule.notices.hasRoster" },
  "capacity-above-boat": { tone: "danger", key: "schedule.notices.capacityAboveBoat" },
};

/**
 * The staff operations board — KPI tiles and the add/move/copy/remove
 * departure builder. Split out of the old `/schedule` (Lens 17,
 * docs/product/features/story-backlog.md): that route rendered this staff content
 * *or* the public schedule depending on session, which meant a signed-out
 * diver and a signed-in owner could never both point at the same URL and
 * mean the same thing. `/schedule` is now the public, canonical page this
 * board's own "View public page" link previews.
 */
export default async function ScheduleBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{
    after?: string;
    /** The stack of every earlier page's cursor, oldest first — see
     * src/lib/schedule-pagination.ts. */
    back?: string;
    builder?: string;
    /** The departure just created, named so the notice can say which. */
    created?: string;
    /** Gear assignments a move had to release — see `moveTrip`. */
    gear?: string;
    /** How many dates a repeating submission put up. */
    series?: string;
    /** Arrive with the add panel open: `1` quick, `full` already expanded. */
    add?: string;
    /** Pre-dates the add panel — the day a link meant, e.g. "another Saturday". */
    date?: string;
    /** Opens the add panel pointed at a course (the catalogue's own control). */
    course?: string;
    /** Comma-separated request ids carried from the Requests planning link. */
    requests?: string;
    /** Opens the add panel pointed at a dive site (the library's own control). */
    site?: string;
  }>;
}) {
  await connection(); // schedule is live data — render per request, not at build
  const { shopSlug } = await params;
  const { after, back, builder, created, gear, series, add, date, course, requests, site } =
    await searchParams;
  const requestIds = [
    ...new Set(
      (requests ?? "")
        .split(",")
        .map((value) => uuidParam(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const { session, db, shop } = await requireShopSurface(shopSlug);

  const tz = shop.timezone;
  // Some of this staff page's copy (the header eyebrow/title/description,
  // the empty-board line) has always lived in the diver bundle rather than
  // the staff one — pre-existing, unrelated to this split, left as-is.
  const { locale, t } = await requestTranslator(shop.defaultLocale);
  const st = staffTranslator(locale);
  const now = nowDate();

  // The board works off one keyset page of departures, same as the public
  // list — a shop with hundreds of upcoming departures still loads one page,
  // not the whole future.
  // The add panel's course and dive-site options are deliberately *not* here:
  // they are two queries and a whole catalogue of client props for two selects
  // inside a panel that is closed by default, so they load when it opens
  // (`loadBuilderOptionsAction`).
  const [
    range,
    { trips: upcoming, nextCursor },
    canConfigure,
    canViewReports,
    openRollCalls,
    shopBoats,
  ] = await Promise.all([
    upcomingScheduleRange(db, shop.id, now),
    pagedUpcomingTripsWithCounts(db, shop.id, { cursor: after, now }),
    canPersonConfigureTrips(db, shop.id, session.user.personId),
    canPersonViewShopReports(db, shop.id, session.user.personId),
    // Departures that already came back with a head count still open (DOM-H3).
    // `pagedUpcomingTripsWithCounts` cannot reach them — it only returns trips
    // whose `startsAt` is still ahead of `now` — so this is its own backwards
    // query, and one batched query for every such boat rather than a per-trip
    // roll-call lookup. Only on the first page: they belong at the front of
    // the board, not repeated on top of every later cursor page.
    after ? [] : openAfterDiveRollCalls(db, shop.id, now),
    listBoats(db, shop.id),
  ]);
  // **Names come from every hull the shop has ever had, not just the live
  // ones.** A departure that sailed on a boat the shop has since deleted must
  // still say which vessel — that is the whole reason deleting one is a stamp
  // rather than a delete (ADR 20260820-every-delete-is-soft). `shopBoats` above
  // stays live: it is the picker and the fleet count, and a deleted hull is not
  // a boat this shop has.
  const boatMap = new Map(
    (await listBoatsForHistory(db, shop.id)).map((boat) => [boat.id, boat.name]),
  );
  const hasUpcoming = range.first !== null;
  // Depends on the trip ids above, so it runs as a second wave rather than
  // inside the batch that produces `upcoming`.
  const boardTripIds = [...openRollCalls.map((open) => open.tripId), ...upcoming.map((t) => t.id)];
  const [dayCounts, crewByTrip] = await Promise.all([
    tripScheduleDayCounts(db, boardTripIds),
    tripCrewByTrip(db, shop.id, boardTripIds),
  ]);

  // A course the catalogue sent us here to schedule. One list read, and only
  // on the rare navigation that names a course — scoped to the session's own
  // shop, so a `?course=` from another tenant simply resolves to nothing.
  const requestedCourse = course
    ? ((await listActiveCourses(db, shop.id)).find((row) => row.id === course) ?? null)
    : null;

  // A dive site the library sent us here to schedule.
  const requestedSite = site
    ? ((await listDiveSites(db, shop.id)).find((row) => row.id === site) ?? null)
    : null;

  // Request details are contact information. Only the same live report gate
  // that protects /requests may carry them onto the builder, even though the
  // board itself is readable by a wider staff audience.
  const requestRows =
    canViewReports && requestIds.length > 0
      ? await listDateRequestsByIds(db, shop.id, requestIds)
      : [];
  const requestAdvice = adviseRequests(
    requestRows.map((request) => ({
      id: request.id,
      divers: request.divers,
      experienceLevel: request.experienceLevel,
      courseId: request.courseId,
    })),
    departureShapeFor(
      shop,
      shopBoats.map((b) => ({ id: b.id, name: b.name, capacity: b.capacity })),
    ),
  );
  const requestPlan: BuilderRequestPlan | null =
    requestRows.length > 0
      ? {
          estimatedDivers: requestAdvice.estimatedDivers,
          suggestedCapacity: requestAdvice.suggestedCapacity,
          suggestedDivemasters: requestAdvice.suggestedDivemasters,
          diversPerDivemaster: shop.diversPerDivemaster,
          suggestedBoatName: requestAdvice.suggestedBoat?.name ?? null,
          exceedsKnownBoats: requestAdvice.exceedsKnownBoats,
          requests: requestRows.map((request) => ({
            id: request.id,
            name: request.name ?? st("requests.anonymous"),
            subject: request.courseTitle
              ? st("requests.aboutCourse", { course: request.courseTitle })
              : st("requests.aboutDive", { interest: request.interest ?? "" }),
            divers: Math.max(1, request.divers ?? 1),
          })),
        }
      : null;

  const builderNoticeEntry = noticeFromParam(builder, BUILDER_NOTICE_KEYS);
  // The named form whenever the action passed a title back; the anonymous
  // "It's on the board" survives for a URL that carries none.
  const seriesCount = series ? Number.parseInt(series, 10) : 0;
  // A move that could not carry its gear onto the new dates reports what it let
  // go of, and in a warning tone rather than the plain success one: the schedule
  // edit worked, and somebody now has kit to reassign on the prep page.
  const gearReleased = gear ? Number.parseInt(gear, 10) : 0;
  const movedWithGear = builderNoticeEntry?.key === "schedule.notices.moved" && gearReleased > 0;
  const builderNotice = builderNoticeEntry
    ? {
        tone: movedWithGear ? ("warning" as const) : builderNoticeEntry.tone,
        message: movedWithGear
          ? st("schedule.notices.movedGearReleased", { count: gearReleased })
          : builderNoticeEntry.key === "schedule.notices.added" && created
            ? seriesCount > 1
              ? st("schedule.notices.addedSeries", { title: created, count: seriesCount })
              : st("schedule.notices.addedNamed", { title: created })
            : st(builderNoticeEntry.key),
      }
    : undefined;
  const builderCopy: BuilderCopy = {
    ariaLabel: st("schedule.builder.ariaLabel"),
    addDepartureOnDay: st.raw("schedule.builder.addDepartureOnDay"),
    add: st("schedule.builder.add"),
    cancel: st("schedule.builder.cancel"),
    noSiteSetYet: st("schedule.builder.noSiteSetYet"),
    courseLabel: st.raw("schedule.builder.courseLabel"),
    dayCountLabelOne: st.raw("schedule.builder.dayCountLabelOne"),
    dayCountLabelOther: st.raw("schedule.builder.dayCountLabelOther"),
    crewLabel: st("schedule.builder.crewLabel"),
    crewNobodyYet: st("schedule.builder.crewNobodyYet"),
    noPriceSet: st("schedule.builder.noPriceSet"),
    noPriceSetAria: st.raw("schedule.builder.noPriceSetAria"),
    noPriceSetAll: st("schedule.builder.noPriceSetAll"),
    rollCallOpen: st.raw("schedule.builder.rollCallOpen"),
    rollCallOpenAria: st.raw("schedule.builder.rollCallOpenAria"),
    rollCallOpenNote: st.raw("schedule.builder.rollCallOpenNote"),
    rowActionsAria: st.raw("schedule.builder.rowActionsAria"),
    move: st("schedule.builder.move"),
    moveAria: st.raw("schedule.builder.moveAria"),
    copy: st("schedule.builder.copy"),
    copyAria: st.raw("schedule.builder.copyAria"),
    remove: st("schedule.builder.remove"),
    removeAria: st.raw("schedule.builder.removeAria"),
    removeConfirm: st.raw("schedule.builder.removeConfirm"),
    removeConfirmButton: st("schedule.builder.removeConfirmButton"),
    removeCancel: st("schedule.builder.removeCancel"),
    removePending: st("schedule.builder.removePending"),
    whatIsIt: st("schedule.builder.whatIsIt"),
    titlePlaceholder: st("schedule.builder.titlePlaceholder"),
    date: st("schedule.builder.date"),
    departs: st("schedule.builder.departs"),
    returns: st("schedule.builder.returns"),
    seats: st("schedule.builder.seats"),
    dives: st("schedule.builder.dives"),
    price: st("schedule.builder.price"),
    priceDescription: st("schedule.builder.priceDescription"),
    course: st("schedule.builder.course"),
    optional: st("schedule.builder.optional"),
    courseAgencyLabels: {
      padi: st("schedule.builder.courseAgencies.padi"),
      ssi: st("schedule.builder.courseAgencies.ssi"),
      other: st("schedule.builder.courseAgencies.other"),
    },
    diveSite: st("schedule.builder.diveSite"),
    ordinaryTrip: st("schedule.builder.ordinaryTrip"),
    decideLater: st("schedule.builder.decideLater"),
    optionsLoading: st("schedule.builder.optionsLoading"),
    adding: st("schedule.builder.adding"),
    putOnBoard: st("schedule.builder.putOnBoard"),
    newDate: st("schedule.builder.newDate"),
    multiDayNote: st.raw("schedule.builder.multiDayNote"),
    newDepartureTime: st("schedule.builder.newDepartureTime"),
    moving: st("schedule.builder.moving"),
    moveIt: st("schedule.builder.moveIt"),
    copyTo: st("schedule.builder.copyTo"),
    copyDescription: st("schedule.builder.copyDescription"),
    departureTime: st("schedule.builder.departureTime"),
    copying: st("schedule.builder.copying"),
    copyIt: st("schedule.builder.copyIt"),
    viewOnlyNotice: st("schedule.builder.viewOnlyNotice"),
    moreOptions: st("schedule.builder.moreOptions"),
    fewerOptions: st("schedule.builder.fewerOptions"),
    moreOptionsDescription: st("schedule.builder.moreOptionsDescription"),
    titlePlaceholderCourse: st.raw("schedule.builder.titlePlaceholderCourse"),
    courseNote: st.raw("schedule.builder.courseNote"),
    courseCertRequired: st.raw("schedule.builder.courseCertRequired"),
    courseNoCardRequired: st("schedule.builder.courseNoCardRequired"),
    descriptionLabel: st("schedule.builder.descriptionLabel"),
    descriptionPlaceholder: st("schedule.builder.descriptionPlaceholder"),
    isPrivateLabel: st("schedule.builder.isPrivateLabel"),
    isPrivateHint: st("schedule.builder.isPrivateHint"),
    daysLabel: st("schedule.builder.daysLabel"),
    daysDescription: st("schedule.builder.daysDescription"),
    payAtBookingLegend: st("schedule.builder.payAtBookingLegend"),
    payAtBookingDescription: st("schedule.builder.payAtBookingDescription"),
    depositLabel: st("schedule.builder.depositLabel"),
    depositDescription: st("schedule.builder.depositDescription"),
    depositTitle: st("schedule.builder.depositTitle"),
    cancellationWindowLabel: st("schedule.builder.cancellationWindowLabel"),
    cancellationWindowDescription: st("schedule.builder.cancellationWindowDescription"),
    hoursSuffix: st("schedule.builder.hoursSuffix"),
    minimumBookingsLabel: st("schedule.builder.minimumBookingsLabel"),
    minimumBookingsDescription: st("schedule.builder.minimumBookingsDescription"),
    minimumDecisionLabel: st("schedule.builder.minimumDecisionLabel"),
    minimumDecisionDescription: st("schedule.builder.minimumDecisionDescription"),
    diversSuffix: st("schedule.builder.diversSuffix"),
    hoursBeforeSuffix: st("schedule.builder.hoursBeforeSuffix"),
    repeatLegend: st("schedule.builder.repeatLegend"),
    repeatDescription: st("schedule.builder.repeatDescription"),
    howOftenLabel: st("schedule.builder.howOftenLabel"),
    doesntRepeat: st("schedule.builder.doesntRepeat"),
    everyWeek: st("schedule.builder.everyWeek"),
    every2Weeks: st("schedule.builder.every2Weeks"),
    every4Weeks: st("schedule.builder.every4Weeks"),
    repeatsOnLabel: st("schedule.builder.repeatsOnLabel"),
    everyDay: st("schedule.builder.everyDay"),
    endsLabel: st("schedule.builder.endsLabel"),
    endsNever: st("schedule.builder.endsNever"),
    endsOnChoice: st("schedule.builder.endsOnChoice"),
    endsOnLabel: st("schedule.builder.endsOnLabel"),
    requestPlanHeading: st("schedule.builder.requestPlanHeading"),
    requestPlanDescription: st("schedule.builder.requestPlanDescription"),
    requestPlanRecommendation: st.raw("schedule.builder.requestPlanRecommendation"),
    requestPlanRecommendationDiversOne: st.raw(
      "schedule.builder.requestPlanRecommendationDiversOne",
    ),
    requestPlanRecommendationDiversOther: st.raw(
      "schedule.builder.requestPlanRecommendationDiversOther",
    ),
    requestPlanRecommendationCapacityOne: st.raw(
      "schedule.builder.requestPlanRecommendationCapacityOne",
    ),
    requestPlanRecommendationCapacityOther: st.raw(
      "schedule.builder.requestPlanRecommendationCapacityOther",
    ),
    requestPlanDiversOne: st.raw("schedule.builder.requestPlanDiversOne"),
    requestPlanDiversOther: st.raw("schedule.builder.requestPlanDiversOther"),
    requestPlanPersonOne: st.raw("schedule.builder.requestPlanPersonOne"),
    requestPlanPersonOther: st.raw("schedule.builder.requestPlanPersonOther"),
    requestPlanBoatRecommendationOne: st.raw("boats.requestPlanBoatRecommendationOne"),
    requestPlanBoatRecommendationOther: st.raw("boats.requestPlanBoatRecommendationOther"),
    requestPlanBoatExceeded: st("boats.requestPlanBoatExceeded"),
    requestPlanCrewSuggestionOne: st.raw("boats.requestPlanCrewSuggestionOne"),
    requestPlanCrewSuggestionOther: st.raw("boats.requestPlanCrewSuggestionOther"),
    diveModeLabel: st("boats.diveModeLabel"),
    modeBoat: st("boats.modeBoat"),
    modeShore: st("boats.modeShore"),
    modePool: st("boats.modePool"),
    boatSelectLabel: st("boats.boatSelectLabel"),
    unassignedBoat: st("boats.unassignedBoat"),
  };

  // The rare half of the add panel: bounds the domain owns, and the per-dive
  // cards' shared words. Resolved here because a Client Component can neither
  // translate itself nor import the domain's limits at render time.
  const builderMore: BuilderMoreOptions = {
    weekdayNames: weekdayNames(locale),
    minDays: MIN_TRIP_DAYS,
    maxDays: MAX_TRIP_DAYS,
    diveFields: {
      heading: st("shared.tripDiveFields.heading"),
      description: st.raw("shared.tripDiveFields.description"),
      twoTankTrip: st("shared.tripDiveFields.twoTankTrip"),
      diveCountTripOne: st.raw("shared.tripDiveFields.diveCountTripOne"),
      diveCountTripOther: st.raw("shared.tripDiveFields.diveCountTripOther"),
      numberOfDivesLabel: st("shared.tripDiveFields.numberOfDivesLabel"),
      diveOptionOne: st.raw("shared.tripDiveFields.diveOptionOne"),
      diveOptionOther: st.raw("shared.tripDiveFields.diveOptionOther"),
      diveLegend: st.raw("shared.tripDiveFields.diveLegend"),
      nameLabel: st("shared.tripDiveFields.nameLabel"),
      optionalHint: st("shared.tripDiveFields.optionalHint"),
      namePlaceholderFirst: st("shared.tripDiveFields.namePlaceholderFirst"),
      namePlaceholderOther: st("shared.tripDiveFields.namePlaceholderOther"),
      diveSiteLabel: st("shared.tripDiveFields.diveSiteLabel"),
      noSiteChosen: st("shared.tripDiveFields.noSiteChosen"),
      travelLabelFirst: st("shared.tripDiveFields.travelLabelFirst"),
      travelLabelOther: st("shared.tripDiveFields.travelLabelOther"),
      travelHint: st("shared.tripDiveFields.travelHint"),
      diverFacingDetailsLabel: st("shared.tripDiveFields.diverFacingDetailsLabel"),
      footerNote: st("shared.tripDiveFields.footerNote"),
    },
  };

  // `?course=` always implies an open panel: it would otherwise land on a board
  // that silently swallowed the course the link named.
  const addPanelState =
    add === "full" ? "expanded" : add || requestedCourse || requestedSite ? "quick" : "closed";

  const initialCourse: BuilderInitialCourse | null = requestedCourse
    ? {
        id: requestedCourse.id,
        title: requestedCourse.title,
        requirement: requestedCourse.minimumCertificationLevel
          ? st("schedule.builder.courseCertRequired", {
              level: st(CERTIFICATION_LEVEL_KEYS[requestedCourse.minimumCertificationLevel]),
            })
          : st("schedule.builder.courseNoCardRequired"),
      }
    : null;

  const initialSite: BuilderInitialSite | null = requestedSite
    ? {
        id: requestedSite.id,
        name: requestedSite.name,
      }
    : null;

  // The price box follows the shop's currency, same as the full trip form:
  // whole-number entry and a symbol-only placeholder for a zero-decimal
  // currency, where "$0.00" would be wrong twice over.
  const currency = toShopCurrency(shop.currency);
  const fractionDigits = currencyFractionDigits(currency);
  const priceInput: BuilderPriceInput = {
    step: fractionDigits === 0 ? "1" : `0.${"0".repeat(fractionDigits - 1)}1`,
    max: maxPriceMajor(currency),
    placeholder: formatMoneyCents(0, currency, locale),
  };

  const todayIso = toDateInputValue(utcToWallTime(now, tz));
  const builderDays: BuilderDay[] = [];
  /** Appends one departure to the board, opening a new day header when the day turns. */
  function pushBuilderTrip(
    trip: {
      id: string;
      title: string;
      startsAt: Date;
      endsAt: Date;
      capacity: number;
      priceCents: number | null;
      booked: number;
      courseTitle: string | null;
      diveSiteName: string | null;
      diveMode?: "boat" | "shore" | "pool";
      boatId?: string | null;
    },
    rollCallOpen: { diveNumber: number; uncounted: number } | null,
  ) {
    const wall = utcToWallTime(trip.startsAt, tz);
    const dateIso = toDateInputValue(wall);
    let day = builderDays.at(-1);
    if (day?.dateIso !== dateIso) {
      day = {
        dateIso,
        label: formatShortDate(trip.startsAt, locale, tz),
        parts: formatDayParts(trip.startsAt, locale, tz),
        trips: [],
      };
      builderDays.push(day);
    }
    day.trips.push({
      id: trip.id,
      title: trip.title,
      dateIso,
      startTime: toTimeInputValue(wall),
      timeRange: formatTimeRange(trip.startsAt, trip.endsAt, locale, tz),
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      capacity: trip.capacity,
      booked: trip.booked,
      courseTitle: trip.courseTitle,
      diveSiteName: trip.diveSiteName,
      dayCount: dayCounts.get(trip.id) ?? 1,
      crew: (crewByTrip.get(trip.id) ?? []).map((member) => member.name),
      priceCents: trip.priceCents,
      rollCallOpen,
      diveMode: trip.diveMode ?? "boat",
      boatId: trip.boatId ?? null,
      boatName: trip.boatId ? (boatMap.get(trip.boatId) ?? null) : null,
    });
  }

  // Returned-with-an-open-head-count boats lead the board (DOM-H3). They are
  // the only backwards-looking rows here, and they go first because every one
  // of them already ended before `now` — so pushing them ahead of `upcoming`
  // keeps the whole board in one chronological run and lets a boat that
  // sailed this morning share its own day header with the afternoon's.
  for (const open of openRollCalls) {
    pushBuilderTrip(
      {
        id: open.tripId,
        title: open.title,
        startsAt: open.startsAt,
        endsAt: open.endsAt,
        capacity: open.capacity,
        priceCents: open.priceCents,
        booked: open.rosterSize,
        courseTitle: null,
        diveSiteName: null,
        diveMode: "boat",
        boatId: null,
      },
      { diveNumber: open.diveNumber, uncounted: open.uncounted },
    );
  }
  // The soonest day a new departure would sensibly be added to — never a
  // returned boat's day, which is in the past and would pre-date the form.
  const firstUpcomingDateIso = upcoming[0]
    ? toDateInputValue(utcToWallTime(upcoming[0].startsAt, tz))
    : null;
  for (const trip of upcoming) {
    pushBuilderTrip(
      {
        id: trip.id,
        title: trip.title,
        startsAt: trip.startsAt,
        endsAt: trip.endsAt,
        capacity: trip.capacity,
        priceCents: trip.priceCents,
        booked: trip.booked,
        courseTitle: trip.course?.title ?? null,
        diveSiteName: trip.diveSite?.name ?? null,
        diveMode: trip.diveMode,
        boatId: trip.boatId,
      },
      null,
    );
  }

  // "More departures than boats" is only a warning to a shop that runs boats.
  // A shore operation's hull rows are dormant, not a fleet to be outrun.
  if (shop.hasBoatDiving && shopBoats.length > 0) {
    for (const day of builderDays) {
      const boatTrips = day.trips.filter(
        (t): t is typeof t & { startsAt: Date; endsAt: Date } =>
          (t.diveMode ?? "boat") === "boat" &&
          t.startsAt instanceof Date &&
          t.endsAt instanceof Date,
      );
      // **The per-hull question first, because it names the boat.** Counting
      // simultaneous departures against the fleet size cannot see two of them
      // on the *same* vessel: two hulls owned, peak of two, nothing said, one
      // boat in two places. It is also the mistake that takes three departures
      // to show up in a count, which is to say the one a shop is most likely to
      // make by accident.
      const doubled = overlappingBoatIds(boatTrips);
      if (doubled.length > 0) {
        const names = doubled
          .map((boatId) => boatMap.get(boatId))
          .filter((name): name is string => Boolean(name));
        // The name is the actionable part — "Reef Runner is on two departures"
        // tells a shop which card to open; a count does not.
        if (names.length > 0) {
          day.boatWarning = st("boats.doubleBookedWarning", {
            boats: cachedListFormat(locale, { style: "long", type: "conjunction" }).format(names),
          });
        }
      }
      // The fleet-size answer stays: it is the only one available for a
      // departure with no hull assigned, which is most of them.
      const peakConcurrent = maxConcurrentTrips(boatTrips);
      if (!day.boatWarning && peakConcurrent > shopBoats.length) {
        day.boatWarning = st("boats.concurrencyWarning", {
          tripCount: peakConcurrent,
          boatCount: shopBoats.length,
        });
      }
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        // The board's own name, from the staff bundle. It used to borrow the
        // public schedule's heading, so `/s/<slug>` and this page both said
        // "Schedule" while the nav tab called it something else again.
        eyebrow={st("schedule.boardEyebrow")}
        title={st("schedule.boardTitle")}
        actions={
          <>
            <Link
              href={publicSchedulePath(shopSlug)}
              className={buttonClass({ variant: "secondary" })}
            >
              {st("schedule.viewPublicPage")}
            </Link>
            {/* A link to `?add=1`, not a button: the open-the-panel state
                lives in ScheduleBuilder, and this is the server-rendered side
                of that boundary. It joins the header's action cluster instead
                of holding a whole band of its own between header and board —
                the same control the former /trips/new doors 308 into.
                `data-board-add` is how the panel's Cancel hands focus back
                here. Secondary weight: the page's one primary stays "Add a
                booking". */}
            {canConfigure ? (
              <Link
                href={`/shop/${shopSlug}/schedule/board?add=1`}
                data-board-add
                scroll={false}
                className={buttonClass({ variant: "secondary" })}
              >
                <span aria-hidden="true">+</span> {st("schedule.builder.addDeparture")}
              </Link>
            ) : null}
            {/* The board's primary action. Scheduling a departure is the rarer
                job — a shop puts a boat on the board once and then seats
                divers on it all week — and until now "someone just called,
                put them on Saturday" had no door of its own at all. */}
            <Link href={`/shop/${shopSlug}/bookings/new`} className={buttonClass()}>
              {st("schedule.addBooking")}
            </Link>
          </>
        }
      />

      {/* The four-tile overview row is gone on purpose: "Departures 46 /
          Booked 196" aggregated a horizon nobody acts on as a number, and on
          a phone it pushed the first departure two screens down. The board
          rows carry the operational facts (design/principles.md #10:
          remove until it breaks). */}
      {builderNotice ? (
        <ShopNotice
          tone={builderNotice.tone}
          role={noticeRole(builderNotice.tone)}
          className="mb-6"
        >
          {builderNotice.message}
        </ShopNotice>
      ) : null}

      {!hasUpcoming ? (
        <EmptyState>
          {/* **"Nothing upcoming", not "nothing ever".** `hasUpcoming` is
              `upcomingScheduleRange` — departures ahead of now — so the diver
              page's "No trips on the books yet" and a heading offering to
              schedule "your first" departure were both a claim this signal
              cannot make: a shop between seasons has three hundred departures
              behind it and reads the same as a shop that opened this morning.
              The genuine first run is owned by Today's setup checklist, which
              knows the shop's whole trip count. */}
          <h2 className="font-medium">{t("schedule.noUpcomingStaff")}</h2>
          <p className="mt-1 text-sm text-muted">{t("schedule.noTripsStaff")}</p>
          {/* An empty board's one job is to stop being empty: this opens the
              add panel right below it rather than sending anyone to a second
              page for the same form. */}
          <Link
            href={`/shop/${shopSlug}/schedule/board?add=1`}
            scroll={false}
            className={buttonClass({ className: "mt-4" })}
          >
            {st("schedule.scheduleTrip")}
          </Link>
        </EmptyState>
      ) : null}

      <ScheduleBuilder
        shopSlug={shopSlug}
        days={builderDays}
        loadOptions={loadBuilderOptionsAction}
        price={priceInput}
        // Only a real `YYYY-MM-DD` from `?date=` is honoured; anything else
        // falls back to the soonest day already on the board.
        defaultDateIso={
          date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : (firstUpcomingDateIso ?? todayIso)
        }
        canConfigure={canConfigure}
        copy={builderCopy}
        more={builderMore}
        initialCourse={initialCourse}
        initialSite={initialSite}
        requestPlan={requestPlan}
        openAdd={addPanelState}
        actions={{
          add: addDepartureAction.bind(null, shopSlug),
          move: moveDepartureAction.bind(null, shopSlug),
          duplicate: duplicateDepartureAction.bind(null, shopSlug),
          remove: removeDepartureAction.bind(null, shopSlug),
        }}
      />

      {nextCursor || after ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {(() => {
            const backStack = decodeCursorStack(back);
            const previous = popCursor(backStack);
            if (!previous) return null;
            const params = new URLSearchParams();
            if (previous.after) params.set("after", previous.after);
            if (previous.stack.length > 0) params.set("back", encodeCursorStack(previous.stack));
            const query = params.toString();
            return (
              <Link
                href={`/shop/${shopSlug}/schedule/board${query ? `?${query}` : ""}`}
                scroll={false}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("schedule.showEarlier")}
              </Link>
            );
          })()}
          {nextCursor ? (
            <Link
              href={(() => {
                const params = new URLSearchParams();
                params.set("after", nextCursor);
                const nextStack = pushCursor(decodeCursorStack(back), after);
                if (nextStack.length > 0) params.set("back", encodeCursorStack(nextStack));
                return `/shop/${shopSlug}/schedule/board?${params.toString()}`;
              })()}
              scroll={false}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("schedule.showLater")}
            </Link>
          ) : null}
          {after ? (
            <Link
              href={`/shop/${shopSlug}/schedule/board`}
              scroll={false}
              className="text-sm font-medium text-primary hover:underline"
            >
              {t("schedule.backToNext")}
            </Link>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
