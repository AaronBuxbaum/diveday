import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { discardFormDraftAction, saveFormDraftAction } from "@/app/actions/form-drafts";
import { EmptyState } from "@/components/EmptyState";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { canPersonConfigureTrips } from "@/db/authz";
import { listBoats, listBoatsForHistory } from "@/db/boats";
import { listDateRequestsByIds, listDateRequestsForCalendarDates } from "@/db/course-inquiries";
import { listActiveCourses } from "@/db/courses";
import { listDiveSites } from "@/db/dive-sites";
import { readFormDraft } from "@/db/form-drafts";
import { openAfterDiveRollCalls } from "@/db/today";
import { tripCrewByTrip, upcomingScheduleRange, weekBoard } from "@/db/trips";
import { CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { requestTranslator } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { maxConcurrentTrips, overlappingBoatIds } from "@/lib/boats";
import { calendarDateInTimezone, calendarDateToUtcMidnight } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { addDepartureHref, groupDateRequests } from "@/lib/date-requests";
import {
  formatCalendarDateRange,
  formatDayParts,
  formatMoneyCents,
  formatMoneyScanned,
  formatShortDate,
  formatTime,
  formatTimeRange,
  weekdayNames,
} from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import { currencyFractionDigits, maxPriceMajor, toShopCurrency } from "@/lib/money";
import { publicSchedulePath } from "@/lib/public-routes";
import { adviseRequests, departureShapeFor } from "@/lib/request-advisor";
import { requireShopSurface } from "@/lib/session";
import { siteMarkFor } from "@/lib/site-mark";
import { noticeFromParam, noticeRole } from "@/lib/staff-notices";
import { MAX_TRIP_DAYS, MIN_TRIP_DAYS } from "@/lib/trip-days";
import { uuidParam } from "@/lib/uuid";
import {
  resolveWeekStart,
  shiftWeek,
  weekDates,
  weekEntryMeta,
  weekIsWhollyUnpriced,
  weekStartOf,
} from "@/lib/week-board";
import { weekSeatTally } from "@/lib/week-seats";
import { toDateInputValue, toTimeInputValue, utcToWallTime } from "@/lib/zoned";
import {
  type BuilderCopy,
  type BuilderInitialCourse,
  type BuilderInitialSite,
  type BuilderMoreOptions,
  type BuilderPriceInput,
  type BuilderRequestPlan,
  ScheduleBuilder,
} from "./_components/ScheduleBuilder";
import type { BuilderWeek, WeekEntry, WeekSpan } from "./_components/WeekBoard";
import {
  addDepartureAction,
  duplicateDepartureAction,
  loadBuilderOptionsAction,
  loadMovePreflightAction,
  loadTideWindowAction,
  loadWeekdayPatternAction,
  moveDepartureAction,
  removeDepartureAction,
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
    /**
     * Which week the desktop grid draws, as any date inside it — normalised
     * to that week's Monday (`src/lib/week-board.ts`). Deliberately separate
     * from the stream's `after`/`back` cursor: the grid is a second *reading*
     * of the same departures, not a second stream, and the two never mix.
     * Slice 9e's staffing week reads the same parameter.
     */
    week?: string;
  }>;
}) {
  await connection(); // schedule is live data — render per request, not at build
  const { shopSlug } = await params;
  const { builder, created, gear, series, add, date, course, requests, site, week } =
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
  // The reader's own half-typed add panel, if they left one in the last day
  // (ADR 20260906-before-you-ask, decision 3).
  const draft = await readFormDraft(db, shop.id, session.user.personId, "add_departure", now);
  const addDraft = draft
    ? { fields: draft.fields, savedAtLabel: formatTime(draft.savedAt, locale, shop.timezone) }
    : null;
  const todayIso = toDateInputValue(utcToWallTime(now, tz));
  // Which week the desktop grid draws. Total by construction: a malformed or
  // missing `?week=` lands on the one the shop is in rather than refusing the
  // page (`src/lib/week-board.ts`).
  const weekStartIso = resolveWeekStart(week, todayIso);

  // The board works off one keyset page of departures, same as the public
  // list — a shop with hundreds of upcoming departures still loads one page,
  // not the whole future.
  // The add panel's course and dive-site options are deliberately *not* here:
  // they are two queries and a whole catalogue of client props for two selects
  // inside a panel that is closed by default, so they load when it opens
  // (`loadBuilderOptionsAction`).
  const [range, canConfigure, openRollCalls, shopBoats, weekRows, weekAsks] = await Promise.all([
    upcomingScheduleRange(db, shop.id, now),
    canPersonConfigureTrips(db, shop.id, session.user.personId),
    // Departures that already came back with a head count still open (DOM-H3).
    // `pagedUpcomingTripsWithCounts` cannot reach them — it only returns trips
    // whose `startsAt` is still ahead of `now` — so this is its own backwards
    // query, and one batched query for every such boat rather than a per-trip
    // roll-call lookup.
    //
    // Read at every cursor page, not only the first, because the **week** also
    // needs it and the week has no cursor: it is addressed by `?week=`, so a
    // board sitting on `?after=` still draws a grid, and gating the read on
    // the stream's pager is what made the loudest thing the board can say
    // disappear at desktop. The stream's own placement is unchanged — those
    // rows lead page one and are not repeated on top of every later page
    // (`streamRollCalls` below).
    openAfterDiveRollCalls(db, shop.id, now),
    listBoats(db, shop.id),
    // A second, bounded reading of the same departures — one week, not a
    // cursor page — for the `xl` grid (ADR 20260827-clearwater-surface-language,
    // decision 5). It reaches backwards, which the stream never does: a week
    // that has already half-happened is most of what "what does my week look
    // like" means.
    weekBoard(db, shop.id, weekStartIso, tz, now),
    // **The days somebody asked for** (ADR 20260919-one-idea, slice 23f —
    // "a request is a day someone asked for, drawn as a ghost on the week").
    // Bounded to the week for the same reason everything else here is: Tide
    // files a thing under the hour it happens at, and a lead for a day three
    // weeks out is that week's business. `/shop/<slug>/requests` stays the
    // unbounded reading of the same rows.
    listDateRequestsForCalendarDates(db, shop.id, weekDates(weekStartIso)),
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
  // **Who is crewing the week the board is drawing.** Depends on the ids the
  // week read produced, so it runs as a second wave rather than inside the
  // batch above. One reading now, so one list: this used to union the stream's
  // cursor page with the week's ids, and the two never agreed about which
  // departures were on the board (#1923).
  const crewByTrip = await tripCrewByTrip(
    db,
    shop.id,
    Object.values(weekRows.days).flatMap((entries) => entries.map((entry) => entry.tripId)),
  );

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

  // Read for whoever can open the board, since 2026-09-16 (issue #1679). This
  // carried the same `canPersonViewShopReports` check as `/requests`, on the
  // written ground that it was "the same live report gate that protects
  // /requests" — and that page is ungated now, so the check protected nothing
  // and only broke the day group's one act: a captain tapping "Add departure"
  // got a builder with no requests block and no explanation. `shop.id` is
  // still the scope (`listDateRequestsByIds`), so a shareable URL still cannot
  // pull another tenant's lead.
  const requestRows =
    requestIds.length > 0 ? await listDateRequestsByIds(db, shop.id, requestIds) : [];
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
    typedAs: st.raw("shared.forgiving.typedAs"),
    draftPickedUp: st.raw("shared.formDraft.pickedUp"),
    draftStartOver: st("shared.formDraft.startOver"),
    patternFilled: st.raw("schedule.builder.patternFilled"),
    patternStartBlank: st("schedule.builder.patternStartBlank"),
    patternCrew: st.raw("schedule.builder.patternCrew"),
    patternAlsoUsual: st.raw("schedule.builder.patternAlsoUsual"),
    patternAlsoUsualUntitled: st.raw("schedule.builder.patternAlsoUsualUntitled"),
    patternAddAlso: st("schedule.builder.patternAddAlso"),
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
    windLabel: st("schedule.builder.windLabel"),
    noPriceSet: st("schedule.builder.noPriceSet"),
    noPriceSetAria: st.raw("schedule.builder.noPriceSetAria"),
    noPriceSetAll: st("schedule.builder.noPriceSetAll"),
    noBoats: st("schedule.week.noBoats"),
    asked: st("schedule.week.asked"),
    addDeparture: st("requests.addDeparture"),
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
    impactTitle: st("schedule.builder.impactTitle"),
    impactCrewClash: st.raw("schedule.builder.impactCrewClash"),
    impactCrewAway: st.raw("schedule.builder.impactCrewAway"),
    impactToldOne: st.raw("schedule.builder.impactToldOne"),
    impactToldOther: st.raw("schedule.builder.impactToldOther"),
    impactGearOne: st.raw("schedule.builder.impactGearOne"),
    impactGearOther: st.raw("schedule.builder.impactGearOther"),
    impactPaidOne: st.raw("schedule.builder.impactPaidOne"),
    impactPaidOther: st.raw("schedule.builder.impactPaidOther"),
    impactWindowOne: st.raw("schedule.builder.impactWindowOne"),
    impactWindowOther: st.raw("schedule.builder.impactWindowOther"),
    // The panel says up front exactly what the post-move notice would have said
    // afterwards — the same two keys `BUILDER_NOTICE_KEYS` maps, so a refusal
    // cannot be worded two ways depending on when you learn about it.
    impactBlockedSailed: st("schedule.notices.alreadySailed"),
    impactBlockedNotScheduled: st("schedule.notices.notScheduled"),
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
    selfGuidedLabel: st("schedule.builder.selfGuidedLabel"),
    selfGuidedHint: st("schedule.builder.selfGuidedHint"),
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
    lensLabel: st("lenses.tripFieldLabel"),
    lensNone: st("lenses.tripFieldNone"),
    // The season's own name is only known on the client — which season covers
    // the date the panel is currently on changes as the staffer moves it — so
    // this crosses as a template for `fill()`, never formatted here.
    lensFromSeason: st.raw("lenses.tripFieldFromSeason"),
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

  // The date an add panel opens on when the URL names none. Read off
  // `upcomingScheduleRange` since the stream that used to supply the first row
  // of a cursor page went (#1923): it is the same fact — the shop's next
  // departure — from the query that was already being made for it.
  const firstUpcomingDateIso = range.first
    ? toDateInputValue(utcToWallTime(range.first, tz))
    : null;
  /**
   * **"More departures than boats", for one day.** One function because both
   * compositions ask it: the stream asks it of a cursor page's day, the week
   * asks it of a column, and the answer is the board's whole question — a
   * grid that drew seven days and never said a hull was booked twice would be
   * the quietest place in the app to notice it. Only a shop that runs boats is
   * asked; a shore operation's hull rows are dormant, not a fleet to outrun.
   */
  function boatWarningFor(
    dayTrips: ReadonlyArray<{
      startsAt: Date;
      endsAt: Date;
      diveMode?: "boat" | "shore" | "pool" | null;
      boatId?: string | null;
    }>,
  ): string | null {
    if (!shop.hasBoatDiving || shopBoats.length === 0) return null;
    const boatTrips = dayTrips.filter((t) => (t.diveMode ?? "boat") === "boat");
    // **The per-hull question first, because it names the boat.** Counting
    // simultaneous departures against the fleet size cannot see two of them
    // on the *same* vessel: two hulls owned, peak of two, nothing said, one
    // boat in two places. It is also the mistake that takes three departures
    // to show up in a count, which is to say the one a shop is most likely to
    // make by accident.
    const names = overlappingBoatIds(boatTrips)
      .map((boatId) => boatMap.get(boatId))
      .filter((name): name is string => Boolean(name));
    // The name is the actionable part — "Reef Runner is on two departures"
    // tells a shop which card to open; a count does not.
    if (names.length > 0) {
      return st("boats.doubleBookedWarning", {
        boats: cachedListFormat(locale, { style: "long", type: "conjunction" }).format(names),
      });
    }
    // The fleet-size answer stays: it is the only one available for a
    // departure with no hull assigned, which is most of them.
    const peakConcurrent = maxConcurrentTrips(boatTrips);
    if (peakConcurrent > shopBoats.length) {
      return st("boats.concurrencyWarning", {
        tripCount: peakConcurrent,
        boatCount: shopBoats.length,
      });
    }
    return null;
  }

  // ---- The week, for `xl` and up (ADR 20260827-clearwater-surface-language,
  // decision 5). Every string below is resolved here, for the request locale
  // and the shop's own zone: a 160px column has no room to be wrong about a
  // time, and the grid is a Client Component that may format neither.
  const boardPath = `/shop/${shopSlug}/schedule/board`;
  const weekDayIsos = weekDates(weekStartIso);
  // **Scanned, not ledgered** (issue #769): a price read down a column of
  // seven is a figure to compare, not a line to reconcile, so "$95" rather
  // than "$95.00" — in the narrowest column the app has.
  const weekMoney = (cents: number | null) =>
    cents === null ? null : formatMoneyScanned(cents, currency, locale);
  // Every departure that came home with its head count still open, whatever
  // page the *stream* is on. The week has no cursor (DOM-H3).
  const weekRollCalls = new Map(
    openRollCalls.map((open) => [
      open.tripId,
      { diveNumber: open.diveNumber, uncounted: open.uncounted },
    ]),
  );
  // The same "say a shared fact once" gate the stream's price banner uses: a
  // whole week with no price anywhere is one condition, not seven warnings.
  // **Spans are weighed with the cells.** A multi-day course is drawn once as
  // a bar instead of once per day, so a week whose only upcoming departures
  // are unpriced courses would otherwise fall through both halves of this —
  // no banner, and no mark on the bars either — and the shop would be told
  // nothing at all.
  const weekAllUnpriced = weekIsWhollyUnpriced(weekRows);
  const weekViewDays = weekDayIsos.map((iso) => {
    // A calendar date has no instant in it, so it is formatted through a
    // UTC-midnight reference rather than converted from the shop's zone —
    // which would only risk shifting a column onto the wrong day.
    const dayInstant = calendarDateToUtcMidnight(iso);
    const parts = formatDayParts(dayInstant, locale, "UTC");
    const label = formatShortDate(dayInstant, locale, "UTC");
    const entries: WeekEntry[] = (weekRows.days[iso] ?? []).map((entry) => {
      const timeRange = formatTimeRange(entry.startsAt, entry.endsAt, locale, tz);
      const price = weekMoney(entry.priceCents);
      const seats = st("schedule.week.seats", {
        booked: entry.booked,
        capacity: entry.capacity,
      });
      return {
        tripId: entry.tripId,
        dateIso: iso,
        startTime: toTimeInputValue(utcToWallTime(entry.startsAt, tz)),
        title: entry.title,
        time: formatTime(entry.startsAt, locale, tz),
        mark: siteMarkFor({ siteName: entry.diveSiteName, isCourse: entry.courseId !== null }),
        // **The site leads, because it is what differs.** Every title in a
        // column shares its prefix — "Dawn Two-Tank — …", "Morning Two-Tank —
        // …" — and a 150px column clips exactly the half that distinguishes
        // one from the next, so the site is stated here where it survives and
        // the title is clamped to a single line above it.
        //
        // No "Full": the count beside it already says 12 of 12, and the word
        // spent the same currency the grid's real warnings use (issue 758,
        // the same call the stream made).
        meta: weekEntryMeta({
          status: entry.status,
          sailedLabel: st("schedule.week.sailed"),
          siteName: entry.diveSiteName,
          // **Which hull, or why there isn't one** (#1923). The day stream
          // that used to carry this is gone, and a scheduling surface may not
          // quietly stop saying what a departure is on. A shore or pool
          // session names itself in the hull's place: the absence is the fact,
          // and a blank there would read as a boat nobody has assigned.
          // History, not the live fleet — a departure that sailed on a hull
          // the shop has since deleted still says which one
          // (ADR 20260820-every-delete-is-soft).
          vessel:
            entry.diveMode === "shore"
              ? st("boats.modeShore")
              : entry.diveMode === "pool"
                ? st("boats.modePool")
                : entry.boatId
                  ? (boatMap.get(entry.boatId) ?? null)
                  : null,
          seats,
          price,
        }),
        // **Who is crewing it**, in the shop's own lead-first order. The row
        // decides nothing with this — `WeekBoard` votes on the week's habit and
        // prints only the departures that differ (`src/lib/usual-crew.ts`).
        crew: (crewByTrip.get(entry.tripId) ?? []).map((member) => member.name),
        // The two numbers the bar is a picture of. Beside `meta` rather than
        // parsed back out of it: "10 of 12" is a sentence in two languages and
        // `src/lib/week-seats.ts` must never have to read one.
        seats: { booked: entry.booked, capacity: entry.capacity },
        rollCallOpen: weekRollCalls.get(entry.tripId) ?? null,
        // Single-day by construction: `weekBoard` returns a multi-day course
        // as a span, never as a day entry, so an entry's move panel never has
        // a block of days to warn about.
        dayCount: 1,
        status: entry.status,
        unpriced: entry.priceCents === null && !weekAllUnpriced,
        // The same shape the stream's controls use, so "Move X, Mon Jul 20
        // 7:00 AM – 11:00 AM" names one departure whichever composition a
        // staffer is reading.
        ref: `${entry.title}, ${label} ${timeRange}`,
      };
    });
    return {
      dateIso: iso,
      weekday: parts.weekday,
      dayNumber: parts.day,
      label,
      isToday: iso === todayIso,
      isPast: iso < todayIso,
      // The board's whole question, asked of a column: more departures than
      // hulls, or one hull in two places. The stream asks the same one of the
      // same day through the same helper.
      boatWarning: boatWarningFor(weekRows.days[iso] ?? []),
      entries,
    };
  });
  const lastWeekDayIso = weekDayIsos.at(-1) ?? weekStartIso;
  const weekViewSpans: WeekSpan[] = weekRows.spans.flatMap((span) => {
    // A course that started before this week, or runs past it, is clamped to
    // the columns there are — it is the same object read from either week.
    const first = span.firstDay < weekStartIso ? 0 : weekDayIsos.indexOf(span.firstDay);
    const last = span.lastDay > lastWeekDayIso ? 6 : weekDayIsos.indexOf(span.lastDay);
    if (first < 0 || last < 0 || last < first) return [];
    return [
      {
        tripId: span.tripId,
        title: span.title,
        meta: [
          st("schedule.week.seats", { booked: span.booked, capacity: span.capacity }),
          weekMoney(span.priceCents),
          span.instructorName,
        ]
          .filter(Boolean)
          .join(" · "),
        // The course's own first day and departure time, not the column the
        // bar happens to start in: a run that began before this week still
        // moves from where it really starts.
        seats: { booked: span.booked, capacity: span.capacity },
        runsLabel: st("schedule.week.runsDays", { days: span.dayCount }),
        dateIso: span.firstDay,
        startTime: toTimeInputValue(utcToWallTime(span.startsAt, tz)),
        dayCount: span.dayCount,
        status: span.status,
        unpriced: span.priceCents === null && !weekAllUnpriced,
        rollCallOpen: weekRollCalls.get(span.tripId) ?? null,
        ref: `${span.title}, ${formatCalendarDateRange(span.firstDay, span.lastDay, locale)}`,
        startColumn: first + 1,
        columnSpan: last - first + 1,
      },
    ];
  });
  // **A visible week with nothing in it is a dead end without this.** The grid
  // renders whenever the *board* has something upcoming, which is not the same
  // as this week having it: a shop whose next departure is ten days out lands
  // on seven blank columns, and the stream that would have listed them is
  // `display:none` at this width. So the one week that is empty says where the
  // next one is and links straight to it — `?week=` takes any date inside a
  // week and normalises it (src/lib/week-board.ts).
  const weekIsEmpty =
    weekViewSpans.length === 0 && weekViewDays.every((day) => day.entries.length === 0);
  const weekNextDeparture =
    weekIsEmpty && range.first
      ? {
          label: st("schedule.week.nothingThisWeek", {
            date: formatShortDate(range.first, locale, tz),
          }),
          href: `${boardPath}?week=${calendarDateInTimezone(range.first, tz)}`,
        }
      : null;
  // **The days somebody asked for, against the days as they stand.**
  //
  // Every ask for a day in this week, not only the empty ones. The first cut
  // filtered out days that already had a departure, on the reading that a boat
  // answers the ask — and the seed showed that up straight away: two leads
  // asking for the 2nd and the 3rd were hidden by a four-seat buoyancy course
  // and a wreck charter that have nothing to do with what either group asked
  // for. Whether a departure answers a request is the staffer's judgement, and
  // the week's job is to put the two side by side so they can make it.
  const { groups: weekAskGroups } = groupDateRequests(weekAsks, (row) => row);
  const weekAsked = weekAskGroups
    .filter((group) => weekDayIsos.includes(group.date))
    .map((group) => {
      const rows = group.entries.map((entry) => entry.request);
      // A lead who did not say how many is one person, not none.
      const people = rows.reduce((total, row) => total + Math.max(1, row.divers ?? 1), 0);
      // The reader's own list grammar, not a hard-coded comma: "A, B and C" is
      // English's, and `es-ES` writes it differently.
      const named = rows.map((row) => row.name).filter((name): name is string => Boolean(name));
      const shown = named.slice(0, 2);
      const others = named.length - shown.length;
      // **The overflow is an item in the list, not a clause after it.**
      // `Intl.ListFormat` already puts the conjunction between the last two,
      // so appending "and {n} others" to its output said "and" twice —
      // "Tomás Ferreira and Priya Sharma and 2 others". Handing it the phrase
      // as a third item gets the grammar right in every language, including
      // the ones that do not join a list the way English does.
      const names = cachedListFormat(locale, { style: "long", type: "conjunction" }).format(
        others > 0 ? [...shown, st("schedule.week.askedOthers", { others })] : shown,
      );
      return {
        dateIso: group.date,
        lead: st("schedule.week.askedLead", {
          date: formatShortDate(calendarDateToUtcMidnight(group.date), locale, "UTC"),
          people,
        }),
        who: names,
        href: addDepartureHref(
          shopSlug,
          group.date,
          rows.map((row) => row.id),
        ),
      };
    });

  // Null while the board has nothing upcoming at all: the terminal empty
  // state is the whole page at every width, and seven empty columns beneath
  // it would be the same nothing said twice.
  const builderWeek: BuilderWeek | null = hasUpcoming
    ? {
        ariaLabel: st("schedule.week.ariaLabel"),
        rangeLabel: formatCalendarDateRange(weekStartIso, lastWeekDayIso, locale),
        previousHref: `${boardPath}?week=${shiftWeek(weekStartIso, -1)}`,
        nextHref: `${boardPath}?week=${shiftWeek(weekStartIso, 1)}`,
        thisWeekHref: weekStartIso === weekStartOf(todayIso) ? null : boardPath,
        allUnpriced: weekAllUnpriced,
        // **Counted from the drawn rows, not from the query.** A span replaces
        // the day cells it covers rather than joining them, so summing these
        // two lists is summing exactly what a reader can see — and a course
        // cannot be counted twice by a tally reading the same rows the week
        // does.
        seatTally: st("schedule.week.seatTally", {
          ...weekSeatTally([
            ...weekViewDays.flatMap((day) => day.entries.map((entry) => entry.seats)),
            ...weekViewSpans.map((span) => span.seats),
          ]),
        }),
        words: {
          previous: st("schedule.week.previous"),
          next: st("schedule.week.next"),
          thisWeek: st("schedule.week.thisWeek"),
          today: st("schedule.week.today"),
        },
        nextDeparture: weekNextDeparture,
        days: weekViewDays,
        spans: weekViewSpans,
        asked: weekAsked,
        askedCount: st("schedule.week.askedDays", { days: weekAsked.length }),
      }
    : null;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        // The board's own name, from the staff bundle. It used to borrow the
        // public schedule's heading, so `/s/<slug>` and this page both said
        // "Schedule" while the nav tab called it something else again.
        eyebrow={st("schedule.boardEyebrow")}
        title={st("schedule.boardTitle")}
        // **The header stands down while the board is empty** (issue 797).
        // With nothing upcoming, this cluster offered a new owner three doors
        // and made the impossible one primary: "Add a booking" leads to a
        // departure picker with no departures in it, so the page's most
        // emphasised action was a dead end; "+ Add a departure" and the empty
        // state's own "Schedule a trip" are the same act twelve pixels apart
        // in the reading order; and "View public page" invited a look at a
        // page with nothing on it. Two primaries rendered together, which
        // §8 counts by what is on screen.
        //
        // So the one act that can succeed is left where it already was, in
        // the empty state below. This is the fork the orders index makes for
        // the same reason a few routes over — its header primary stands down
        // while its list is empty rather than doubling the empty state's.
        actions={
          hasUpcoming ? (
            <>
              {/* **The rare door, at the weight of a rare door** (principle 8:
                collapse the rare path). Three buttons stood here — two of them
                filled — and this is the only one that is not an operational
                act: a shop looks at its own public page occasionally, and
                `/shop/[shopSlug]` and the embed settings page both carry the
                same link. At `link` weight it keeps its label at every width,
                which retires the icon-only phone twin issue #954 needed when
                all three were buttons: what did not fit at 390px in either
                locale was three *filled* controls, and there are two now. It
                does not move into `ShopIdentityMenu` — that menu holds the
                reader's own session and never a place in the shop
                (`.claude/rules/surfaces.md`). */}
              <Link
                href={publicSchedulePath(shopSlug)}
                className={buttonClass({ variant: "link" })}
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
                  {st("schedule.builder.addDeparture")}
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
          ) : undefined
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
        <EmptyState
          title={t("schedule.noUpcomingStaff")}
          body={t("schedule.noTripsStaff")}
          // Gated on the same live check the header's add link uses. It was
          // ungated while the header carried a gated twin, which was survivable
          // — a captain who tapped it got the builder's view-only notice. Now
          // that the header stands down here it is the page's only control, and
          // a lone primary that leads to a refusal is a worse empty state than
          // no button at all. A staffer who cannot schedule sees the sentence
          // and nothing to press, which is the truth.
          action={
            canConfigure ? (
              <Link
                href={`/shop/${shopSlug}/schedule/board?add=1`}
                scroll={false}
                className={buttonClass({ className: "mt-4" })}
              >
                {st("schedule.scheduleTrip")}
              </Link>
            ) : undefined
          }
        />
      ) : null}

      <ScheduleBuilder
        shopSlug={shopSlug}
        locale={locale}
        addDraft={addDraft}
        loadPattern={loadWeekdayPatternAction}
        loadTideWindow={loadTideWindowAction}
        loadOptions={loadBuilderOptionsAction}
        loadMovePreflight={loadMovePreflightAction}
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
        week={builderWeek}
        actions={{
          add: addDepartureAction.bind(null, shopSlug),
          move: moveDepartureAction.bind(null, shopSlug),
          duplicate: duplicateDepartureAction.bind(null, shopSlug),
          remove: removeDepartureAction.bind(null, shopSlug),
          draft: { save: saveFormDraftAction, discard: discardFormDraftAction },
        }}
      />
    </main>
  );
}
