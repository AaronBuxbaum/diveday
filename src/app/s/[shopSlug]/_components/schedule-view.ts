import type { listedDepartureSummaries } from "@/app/s/[shopSlug]/_components/schedule-reads";
import type { pagedUpcomingTripsWithCounts } from "@/db/trips";
import type { DiverTranslator } from "@/i18n/messages";
import { DIVER_CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { addMonths, type MonthRef, monthKey } from "@/lib/calendar";
import type { CalendarDate } from "@/lib/calendar-date";
import { DECLARABLE_CERTIFICATION_LEVELS } from "@/lib/dive-declaration";
import { formatRelativeDay, formatShortDate } from "@/lib/format";
import { offSeason } from "@/lib/off-season";
import { publicSchedulePath } from "@/lib/public-routes";
import { certificationRank } from "@/lib/readiness";
import {
  decodeCursorStack,
  encodeCursorStack,
  popCursor,
  pushCursor,
} from "@/lib/schedule-pagination";
import { capacityLabel, nextBookableDeparture } from "@/lib/trips";
import { toDateInputValue, utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import { offSeasonLine } from "./OffSeasonPanel";

/** A level a diver can say they hold in the schedule's filter row. */
type DeclarableLevel = (typeof DECLARABLE_CERTIFICATION_LEVELS)[number];
/** One keyset page of the schedule's departures. */
export type UpcomingTrips = Awaited<ReturnType<typeof pagedUpcomingTripsWithCounts>>["trips"];
/** What each listed departure asks of anybody, by trip id. */
export type RequirementsByTrip = Awaited<ReturnType<typeof listedDepartureSummaries>>[1];

/** Shop-local month boundaries, in UTC, for a given calendar month. */
export function scheduleMonthBounds(ref: MonthRef, tz: string) {
  const monthStart = wallTimeToUtc(
    { year: ref.year, month: ref.month, day: 1, hour: 0, minute: 0 },
    tz,
  );
  const nextRef = addMonths(ref, 1);
  const monthEnd = wallTimeToUtc(
    { year: nextRef.year, month: nextRef.month, day: 1, hour: 0, minute: 0 },
    tz,
  );
  return { monthStart, monthEnd };
}

/** The view a diver has built: what every link that re-renders the schedule carries forward. */
export type ScheduleView = {
  shopSlug: string;
  month: string | undefined;
  isEmbed: boolean;
  hasSpaceFilter: boolean;
  tripTypeFilter: "fun_dive" | "course" | undefined;
  canDiveFilter: DeclarableLevel | undefined;
  hideAboveFilter: boolean;
  /** The *resolved* lens, or null when the URL named none or a word since deleted. */
  activeLens: { slug: string } | null;
};

/**
 * The view a diver has built — month, embed mode, the lens, and every list filter — must survive
 * every link that re-renders this page. A pager or month arrow that drops `hasSpace` quietly
 * hands back the full unfiltered list with the checkbox reset, with nothing saying why.
 */
export function scheduleViewLinks(view: ScheduleView) {
  const {
    shopSlug,
    month,
    isEmbed,
    hasSpaceFilter,
    tripTypeFilter,
    canDiveFilter,
    hideAboveFilter,
    activeLens,
  } = view;
  const withViewParams = (params: URLSearchParams) => {
    if (month) params.set("month", month);
    if (isEmbed) params.set("embed", "1");
    if (hasSpaceFilter) params.set("hasSpace", "1");
    if (tripTypeFilter) params.set("tripType", tripTypeFilter);
    if (canDiveFilter) params.set("canDive", canDiveFilter);
    if (hideAboveFilter) params.set("hideAbove", "1");
    // The *resolved* lens, never the raw parameter: carrying `?lens=nope`
    // forward would leave every pager link claiming a view the rail says is
    // not current.
    if (activeLens) params.set("lens", activeLens.slug);
    return params;
  };
  /** The same filters as `withViewParams`, for links that already carry their own `?month=`. */
  const filterSuffix = `${hasSpaceFilter ? "&hasSpace=1" : ""}${
    tripTypeFilter ? `&tripType=${tripTypeFilter}` : ""
  }${canDiveFilter ? `&canDive=${canDiveFilter}` : ""}${hideAboveFilter ? "&hideAbove=1" : ""}${
    activeLens ? `&lens=${activeLens.slug}` : ""
  }`;
  /**
   * A chip's destination: the current view with the lens swapped, and the
   * cursor dropped. `after`/`back` describe a position in a *different* list,
   * so carrying them across a lens change would open the narrowed board
   * somewhere in its middle.
   */
  const lensHref = (slug: string | null) => {
    const params = withViewParams(new URLSearchParams());
    params.delete("lens");
    if (slug) params.set("lens", slug);
    const query = params.toString();
    return `${publicSchedulePath(shopSlug)}${query ? `?${query}` : ""}`;
  };
  return { withViewParams, filterSuffix, lensHref };
}

/**
 * Which departures ask for more than the reader said they hold.
 *
 * The **ladder only**: `minimumCertificationLevel`, compared with
 * `certificationRank`. Specialties and nitrox are deliberately outside it —
 * asking in a filter row whether someone holds a Deep card is a form, not a
 * filter, and the level is the question a diver answers without thinking.
 * A course session is outside it too, for the same reason its requirement is
 * not rendered on the card: a course exists to create the certification, so
 * barring its own students from it reads as nonsense.
 */
export function aboveStatedLevelIds(
  upcoming: UpcomingTrips,
  requirementsByTrip: RequirementsByTrip,
  canDiveFilter: DeclarableLevel | undefined,
): Set<string> {
  return new Set(
    canDiveFilter
      ? upcoming
          .filter((trip) => {
            if (trip.course) return false;
            const required = requirementsByTrip.get(trip.id)?.minimumCertificationLevel;
            return Boolean(
              required && certificationRank(required) > certificationRank(canDiveFilter),
            );
          })
          .map((trip) => trip.id)
      : [],
  );
}

/**
 * The month rail: one row of "where am I / step a month" instead of the
 * full month grid this page used to open with. The grid duplicated every
 * departure already listed below it (once as an unreadable chip on a phone),
 * spent the whole first screen on empty cells, and stacked a second
 * navigation system on top of the list's own pager — a shop-operator's
 * month-planning view imposed on a diver who thinks in "this weekend."
 * What the grid actually did for a diver — jump the list to a month —
 * survives here as the same `?month=` links with the same accessible names.
 */
export function scheduleMonthRail({
  range,
  explicitMonth,
  now,
  tz,
}: {
  range: { first: Date | null; last: Date | null };
  explicitMonth: MonthRef | null;
  now: Date;
  tz: string;
}) {
  const ordinal = (ref: MonthRef) => ref.year * 12 + (ref.month - 1);
  const monthOf = (date: Date): MonthRef => {
    const wall = utcToWallTime(date, tz);
    return { year: wall.year, month: wall.month };
  };
  const todayWall = utcToWallTime(now, tz);
  const firstTripMonth = range.first ? monthOf(range.first) : null;
  const lastTripMonth = range.last ? monthOf(range.last) : null;
  const currentMonth: MonthRef = explicitMonth ??
    firstTripMonth ?? { year: todayWall.year, month: todayWall.month };
  const prev = addMonths(currentMonth, -1);
  const next = addMonths(currentMonth, 1);
  const prevMonthKey =
    firstTripMonth && ordinal(prev) >= ordinal(firstTripMonth) ? monthKey(prev) : null;
  const nextMonthKey =
    lastTripMonth && ordinal(next) <= ordinal(lastTripMonth) ? monthKey(next) : null;
  return { currentMonth, lastTripMonth, prevMonthKey, nextMonthKey };
}

/**
 * "Tomorrow · 7:00 AM" beats "Aug 28 · 7:00 AM" for the two days a diver is
 * most likely to be booking, and nothing else does: `Intl.RelativeTimeFormat`
 * renders anything further out as "in 5 days", which is worse than the date
 * it replaced. So the relative word covers today and tomorrow and the short
 * date covers the rest. Compared on the *shop-local calendar day*, never on a
 * millisecond difference — a 6 AM departure tomorrow is not "today" because
 * it is 14 hours away.
 */
export function scheduleDayWords(now: Date, locale: string, tz: string) {
  const dayKeyOf = (date: Date) => toDateInputValue(utcToWallTime(date, tz));
  const nowDayKey = dayKeyOf(now);
  const tomorrowDayKey = dayKeyOf(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const whenWord = (date: Date) =>
    dayKeyOf(date) === nowDayKey || dayKeyOf(date) === tomorrowDayKey
      ? formatRelativeDay(date, now, locale, tz)
      : formatShortDate(date, locale, tz);
  return { dayKeyOf, whenWord };
}

/**
 * Seat state as a word plus the tone that decides whether it earns a badge.
 * Low inventory keeps the urgent wording the booking form itself switches to
 * ("Book the last seat") — never colour alone (WCAG 1.4.1).
 */
export function scheduleSeatState(t: DiverTranslator, trip: { capacity: number; booked: number }) {
  const label = capacityLabel(trip);
  if (label.kind === "full") return { text: t("fallback.full"), tone: "full" as const };
  if (label.remaining <= 2) {
    return {
      text: t("schedule.spotsLeftUrgent", { count: label.remaining }),
      tone: "low" as const,
    };
  }
  return { text: t("fallback.spotsLeft", { count: label.remaining }), tone: "quiet" as const };
}

/** The filter row's words, in the vocabulary the booking form already asked them in. */
export function scheduleFilterCopy(t: DiverTranslator) {
  return {
    disclosure: t("schedule.filters.disclosure"),
    tripType: t("schedule.filters.tripType"),
    allTrips: t("schedule.filters.allTrips"),
    funDive: t("schedule.filters.funDive"),
    course: t("schedule.filters.course"),
    hasSpace: t("schedule.filters.hasSpace"),
    canDive: t("schedule.filters.canDive"),
    canDiveUnsaid: t("schedule.filters.canDiveUnsaid"),
    // Ladder order, and the same words the public booking form's own
    // certification select uses — the vocabulary a diver has already
    // been asked in is the one to ask them in again.
    canDiveLevels: DECLARABLE_CERTIFICATION_LEVELS.map((level) => ({
      value: level,
      label: t(DIVER_CERTIFICATION_LEVEL_KEYS[level]),
    })),
    hideAboveLevel: t("schedule.filters.hideAboveLevel"),
  };
}

/**
 * The pager row's three destinations under the week's list. Earlier and later
 * page through the keyset cursor (the earlier page from the stack of cursors
 * already passed, src/lib/schedule-pagination.ts) and keep the whole view;
 * "back to next" keeps the filters and drops both the cursor and any month.
 */
export function schedulePagerHrefs({
  view,
  after,
  back,
  nextCursor,
}: {
  view: ScheduleView;
  after: string | undefined;
  back: string | undefined;
  nextCursor: string | null | undefined;
}): { earlier: string | null; later: string | null; backToNext: string } {
  const { shopSlug, isEmbed, hasSpaceFilter, tripTypeFilter, canDiveFilter, hideAboveFilter } =
    view;
  const { withViewParams } = scheduleViewLinks(view);
  const earlier = (() => {
    const backStack = decodeCursorStack(back);
    const previous = popCursor(backStack);
    if (!previous) return null;
    const params = new URLSearchParams();
    if (previous.after) params.set("after", previous.after);
    if (previous.stack.length > 0) params.set("back", encodeCursorStack(previous.stack));
    withViewParams(params);
    const query = params.toString();
    return `${publicSchedulePath(shopSlug)}${query ? `?${query}` : ""}`;
  })();
  const later = nextCursor
    ? (() => {
        const params = new URLSearchParams();
        params.set("after", nextCursor);
        const nextStack = pushCursor(decodeCursorStack(back), after);
        if (nextStack.length > 0) params.set("back", encodeCursorStack(nextStack));
        withViewParams(params);
        return `${publicSchedulePath(shopSlug)}?${params.toString()}`;
      })()
    : null;
  // The whole point of this link is "start from the shop's next
  // departure", so it keeps the filters but deliberately drops
  // both the cursor and any month bound.
  const params = new URLSearchParams();
  if (isEmbed) params.set("embed", "1");
  if (hasSpaceFilter) params.set("hasSpace", "1");
  if (tripTypeFilter) params.set("tripType", tripTypeFilter);
  if (canDiveFilter) params.set("canDive", canDiveFilter);
  if (hideAboveFilter) params.set("hideAbove", "1");
  const query = params.toString();
  const backToNext = `${publicSchedulePath(shopSlug)}${query ? `?${query}` : ""}`;
  return { earlier, later, backToNext };
}

/**
 * **The off-season as a designed state** (N-45).
 *
 * Nothing public on the board for the next thirty days is a state the
 * storefront is now designed for rather than an empty list under "No trips
 * on the books yet" — see `src/lib/off-season.ts` for why the answer is
 * derived from a departure the shop scheduled, and never from a column
 * somebody has to remember to update.
 *
 * Never inside the frame. `?embed=1` is a window onto the next few
 * departures on somebody else's website; a card about the shop's year, and
 * a composer under it, are both things the host page did not ask for, and
 * the widget already keeps its own terminal state below.
 */
export function scheduleOffSeason({
  isEmbed,
  now,
  range,
  reopensOn,
  locale,
  tz,
  t,
}: {
  isEmbed: boolean;
  now: Date;
  range: { first: Date | null };
  /** `shops.reopens_on`: the shop's own typed "back on the water" date. */
  reopensOn: CalendarDate | null;
  locale: string;
  tz: string;
  t: DiverTranslator;
}) {
  const quiet = isEmbed
    ? { quiet: false, opensAt: null, reopensOn: null }
    : offSeason({ now, firstDeparture: range.first, reopensOn, timeZone: tz });
  const quietLine = offSeasonLine(t, quiet, locale, tz);
  return { quiet, quietLine };
}

/**
 * The storefront's next-boat card, decided: which departure it pins, whether
 * the view it answers is narrowed, and how many full boats it stepped over.
 */
export function scheduleNextBoat({
  visibleUpcoming,
  isEmbed,
  explicitMonth,
  after,
  hasSpaceFilter,
  tripTypeFilter,
  hideAboveFilter,
  activeLens,
}: {
  visibleUpcoming: UpcomingTrips;
  isEmbed: boolean;
  explicitMonth: MonthRef | null;
  after: string | undefined;
  hasSpaceFilter: boolean;
  tripTypeFilter: "fun_dive" | "course" | undefined;
  hideAboveFilter: boolean;
  activeLens: { slug: string } | null;
}) {
  // **The next boat out** — the storefront's one card and one primary (ADR
  // 20260827-clearwater-surface-language, decision 8). The soonest departure
  // with room, and it keeps its own row in the week below: the card is a pin,
  // not a removal.
  //
  // Only on the default view, and only outside the frame. Once a diver has
  // paged the calendar to a month or stepped the cursor, `upcoming` is bounded
  // and its first bookable trip is no longer the shop's actual next departure —
  // a card claiming otherwise would be confidently wrong. The embed is a
  // *window* onto the schedule (issue #805): a card there would eat a third of
  // a 900px frame to restate the row directly beneath it.
  const nextBoat =
    isEmbed || explicitMonth || after ? null : nextBookableDeparture(visibleUpcoming);
  /**
   * **Whether the card is answering a narrowed question** (issue #1391).
   *
   * Under any of these four, `visibleUpcoming` is a subset of the board and the
   * card's boat is the next bookable one *in this view* — three are applied in
   * SQL by the reader's `hasSpace` / `tripType` / `lensId` arguments, the fourth
   * by the `hideAboveFilter` filter above. Unqualified, the eyebrow would claim
   * the shop's next boat while a lens hid an earlier one.
   *
   * `canDiveFilter` on its own is deliberately not in the set: without
   * `hideAbove` it dims and marks the over-level departures and removes none, so
   * the card still names the shop's actual next boat and "in this view" would be
   * a narrowing that did not happen. The empty state below reads the same flag
   * for its "no matches" title, because it is the same question — whether what
   * the reader is looking at is a slice of the board or the board.
   */
  const filteredView =
    hasSpaceFilter || Boolean(tripTypeFilter) || hideAboveFilter || Boolean(activeLens);
  /**
   * **How many boats the card stepped over to find a seat** (issue #1374, ADR
   * 20260904-reef-all-the-way-down).
   *
   * `nextBookableDeparture` has always skipped the full ones; until now the
   * eyebrow said "Next boat out" and the diver was left to work out why the
   * card and the week's first row disagreed. The card names them instead — and
   * says nothing at all when this boat *is* the shop's next departure, which is
   * the ordinary case.
   */
  const skippedBoats = nextBoat ? visibleUpcoming.indexOf(nextBoat) : 0;
  const firstSkippedBoat = skippedBoats > 0 ? visibleUpcoming[0] : null;
  return {
    nextBoat: nextBoatCardShows(nextBoat, visibleUpcoming) ? nextBoat : null,
    filteredView,
    skippedBoats,
    firstSkippedBoat,
  };
}

/**
 * **Whether the "Next boat with space" card earns its place** (visual review
 * 2026-10-24, B17): only when the boat it pins is not the list's first row.
 * When it is, the card repeated the row directly beneath it, same trip, time,
 * price, seats and Book button. It shows when the first row is full (the card
 * steps over it) or the next boat with space sails on a later day than the
 * list's first; both mean the boat is not `visibleUpcoming[0]`, the row the
 * day strip and the list start on.
 */
export function nextBoatCardShows(
  nextBoat: { id: string } | null,
  visibleUpcoming: readonly { id: string }[],
): boolean {
  if (!nextBoat) return false;
  const first = visibleUpcoming[0];
  return first !== undefined && first.id !== nextBoat.id;
}
