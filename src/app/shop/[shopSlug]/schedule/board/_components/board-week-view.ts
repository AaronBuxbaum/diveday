import type { listOpenDateInterestsForDates } from "@/db/interest-dates";
import type { openAfterDiveRollCalls } from "@/db/today";
import type { weekBoard } from "@/db/trips";
// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
import { awayDatesText } from "@/i18n/away-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { maxConcurrentTrips, overlappingBoatIds } from "@/lib/boats";
import { calendarDateInTimezone, calendarDateToUtcMidnight } from "@/lib/calendar-date";
import type { AvailabilityBlock } from "@/lib/crew-requests";
import { addDepartureHref, groupDateRequests } from "@/lib/date-requests";
import {
  formatCalendarDateRange,
  formatDayParts,
  formatMoneyScanned,
  formatShortDate,
  formatTime,
  formatTimeRange,
  joinFacts,
} from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import type { ShopCurrency } from "@/lib/money";
import {
  shiftWeek,
  weekDates,
  weekEntryMeta,
  weekIsWhollyUnpriced,
  weekStartOf,
} from "@/lib/week-board";
import { weekSeatTally } from "@/lib/week-seats";
import { toTimeInputValue, utcToWallTime } from "@/lib/zoned";
import type { LastYearWeek, weekCrewRead } from "./board-reads";
import type { BuilderWeek, WeekEntry, WeekSpan } from "./WeekBoard";

/**
 * **"More departures than boats", for one day.** One function because both
 * compositions ask it: the stream asks it of a cursor page's day, the week
 * asks it of a column, and the answer is the board's whole question — a
 * grid that drew seven days and never said a hull was booked twice would be
 * the quietest place in the app to notice it. Only a shop that runs boats is
 * asked; a shore operation's hull rows are dormant, not a fleet to outrun.
 */
export function boatWarningFor(
  {
    hasBoatDiving,
    boatCount,
    boatMap,
    locale,
    st,
  }: {
    hasBoatDiving: boolean;
    /** How many live hulls the shop runs. */
    boatCount: number;
    /** Every hull the shop has ever had, by id, for its name. */
    boatMap: Map<string, string>;
    locale: string;
    st: StaffTranslator;
  },
  dayTrips: ReadonlyArray<{
    startsAt: Date;
    endsAt: Date;
    diveMode?: "boat" | "shore" | "pool" | null;
    boatId?: string | null;
  }>,
): string | null {
  if (!hasBoatDiving || boatCount === 0) return null;
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
  if (peakConcurrent > boatCount) {
    return st("boats.concurrencyWarning", {
      tripCount: peakConcurrent,
      boatCount,
    });
  }
  return null;
}

/**
 * **The week, for `xl` and up** (ADR 20260827-clearwater-surface-language,
 * decision 5): seven columns of departures, the multi-day spans across them,
 * the days somebody asked for, and the week's pager. Null while the board has
 * nothing upcoming at all.
 */
export function boardWeekView({
  shopSlug,
  weekStartIso,
  todayIso,
  range,
  weekRows,
  weekAsks,
  openRollCalls,
  crewByTrip,
  boatMap,
  shop,
  boatCount,
  hasUpcoming,
  currency,
  locale,
  tz,
  st,
  lastYear,
}: {
  shopSlug: string;
  weekStartIso: string;
  todayIso: string;
  range: { first: Date | null };
  weekRows: Awaited<ReturnType<typeof weekBoard>>;
  weekAsks: Awaited<ReturnType<typeof listOpenDateInterestsForDates>>;
  openRollCalls: Awaited<ReturnType<typeof openAfterDiveRollCalls>>;
  crewByTrip: Awaited<ReturnType<typeof weekCrewRead>>;
  boatMap: Map<string, string>;
  shop: { hasBoatDiving: boolean; crewScheduleEnabled: boolean };
  boatCount: number;
  hasUpcoming: boolean;
  currency: ShopCurrency;
  locale: string;
  tz: string;
  st: StaffTranslator;
  /** The same week a year before (fifth loop, item 30). */
  lastYear?: LastYearWeek;
}): BuilderWeek | null {
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
          price,
        }),
        seatsLabel: seats,
        // **Who is crewing it**, in the shop's own lead-first order. The row
        // decides nothing with this — `WeekBoard` votes on the week's habit and
        // prints only the departures that differ (`src/lib/usual-crew.ts`).
        // Null for a shop that keeps no crew schedule: no crew line at all.
        crew: shop.crewScheduleEnabled
          ? (crewByTrip.get(entry.tripId) ?? []).map((member) => member.name)
          : null,
        crewAway: crewAwayLine(crewByTrip.get(entry.tripId), st, locale),
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
        // A rehearsal is unpriced by design and says so instead (#2395).
        unpriced: entry.priceCents === null && !entry.isRehearsal && !weekAllUnpriced,
        rehearsal: entry.isRehearsal,
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
      paperLabel: joinFacts([formatCalendarDateRange(iso, iso, locale), tz]),
      isToday: iso === todayIso,
      isPast: iso < todayIso,
      // The board's whole question, asked of a column: more departures than
      // hulls, or one hull in two places. The stream asks the same one of the
      // same day through the same helper.
      boatWarning: boatWarningFor(
        { hasBoatDiving: shop.hasBoatDiving, boatCount, boatMap, locale, st },
        weekRows.days[iso] ?? [],
      ),
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
        // `joinFacts`, as a boat's meta is (`weekEntryMeta`): no wrapped line
        // of it starts with "·".
        meta: joinFacts([weekMoney(span.priceCents), span.instructorName]),
        seatsLabel: st("schedule.week.seats", { booked: span.booked, capacity: span.capacity }),
        // The course's own first day and departure time, not the column the
        // bar happens to start in: a run that began before this week still
        // moves from where it really starts.
        seats: { booked: span.booked, capacity: span.capacity },
        runsLabel: st("schedule.week.runsDays", { days: span.dayCount }),
        time: formatTime(span.startsAt, locale, tz),
        dateIso: span.firstDay,
        startTime: toTimeInputValue(utcToWallTime(span.startsAt, tz)),
        dayCount: span.dayCount,
        status: span.status,
        unpriced: span.priceCents === null && !weekAllUnpriced,
        // A rehearsal is a single departure, never a multi-day span.
        rehearsal: false,
        rollCallOpen: weekRollCalls.get(span.tripId) ?? null,
        crewAway: crewAwayLine(crewByTrip.get(span.tripId), st, locale),
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
  // answers the ask — and the seed showed that up straight away: two interests
  // asking for the 2nd and the 3rd were hidden by a four-seat buoyancy course
  // and a wreck charter that have nothing to do with what either group asked
  // for. Whether a departure answers a request is the staffer's judgement, and
  // the week's job is to put the two side by side so they can make it.
  const { groups: weekAskGroups } = groupDateRequests(weekAsks, (row) => row);
  const weekAsked = weekAskGroups
    .filter((group) => weekDayIsos.includes(group.date))
    .map((group) => {
      const rows = group.entries.map((entry) => entry.request);
      // An interest who did not say how many is one person, not none.
      const people = rows.reduce((total, row) => total + Math.max(1, row.partySize ?? 1), 0);
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
  return hasUpcoming
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
        // **Last year beside this year** (fifth loop, item 30): quiet until
        // the shop sailed that week a year ago.
        lastYearTally:
          lastYear && lastYear.total > 0
            ? st("schedule.week.lastYearTally", { taken: lastYear.taken, total: lastYear.total })
            : null,
        // An empty week still to come, where last year had boats, offers them
        // back in one act.
        copyLastYear:
          weekIsEmpty &&
          lastYear &&
          lastYear.departures > 0 &&
          shiftWeek(weekStartIso, 1) > todayIso
            ? {
                line: st("schedule.week.lastYearLine", { count: lastYear.departures }),
                label: st("schedule.week.lastYearCopy"),
                pending: st("schedule.week.lastYearCopying"),
                weekStart: weekStartIso,
              }
            : null,
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
}

/**
 * **"Marcus Webb away Sat, Oct 17 – Sun, Oct 18"** (fourth review, item 12):
 * the rostered people who said they are away on a day this departure meets,
 * each with those days. Null when nobody is. Said whether or not the crew is
 * the week's usual one, because the usual crew being away is exactly the case
 * a habit hides. Informs, never gates: nobody is taken off the departure.
 */
function crewAwayLine(
  members: readonly { name: string; away: readonly AvailabilityBlock[] }[] | undefined,
  st: StaffTranslator,
  locale: string,
): string | null {
  const away = (members ?? []).filter((member) => member.away.length > 0);
  if (away.length === 0) return null;
  return away
    .map((member) =>
      st("schedule.week.crewAway", {
        name: member.name,
        dates: awayDatesText(member.away, locale),
      }),
    )
    .join(" · ");
}
