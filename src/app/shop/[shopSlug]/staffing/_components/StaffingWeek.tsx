import Link from "next/link";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { GroupLabel, groupLabelClass, LedgerRow } from "@/components/ui/ledger";
import { WeekPager } from "@/components/ui/week-pager";
import { fill } from "@/i18n/fill";
import { calendarDateToUtcMidnight } from "@/lib/calendar-date";
import {
  formatDayParts,
  formatShortDate,
  formatTime,
  formatTimeRange,
  formatTimeRangeTz,
} from "@/lib/format";
import {
  GAP_TONE,
  type PlacedGap,
  type PlacedTrip,
  type StaffGapCode,
  type StaffWeek,
  type WeekShift,
} from "@/lib/staffing-week";

/**
 * **Staffing as a week** — ADR 20260827-the-shops-shelves, decision 3, which
 * this component exists to satisfy and must not drift from: people as rows,
 * days as columns, shifts as quiet chips, and *a departure needing crew
 * rendering in its day cell with the warning word and its act*. The two
 * identical card grids it replaces said who was working and never said when,
 * and the one operational fact the page had — "3 departures still need crew" —
 * was a sentence with nowhere to go.
 *
 * Three rules worth naming, because each is the reason a line here looks the
 * way it does:
 *
 * - **The gap carries a word, not just a hue.** Every gap chip spells its
 *   reason in Today's own words ("No crew", "Under target", or the two ratio
 *   words), so the state survives a monochrome screen and a colour-blind
 *   reader. The warning glyph and the tint go with the loud ones only — the
 *   shop's own target binds nothing, so drawing it as an alarm would spend the
 *   one warning channel this surface has on advice (`GAP_TONE`).
 * - **Credentials are not here.** They are the quiet ledger beneath this
 *   (`StaffCredentials`), and nothing in this grid is gated by one — H-59's
 *   clocks inform, never gate.
 * - **The grid is not the phone.** Below `lg` the same week renders as a day
 *   list, people under each day: seven columns of time ranges have no honest
 *   390px form (the same call H-63 made for the schedule board). Both
 *   renderings carry the same acts, so nothing is lost by being on a phone.
 *
 * Everything arrives already localized and already formatted for the shop's
 * zone. It renders no state: the per-shift disclosure is a native `<details>`,
 * so keyboard and screen-reader semantics come free and a JS failure still
 * leaves Remove one tap away.
 */
export type StaffingWeekWords = {
  /** Names the grid to a screen reader. */
  ariaLabel: string;
  previous: string;
  next: string;
  thisWeek: string;
  today: string;
  /** The header of the person column — visually empty, never nameless. */
  person: string;
  /** The gap row's own label. */
  needsCrew: string;
  /** "Assign", the gap's one act. */
  assign: string;
  /** "Assign crew to {trip}" — what that link is called out of context. */
  assignAria: string;
  /** "Crewing" — what a departure chip is, said to a screen reader only. */
  crewing: string;
  remove: string;
  removing: string;
  /** "{person}, {day}" — names a day's shift disclosure. */
  shiftAria: string;
  /** The whole week, nobody scheduled and nothing to crew. */
  empty: string;
};

export type StaffingWeekLinks = {
  rangeLabel: string;
  previousHref: string;
  nextHref: string;
  /** Null while the week on screen is the one the shop is in. */
  thisWeekHref: string | null;
};

/** The one word a gap code renders as, resolved by the page. */
export type GapWords = Record<StaffGapCode, string>;

function tripHref(shopSlug: string, tripId: string) {
  return `/shop/${shopSlug}/trips/${tripId}#crew`;
}

/**
 * A shift at rest: the range, and the note if there is one. `text-muted` on a
 * day already behind the shop sets the past down without dimming the fill
 * underneath it — an `opacity` on the whole cell would take the warning ink in
 * the gap row below AA with it.
 */
function ShiftFace({
  shift,
  locale,
  timeZone,
  isPast,
}: {
  shift: WeekShift;
  locale: string;
  timeZone: string;
  isPast: boolean;
}) {
  return (
    <span className={`flex flex-col ${isPast ? "text-muted" : ""}`}>
      <span className="font-semibold tabular-nums">
        {formatTimeRange(shift.startsAt, shift.endsAt, locale, timeZone)}
      </span>
      {shift.note ? <span className="font-medium text-muted">{shift.note}</span> : null}
    </span>
  );
}

const CHIP_CLASS =
  "flex w-full flex-col gap-px rounded-lg bg-surface-sunken px-2 py-1.5 text-start text-xs";

/**
 * One shift in a day cell. A manager gets the disclosure — the chip is the
 * summary, and it opens onto the shift's zoned range and its one act. Everyone
 * else gets the same chip with nothing to press, because a control that
 * refuses is worse than a control that is not there.
 */
function ShiftChip({
  shift,
  personName,
  dayLabel,
  locale,
  timeZone,
  isPast,
  canManage,
  words,
  deleteShiftAction,
}: {
  shift: WeekShift;
  personName: string;
  dayLabel: string;
  locale: string;
  timeZone: string;
  isPast: boolean;
  canManage: boolean;
  words: StaffingWeekWords;
  deleteShiftAction: (formData: FormData) => void;
}) {
  const face = <ShiftFace shift={shift} locale={locale} timeZone={timeZone} isPast={isPast} />;
  if (!canManage) return <span className={CHIP_CLASS}>{face}</span>;
  return (
    <details className="group/shift w-full">
      <summary
        aria-label={fill(words.shiftAria, { person: personName, day: dayLabel })}
        className={`${CHIP_CLASS} cursor-pointer list-none transition-colors [&::-webkit-details-marker]:hidden hover:bg-surface-sunken/70`}
      >
        {face}
      </summary>
      {/* The facts the chip could not fit, then the one act. The zone is
          spelled out here and nowhere else on the grid: seven columns of
          "EDT" would be the same word said 40 times. */}
      <div className="mt-1 flex flex-col items-start gap-1 ps-2">
        <span className="text-xs text-muted tabular-nums">
          {formatTimeRangeTz(shift.startsAt, shift.endsAt, locale, timeZone)}
        </span>
        <form action={deleteShiftAction}>
          <input type="hidden" name="shiftId" value={shift.id} />
          <SubmitButton
            pendingLabel={words.removing}
            className={buttonClass({ variant: "ghost", size: "sm", className: "-ms-2" })}
          >
            {words.remove}
          </SubmitButton>
        </form>
      </div>
    </details>
  );
}

/**
 * The quieter chip kind: a departure this person crews. It is deliberately not
 * a shift — a boat with nobody's shift against it is exactly what the
 * cross-link exists to show (task 165) — so it is drawn in the door's own ink
 * and says where it goes.
 */
function CrewChip({
  trip,
  shopSlug,
  locale,
  timeZone,
  words,
}: {
  trip: PlacedTrip;
  shopSlug: string;
  locale: string;
  timeZone: string;
  words: StaffingWeekWords;
}) {
  return (
    <Link
      href={tripHref(shopSlug, trip.tripId)}
      className="flex w-full flex-col gap-px rounded-lg border border-primary/25 bg-primary-tint px-2 py-1.5 text-xs text-primary transition-colors hover:bg-primary-tint/70"
    >
      <span className="sr-only">{words.crewing}: </span>
      <span className="font-semibold tabular-nums">
        {formatTimeRange(trip.startsAt, trip.endsAt, locale, timeZone)}
      </span>
      <span className="font-medium">{trip.title}</span>
    </Link>
  );
}

/**
 * The loudest thing this surface says, in the day it is about: which departure
 * is short-handed, why, and the door that fixes it. Glyph and word together —
 * hue is never the whole signal — and the act is inside the chip rather than
 * in a banner at the top of the page, which is the whole point of the week.
 *
 * **Not every gap is loud.** `crew_below_target` is the shop's own target,
 * which binds nothing (src/lib/divemaster-ratio.ts), so it draws in the quiet
 * ink Today gives it rather than in the warning fill reserved for a departure
 * with nobody in the water. The word is present either way; only the volume
 * changes (`GAP_TONE`, src/lib/staffing-week.ts).
 */
function GapChip({
  gap,
  shopSlug,
  locale,
  timeZone,
  gapWords,
  words,
}: {
  gap: PlacedGap;
  shopSlug: string;
  locale: string;
  timeZone: string;
  gapWords: GapWords;
  words: StaffingWeekWords;
}) {
  const loud = GAP_TONE[gap.gap] === "warning";
  const ink = loud ? "text-warning-strong" : "text-muted";
  return (
    <div
      className={`flex w-full flex-col gap-1 rounded-lg px-2 py-1.5 text-xs ${loud ? "bg-warning-tint" : "bg-surface-sunken"}`}
    >
      <span className={`flex items-start gap-1.5 font-semibold ${ink}`}>
        {loud ? <DiveDayIcon name="warning" className="mt-0.5 size-3.5 shrink-0" /> : null}
        <span>
          {/* The departure time alone, not its range: the cell is ~120px and
              the question here is which boat, not how long it is out. */}
          <span className="tabular-nums">{formatTime(gap.startsAt, locale, timeZone)}</span>{" "}
          {gap.title}
        </span>
      </span>
      <span className={ink}>{gapWords[gap.gap]}</span>
      <Link
        href={tripHref(shopSlug, gap.tripId)}
        aria-label={fill(words.assignAria, { trip: gap.title })}
        className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
      >
        {words.assign}
        <DiveDayIcon name="chevron-right" className="size-3" />
      </Link>
    </div>
  );
}

const GRID_CLASS = "grid grid-cols-[9rem_repeat(7,minmax(0,1fr))]";

export function StaffingWeek({
  week,
  gapWords,
  words,
  links,
  locale,
  timeZone,
  shopSlug,
  canManage,
  deleteShiftAction,
}: {
  week: StaffWeek;
  gapWords: GapWords;
  words: StaffingWeekWords;
  links: StaffingWeekLinks;
  locale: string;
  timeZone: string;
  shopSlug: string;
  canManage: boolean;
  deleteShiftAction: (formData: FormData) => void;
}) {
  // A calendar date has no instant in it, so every day label is formatted
  // through a UTC-midnight reference rather than converted from the shop's
  // zone — which would only risk shifting a column onto the wrong day. The
  // *contents* of a column are a different question, and they are bucketed in
  // the shop's zone by `staffWeek` before they ever reach here.
  const dayFaces = week.days.map((day) => {
    const instant = calendarDateToUtcMidnight(day.date);
    const parts = formatDayParts(instant, locale, "UTC");
    return { ...day, ...parts, label: formatShortDate(instant, locale, "UTC") };
  });

  return (
    <section aria-label={words.ariaLabel}>
      <WeekPager
        rangeLabel={links.rangeLabel}
        previousHref={links.previousHref}
        nextHref={links.nextHref}
        thisWeekHref={links.thisWeekHref}
        words={words}
      />

      {/* ---- The grid, from `lg` up. The bottom hairline is the container's,
          so the ledger closes itself whether or not the gap row is there. */}
      <div className="mt-4 hidden border-t border-b border-border lg:block">
        <div className={GRID_CLASS}>
          <div className="px-2 pt-3 pb-2">
            <span className="sr-only">{words.person}</span>
          </div>
          {dayFaces.map((day) => (
            <div key={day.date} className="border-s border-border px-2 pt-3 pb-2">
              {/* `h2`, not `h3`: the page's own `<h1>` is directly above and a
                  skipped level is an axe `heading-order` failure on a route
                  e2e/a11y.spec.ts scans. */}
              <h2 className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="sr-only">{day.label}</span>
                <span aria-hidden="true" className="flex flex-wrap items-baseline gap-x-1.5">
                  {/* A day column is a ledger group and wears the one group-label
                      spelling (`groupLabelClass`), primary on the current day. */}
                  <span className={groupLabelClass(day.isToday ? "primary" : "muted")}>
                    {day.weekday} {day.day}
                  </span>
                  {/* Today is the word as well as the ink. */}
                  {day.isToday ? (
                    <span className="text-xs font-semibold text-primary">{words.today}</span>
                  ) : null}
                </span>
              </h2>
            </div>
          ))}
        </div>

        {week.people.map((person) => (
          <div key={person.personId} className={`${GRID_CLASS} border-t border-border`}>
            <div className="px-2 py-3">
              <p className="text-sm font-semibold">{person.name}</p>
              {person.roles.length > 0 ? (
                <p className="text-xs text-muted">{person.roles.join(" · ")}</p>
              ) : null}
            </div>
            {person.days.map((cell, index) => {
              const day = week.days[index];
              return (
                <div
                  key={cell.date}
                  className="flex flex-col items-start gap-1 border-s border-border px-1.5 py-2"
                >
                  {cell.shifts.map((shift) => (
                    <ShiftChip
                      key={shift.id}
                      shift={shift}
                      personName={person.name}
                      dayLabel={dayFaces[index]?.label ?? cell.date}
                      locale={locale}
                      timeZone={timeZone}
                      isPast={day?.isPast ?? false}
                      canManage={canManage}
                      words={words}
                      deleteShiftAction={deleteShiftAction}
                    />
                  ))}
                  {cell.crewing.map((trip) => (
                    <CrewChip
                      key={trip.tripId}
                      trip={trip}
                      shopSlug={shopSlug}
                      locale={locale}
                      timeZone={timeZone}
                      words={words}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        ))}

        {/* The gap row renders only when a departure is short-handed. A row of
            seven empty cells under "Needs crew" would be the page saying
            nothing at the volume of something. */}
        {week.hasGaps ? (
          <div className={`${GRID_CLASS} border-t border-border`}>
            <div className="px-2 py-3">
              <p className="text-sm font-semibold text-muted">{words.needsCrew}</p>
            </div>
            {week.gapDays.map((cell) => (
              <div
                key={cell.date}
                className="flex flex-col items-start gap-1 border-s border-border px-1.5 py-2"
              >
                {cell.gaps.map((gap) => (
                  <GapChip
                    key={gap.tripId}
                    gap={gap}
                    shopSlug={shopSlug}
                    locale={locale}
                    timeZone={timeZone}
                    gapWords={gapWords}
                    words={words}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* ---- The same week as a day list, below `lg`. Days with nothing in
          them are absent rather than empty: the reader is paging a week, and
          "Wednesday, nothing" seven times is chrome. */}
      <div className="mt-4 lg:hidden">
        {dayFaces.map((day, index) => {
          const rows = week.people
            .map((person) => ({ person, cell: person.days[index] }))
            .filter(({ cell }) => cell && (cell.shifts.length > 0 || cell.crewing.length > 0));
          const gaps = week.gapDays[index]?.gaps ?? [];
          if (rows.length === 0 && gaps.length === 0) return null;
          return (
            <div key={day.date} className="mt-6 first:mt-0">
              {/* `h2` for the same reason the grid's day headers are: the
                  page's `<h1>` is the level directly above this. */}
              <GroupLabel as="h2" tone={day.isToday ? "primary" : "muted"}>
                {day.label}
                {day.isToday ? ` · ${words.today}` : ""}
              </GroupLabel>
              <ul className="mt-2">
                {rows.map(({ person, cell }) => (
                  <LedgerRow key={person.personId} stacked>
                    <p className="text-sm font-semibold">{person.name}</p>
                    <div className="mt-1 flex flex-col gap-1">
                      {cell?.shifts.map((shift) => (
                        <div
                          key={shift.id}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <ShiftFace
                            shift={shift}
                            locale={locale}
                            timeZone={timeZone}
                            isPast={day.isPast}
                          />
                          {canManage ? (
                            <form action={deleteShiftAction}>
                              <input type="hidden" name="shiftId" value={shift.id} />
                              <SubmitButton
                                pendingLabel={words.removing}
                                className={buttonClass({ variant: "ghost", size: "sm" })}
                              >
                                {words.remove}
                              </SubmitButton>
                            </form>
                          ) : null}
                        </div>
                      ))}
                      {cell?.crewing.map((trip) => (
                        <Link
                          key={trip.tripId}
                          href={tripHref(shopSlug, trip.tripId)}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          <span className="sr-only">{words.crewing}: </span>
                          <span className="tabular-nums">
                            {formatTimeRange(trip.startsAt, trip.endsAt, locale, timeZone)}
                          </span>{" "}
                          {trip.title}
                        </Link>
                      ))}
                    </div>
                  </LedgerRow>
                ))}
                {gaps.map((gap) => (
                  <LedgerRow
                    key={gap.tripId}
                    kind={{ word: words.needsCrew, tone: GAP_TONE[gap.gap] }}
                    stacked
                    trailing={
                      <Link
                        href={tripHref(shopSlug, gap.tripId)}
                        aria-label={fill(words.assignAria, { trip: gap.title })}
                        className={buttonClass({ variant: "link", size: "sm" })}
                      >
                        {words.assign}
                      </Link>
                    }
                  >
                    <p className="text-sm">
                      <span className="tabular-nums">
                        {formatTime(gap.startsAt, locale, timeZone)}
                      </span>{" "}
                      <span className="font-medium">{gap.title}</span>
                    </p>
                    <p
                      className={`text-sm font-medium ${
                        GAP_TONE[gap.gap] === "warning" ? "text-warning-strong" : "text-muted"
                      }`}
                    >
                      {gapWords[gap.gap]}
                    </p>
                  </LedgerRow>
                ))}
              </ul>
            </div>
          );
        })}
        {/* One honest line when the whole week is blank on a phone, where the
            grid's own emptiness is not visible to say it. */}
        {!week.hasEntries && !week.hasGaps ? (
          <p className="text-sm text-muted">{words.empty}</p>
        ) : null}
      </div>
    </section>
  );
}
