"use client";

import Link from "next/link";
import { SiteMark } from "@/components/illustration/SiteMark";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";
import { groupLabelClass } from "@/components/ui/ledger";
import { WeekPager } from "@/components/ui/week-pager";
import { fill } from "@/i18n/fill";
import type { SiteMarkCode } from "@/lib/site-mark";

/**
 * What every departure the grid draws — a day cell or a spanning course bar —
 * has to say about itself, because both of them open the *same* move, copy and
 * remove panels and carry the same price flag. Kept as one type rather than
 * two overlapping ones: the bar losing an action the cell has is exactly the
 * regression that shipped in this slice's first commit.
 *
 * Everything here is already formatted for the reader's locale and the shop's
 * zone — a column 160px wide has no room to be wrong about a time, and a
 * Client Component may format neither.
 */
export type WeekDeparture = {
  tripId: string;
  /**
   * `YYYY-MM-DD` in the shop's timezone. For a cell, the column it sits in;
   * for a span, the departure's own **first** day, which may be earlier than
   * the week on screen — the move panel is about the course, not the columns.
   */
  dateIso: string;
  /** `HH:mm`, for the move/copy panels this departure can open. */
  startTime: string;
  title: string;
  /** How many days it runs; 1 for a day cell, 2+ for a span. */
  dayCount: number;
  status: "upcoming" | "sailed";
  /** No price has ever been set — the quieter of the two marks a departure carries. */
  unpriced: boolean;
  /**
   * The boat is back and somebody on its list was never counted (DOM-H3) —
   * **the loudest thing this board can say**, and it outranks the price flag
   * rather than stacking with it. It renders in both compositions or the
   * desktop board becomes the quietest place in the app to notice a diver
   * nobody has accounted for.
   */
  rollCallOpen: { diveNumber: number; uncounted: number } | null;
  /** "{title}, {day} {time}" — what names this departure to a screen reader. */
  ref: string;
};

/** One departure in a day column. */
export type WeekEntry = WeekDeparture & {
  /** Preformatted departure time, e.g. "7:00 AM". */
  time: string;
  /** Which drawing marks it — read off the site's name (`siteMarkFor`). */
  mark: SiteMarkCode;
  /** "10 of 12 · $95", or "Sailed · 9 of 12" for a boat already home. */
  meta: string;
};

/** A multi-day course session as one bar across the columns it owns. */
export type WeekSpan = WeekDeparture & {
  /** "4 of 5 · $595 · Marcus Webb". */
  meta: string;
  /** 1-based column the bar starts in, and how many columns it covers. */
  startColumn: number;
  columnSpan: number;
};

export type WeekDay = {
  dateIso: string;
  /** Preformatted: "Mon", "24", and the whole date for a screen reader. */
  weekday: string;
  dayNumber: string;
  label: string;
  isToday: boolean;
  /** The shop's own calendar day is already behind this one. */
  isPast: boolean;
  /**
   * "More departures than boats", or one hull in two places — the board's own
   * question, asked of this column. Null on a day that is fine, and on a shop
   * that runs no boats.
   */
  boatWarning: string | null;
  entries: WeekEntry[];
};

/** Everything the week grid needs, assembled server-side. */
export type BuilderWeek = {
  ariaLabel: string;
  /** "Aug 24 – 30, 2026". */
  rangeLabel: string;
  previousHref: string;
  nextHref: string;
  /** Null while the board is already showing the current week. */
  thisWeekHref: string | null;
  /**
   * Every departure still to sail in this week is unpriced. Said once above
   * the grid instead of on each of seven cells (principle 9) — the grid's own
   * gate, computed over the week, since the stream's is computed over a
   * cursor page that reaches different departures.
   */
  allUnpriced: boolean;
  /**
   * Where the next departure is, when *this* week has none. Null whenever the
   * week has something in it — and the grid never renders at all on a board
   * with nothing upcoming anywhere.
   */
  nextDeparture: { label: string; href: string } | null;
  words: { previous: string; next: string; thisWeek: string; today: string };
  days: WeekDay[];
  spans: WeekSpan[];
};

/**
 * Move / copy / remove, on whichever shape draws the departure. **A course bar
 * wears the same one as a day cell**: the bar deliberately replaces the entries
 * for the days it owns, so without this the desktop board is the one place in
 * the app where a multi-day course cannot be moved at all — a capability the
 * stream underneath still has. It opens the board's own panels; a boat already
 * home is refused all three by `src/db/trips-schedule.ts`, so it is offered
 * none.
 */
function RowActions({
  departure,
  openKey,
  onToggle,
  registerToggle,
  label,
  className,
}: {
  departure: WeekDeparture;
  openKey: string | null;
  onToggle: (key: string) => void;
  registerToggle: (key: string) => (el: HTMLButtonElement | null) => void;
  label: string;
  className: string;
}) {
  const key = `w:menu:${departure.tripId}`;
  return (
    <button
      type="button"
      ref={registerToggle(key)}
      onClick={() => onToggle(key)}
      aria-expanded={openKey === key}
      aria-label={fill(label, { ref: departure.ref })}
      className={buttonClass({ variant: "ghost", size: "sm", className })}
    >
      <DiveDayIcon name="more" className="size-4" />
    </button>
  );
}

/**
 * "None of these has a price yet", once. Both compositions say it and both
 * said it in their own hand-typed markup until the two drifted apart in
 * review; one element now, and the caller supplies only the width it belongs
 * to (`xl:hidden` on the stream's, nothing on the grid's).
 */
export function AllUnpricedNotice({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  return (
    <p
      className={`mt-4 rounded-inset border border-warning/40 bg-surface p-4 text-sm font-medium text-warning ${className}`.trim()}
    >
      {children}
    </p>
  );
}

/**
 * **The loudest thing this board can say** (DOM-H3): the boat is back and
 * somebody on its list was never counted. It is the same fact, the same tone
 * and the same destination as the stream's row badge — a departure that
 * shouted at 1279px and went quiet at 1280 would make the desktop board the
 * worst place in the app to notice a diver nobody has accounted for.
 *
 * Drawn mark and words together, never hue alone, and it **outranks** the
 * price flag rather than stacking with it: one slot, one grammar (issue 758,
 * the same call the stream made).
 */
function RollCallFlag({
  departure,
  shopSlug,
  copy,
  className,
}: {
  departure: WeekDeparture & { rollCallOpen: { diveNumber: number; uncounted: number } };
  shopSlug: string;
  copy: { rollCallOpen: string; rollCallOpenAria: string };
  className: string;
}) {
  return (
    <Link
      href={`/shop/${shopSlug}/trips/${departure.tripId}/manifest?checkpoint=after_dive_${departure.rollCallOpen.diveNumber}`}
      aria-label={fill(copy.rollCallOpenAria, {
        ref: departure.ref,
        dive: departure.rollCallOpen.diveNumber,
      })}
      className={`flex items-center gap-1.5 text-xs font-semibold text-danger hover:underline ${className}`}
    >
      <DiveDayIcon name="warning" className="size-3.5" />
      {fill(copy.rollCallOpen, { count: departure.rollCallOpen.uncounted })}
    </Link>
  );
}

/**
 * The quieter toned mark, and only while the departure can still be booked.
 * Glyph and word together: hue is never the whole signal. It is absent when
 * the week's warning has collapsed into the banner above the grid — the
 * caller decides that, once, over the whole week — and when the roll-call
 * flag above has the slot.
 */
function PriceFlag({
  departure,
  shopSlug,
  copy,
  className,
}: {
  departure: WeekDeparture;
  shopSlug: string;
  copy: { noPriceSet: string; noPriceSetAria: string };
  className: string;
}) {
  return (
    <Link
      href={`/shop/${shopSlug}/trips/${departure.tripId}#details`}
      aria-label={fill(copy.noPriceSetAria, { ref: departure.ref })}
      className={`flex items-center gap-1.5 text-xs font-semibold text-warning-strong hover:underline ${className}`}
    >
      <DiveDayIcon name="warning" className="size-3.5" />
      {copy.noPriceSet}
    </Link>
  );
}

/**
 * The staff board as a **week** — seven columns, one per day, at `xl` (1280px)
 * and up only. Below that the vertical day stream renders instead, unchanged
 * (H-63, 2026-08-27).
 *
 * **This component must not drift from ADR
 * 20260827-clearwater-surface-language, decision 5**, which is what it exists
 * to satisfy: a week of departures read as seven columns rather than as
 * ~2,700px of scroll, a multi-day course drawn once as a spanning bar rather
 * than once per day it covers, today marked, past days set down. The
 * cursor-paged stream underneath is a different reading of the same rows and
 * keeps its own contract; this pages by `?week=` (`src/lib/week-board.ts`) and
 * the two deliberately never mix.
 *
 * Nothing here holds state. The disclosures a cell opens — the day's add
 * panel, a departure's move/copy/remove — are the board's own, keyed with a
 * `w:` prefix so a control in this grid hands focus back to itself rather
 * than to its twin in the hidden stream.
 */
export function WeekBoard({
  week,
  canConfigure,
  shopSlug,
  openKey,
  onToggle,
  registerToggle,
  copy,
}: {
  week: BuilderWeek;
  canConfigure: boolean;
  shopSlug: string;
  openKey: string | null;
  onToggle: (key: string) => void;
  registerToggle: (key: string) => (el: HTMLButtonElement | null) => void;
  copy: {
    add: string;
    addDepartureOnDay: string;
    rowActionsAria: string;
    noPriceSet: string;
    noPriceSetAria: string;
    noPriceSetAll: string;
    rollCallOpen: string;
    rollCallOpenAria: string;
  };
}) {
  return (
    <section aria-label={week.ariaLabel} className="hidden xl:block">
      {/* Paging is by week, so the control is a pair of steps and a way home
          — not a cursor. The control itself is `WeekPager`
          (src/components/ui/week-pager.tsx), shared with the staffing week,
          which reads the same `?week=` parameter over the same dates. */}
      <WeekPager
        rangeLabel={week.rangeLabel}
        previousHref={week.previousHref}
        nextHref={week.nextHref}
        thisWeekHref={week.thisWeekHref}
        words={week.words}
      />

      {/* When *every* departure still to sail this week is unpriced, the
          per-cell warning is the same fact on seven cells. Said once here
          instead; the cells keep their mark only while some are priced and
          some are not, which is when a per-cell mark distinguishes anything. */}
      {week.allUnpriced ? <AllUnpricedNotice>{copy.noPriceSetAll}</AllUnpricedNotice> : null}

      <div className="mt-4 border-t border-border">
        <div className="grid grid-cols-7">
          {week.days.map((day) => (
            <div
              key={day.dateIso}
              className={`px-2 pt-3 pb-2 ${day.dateIso === week.days[0]?.dateIso ? "" : "border-s border-border"}`}
            >
              <h3 id={`week-day-${day.dateIso}`} className="flex items-center gap-2">
                <span className="sr-only">{day.label}</span>
                <span aria-hidden="true" className="flex items-center gap-2">
                  {/* A day column is a ledger group, and its header wears the
                      one group-label spelling — `groupLabelClass`
                      (src/components/ui/ledger.tsx), which owns the tracking
                      value and the ink together so neither is re-spelled here
                      (ADR 20260827-clearwater-surface-language, decision 3). */}
                  <span className={groupLabelClass(day.isToday ? "primary" : "muted")}>
                    {day.weekday}
                  </span>
                  {/* Today is a filled disc *and* the word — colour is never
                      the only thing carrying a state. */}
                  {day.isToday ? (
                    <span className="text-xs font-semibold text-primary">{week.words.today}</span>
                  ) : null}
                </span>
              </h3>
              {/* The disc is a *filled* day, not a smaller one: the numeral
                  keeps the ramp's `text-lg` inside it, and the disc grows to
                  hold it. It read one step down from every other column —
                  the emphasized day rendered smaller than its neighbours. */}
              <p
                aria-hidden="true"
                className={`mt-1 text-lg font-bold tabular-nums ${
                  day.isToday
                    ? "flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground"
                    : day.isPast
                      ? "text-muted"
                      : ""
                }`}
              >
                {day.dayNumber}
              </p>
              {/* More departures than hulls, or one hull in two places — the
                  question the board exists to answer, on the day it is about.
                  Wrapped rather than clipped: a column is 150px and this is
                  not a fact to lose an ellipsis in. */}
              {day.boatWarning ? (
                <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-warning">
                  <DiveDayIcon name="warning" className="mt-0.5 size-3.5 shrink-0" />
                  <span>{day.boatWarning}</span>
                </p>
              ) : null}
            </div>
          ))}
        </div>

        {/* A multi-day course owns its days rather than repeating in them —
            and carries everything a day cell carries, because replacing the
            entries is not the same as removing their controls. */}
        {week.spans.map((span) => (
          <div key={span.tripId} className="grid grid-cols-7">
            <div
              style={{ gridColumn: `${span.startColumn} / span ${span.columnSpan}` }}
              className="mx-2 mb-1.5 flex items-center gap-3 rounded-inset border border-primary/25 bg-primary-tint px-3 py-2"
            >
              {/* `flex-1` from a zero basis, so the title is the part that
                  gives way. Its own words are the ones repeated on the days
                  either side of it; the meta beside it is a roster count and a
                  teacher's name, and there is nothing else on the bar saying
                  either. */}
              <Link
                href={`/shop/${shopSlug}/trips/${span.tripId}`}
                className="min-w-0 flex-1 truncate text-sm font-semibold text-primary hover:underline"
              >
                {span.title}
              </Link>
              {span.rollCallOpen ? (
                <RollCallFlag
                  departure={{ ...span, rollCallOpen: span.rollCallOpen }}
                  shopSlug={shopSlug}
                  copy={copy}
                  className="shrink-0"
                />
              ) : span.unpriced && span.status === "upcoming" ? (
                <PriceFlag departure={span} shopSlug={shopSlug} copy={copy} className="shrink-0" />
              ) : null}
              {/* Capped and clipped, never unshrinkable: a course clamped to
                  one column — one that began before this week, or runs past
                  it — gives the bar a ~150px track, and a `shrink-0` meta both
                  collapsed the title to nothing and spilled into the next
                  column. The cap is what stops it doing that; the clip is what
                  happens when even the cap is too much. */}
              <span className="ms-auto max-w-[55%] shrink-0 truncate text-xs font-medium text-primary tabular-nums">
                {span.meta}
              </span>
              {canConfigure && span.status === "upcoming" ? (
                <RowActions
                  departure={span}
                  openKey={openKey}
                  onToggle={onToggle}
                  registerToggle={registerToggle}
                  label={copy.rowActionsAria}
                  className="-my-1 -me-2 shrink-0"
                />
              ) : null}
            </div>
          </div>
        ))}

        {/* Seven blank columns and no way forward is a dead end: the stream
            that would have listed the next departures is display:none at this
            width. One line, and it is a link to the week that has them. */}
        {week.nextDeparture ? (
          <p className="px-2 py-6 text-sm text-muted">
            <Link href={week.nextDeparture.href} scroll={false} className="hover:underline">
              {week.nextDeparture.label}
            </Link>
          </p>
        ) : null}

        <div className="grid min-h-80 grid-cols-7">
          {week.days.map((day) => (
            <div
              key={day.dateIso}
              className={`pt-1 pb-3 ${day.dateIso === week.days[0]?.dateIso ? "" : "border-s border-border"}`}
            >
              {/* No per-cell "nothing here" copy: an empty column is the
                  information this grid exists to show. Named by its own day
                  header, so seven lists are not seven anonymous ones to a
                  screen reader walking the grid. */}
              <ul aria-labelledby={`week-day-${day.dateIso}`} className="flex flex-col">
                {day.entries.map((entry) => (
                  <li key={entry.tripId} className="px-2 pb-2">
                    {/* Borderless, like the stream's own rows: the column
                        hairlines and the space between entries already divide
                        them, and a box drawn round every departure says
                        permanently what the hover tint says on demand
                        (design/principles.md #10). A returned boat is set
                        down in muted ink and the word "Sailed" in its meta —
                        it needs no fill of its own to say so twice. */}
                    <div className="rounded-lg px-2 py-2 transition-colors hover:bg-surface has-[a:focus-visible]:bg-surface">
                      {/* The drawn site mark leads the cell (ADR
                          20260901-diveday-reimagined, slice 13f): the same
                          hand as the home spine's rail, at the board's size. */}
                      {/* No coral on a board of twenty marks: the budget is one
                          creature's detail per surface, and this surface has no
                          one boat to give it to (`SiteMark`'s `coral`). */}
                      <SiteMark mark={entry.mark} size="sm" coral={false} className="mb-1.5" />
                      <div className="flex items-start justify-between gap-1">
                        {/* Time leads the entry, so it is set on the ramp's
                            row-title step rather than under it — it was the
                            smallest ink in a cell it is supposed to lead. */}
                        <p
                          className={`text-base leading-tight font-semibold tabular-nums ${
                            entry.status === "sailed" ? "text-muted" : ""
                          }`}
                        >
                          {entry.time}
                        </p>
                        {/* Move / copy / remove carry over from the stream —
                            the board is the only place they exist. */}
                        {canConfigure && entry.status === "upcoming" ? (
                          <RowActions
                            departure={entry}
                            openKey={openKey}
                            onToggle={onToggle}
                            registerToggle={registerToggle}
                            label={copy.rowActionsAria}
                            className="-mt-1 -me-2 min-w-11"
                          />
                        ) : null}
                      </div>
                      {/* One line, clipped from the end. Every title in a
                          column shares its prefix ("Dawn Two-Tank — …",
                          "Morning Two-Tank — …"), so two clamped lines spent
                          the cell's height on the half that is the same on
                          every row; the site below is what actually differs
                          and it is stated in full. */}
                      <Link
                        href={`/shop/${shopSlug}/trips/${entry.tripId}`}
                        className={`mt-0.5 block truncate text-sm leading-snug font-semibold hover:text-primary ${
                          entry.status === "sailed" ? "text-muted" : ""
                        }`}
                      >
                        {entry.title}
                      </Link>
                      <p className="mt-1 text-sm text-muted tabular-nums">{entry.meta}</p>
                      {/* One slot, one grammar: an open head count outranks a
                          missing price rather than stacking two marks in a
                          150px column. */}
                      {entry.rollCallOpen ? (
                        <RollCallFlag
                          departure={{ ...entry, rollCallOpen: entry.rollCallOpen }}
                          shopSlug={shopSlug}
                          copy={copy}
                          className="mt-1"
                        />
                      ) : entry.unpriced && entry.status === "upcoming" ? (
                        <PriceFlag
                          departure={entry}
                          shopSlug={shopSlug}
                          copy={copy}
                          className="mt-1"
                        />
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
              {/* Never on a day that has already been: the stream offers no
                  "+ Add" on a past day either, because it does not render one
                  — a departure is put on the board, and the board is ahead. */}
              {canConfigure && !day.isPast ? (
                <button
                  type="button"
                  ref={registerToggle(`w:add:${day.dateIso}`)}
                  onClick={() => onToggle(`w:add:${day.dateIso}`)}
                  aria-expanded={openKey === `w:add:${day.dateIso}`}
                  aria-label={fill(copy.addDepartureOnDay, { day: day.label })}
                  className={buttonClass({
                    variant: "ghost",
                    size: "sm",
                    className: "mx-1 w-[calc(100%-0.5rem)] justify-start",
                  })}
                >
                  <span aria-hidden="true">+</span> {copy.add}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
