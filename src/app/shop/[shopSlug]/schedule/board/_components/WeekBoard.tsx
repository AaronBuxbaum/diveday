"use client";

import Link from "next/link";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";
import { fill } from "@/i18n/fill";

/**
 * One departure in a day column. Everything a cell renders is already
 * formatted for the reader's locale and the shop's zone — a column 160px wide
 * has no room to be wrong about a time, and a Client Component may format
 * neither.
 */
export type WeekEntry = {
  tripId: string;
  /** `YYYY-MM-DD` in the shop's timezone — the column this entry sits in. */
  dateIso: string;
  /** `HH:mm`, for the move/copy panels this entry can open. */
  startTime: string;
  title: string;
  /** Preformatted departure time, e.g. "7:00 AM". */
  time: string;
  /** "10 of 12 · $95", or "Sailed · 9 of 12" for a boat already home. */
  meta: string;
  dayCount: number;
  status: "upcoming" | "sailed";
  /** No price has ever been set — the one warning a cell carries. */
  unpriced: boolean;
  /** "{title}, {day} {time}" — what names this departure to a screen reader. */
  ref: string;
};

/** A multi-day course session as one bar across the columns it owns. */
export type WeekSpan = {
  tripId: string;
  title: string;
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
  words: { previous: string; next: string; thisWeek: string; today: string };
  days: WeekDay[];
  spans: WeekSpan[];
};

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
  };
}) {
  return (
    <section aria-label={week.ariaLabel} className="hidden xl:block">
      {/* Paging is by week, so the control is a pair of steps and a way home
          — not a cursor. Links, not buttons: each one is a whole reading of
          the board and belongs in the URL a staffer can keep open. */}
      <div className="flex items-center gap-2">
        <Link
          href={week.previousHref}
          scroll={false}
          aria-label={week.words.previous}
          className={buttonClass({ variant: "secondary", size: "icon" })}
        >
          <DiveDayIcon name="chevron-left" />
        </Link>
        <Link
          href={week.nextHref}
          scroll={false}
          aria-label={week.words.next}
          className={buttonClass({ variant: "secondary", size: "icon" })}
        >
          <DiveDayIcon name="chevron-right" />
        </Link>
        <p className="ms-2 text-base font-semibold tracking-tight tabular-nums">
          {week.rangeLabel}
        </p>
        {/* Absent while it would only reload the week already on screen. */}
        {week.thisWeekHref ? (
          <Link
            href={week.thisWeekHref}
            scroll={false}
            className={buttonClass({ variant: "link", size: "sm" })}
          >
            {week.words.thisWeek}
          </Link>
        ) : null}
      </div>

      {/* When *every* departure still to sail this week is unpriced, the
          per-cell warning is the same fact on seven cells. Said once here
          instead; the cells keep their mark only while some are priced and
          some are not, which is when a per-cell mark distinguishes anything. */}
      {week.allUnpriced ? (
        <p className="mt-4 rounded-xl border border-warning/40 bg-surface p-4 text-sm font-medium text-warning">
          {copy.noPriceSetAll}
        </p>
      ) : null}

      <div className="mt-4 border-t border-border">
        <div className="grid grid-cols-7">
          {week.days.map((day) => (
            <div
              key={day.dateIso}
              className={`px-2 pt-3 pb-2 ${day.dateIso === week.days[0]?.dateIso ? "" : "border-s border-border"}`}
            >
              <h3 className="flex items-center gap-2">
                <span className="sr-only">{day.label}</span>
                <span aria-hidden="true" className="flex items-center gap-2">
                  <span
                    className={`text-xs font-semibold tracking-[0.14em] uppercase ${
                      day.isToday ? "text-primary" : "text-muted"
                    }`}
                  >
                    {day.weekday}
                  </span>
                  {/* Today is a filled disc *and* the word — colour is never
                      the only thing carrying a state. */}
                  {day.isToday ? (
                    <span className="text-xs font-semibold text-primary">{week.words.today}</span>
                  ) : null}
                </span>
              </h3>
              <p
                aria-hidden="true"
                className={`mt-1 text-lg font-bold tabular-nums ${
                  day.isToday
                    ? "flex size-7 items-center justify-center rounded-full bg-primary text-base text-primary-foreground"
                    : day.isPast
                      ? "text-muted"
                      : ""
                }`}
              >
                {day.dayNumber}
              </p>
            </div>
          ))}
        </div>

        {/* A multi-day course owns its days rather than repeating in them. */}
        {week.spans.map((span) => (
          <div key={span.tripId} className="grid grid-cols-7">
            <div
              style={{ gridColumn: `${span.startColumn} / span ${span.columnSpan}` }}
              className="mx-2 mb-1.5 flex items-center gap-3 rounded-xl border border-primary/25 bg-primary-tint px-3 py-2"
            >
              <Link
                href={`/shop/${shopSlug}/trips/${span.tripId}`}
                className="min-w-0 truncate text-sm font-semibold text-primary hover:underline"
              >
                {span.title}
              </Link>
              <span className="ms-auto shrink-0 text-xs font-medium text-primary tabular-nums">
                {span.meta}
              </span>
            </div>
          </div>
        ))}

        <div className="grid min-h-80 grid-cols-7">
          {week.days.map((day) => (
            <div
              key={day.dateIso}
              className={`pt-1 pb-3 ${day.dateIso === week.days[0]?.dateIso ? "" : "border-s border-border"}`}
            >
              {/* No per-cell "nothing here" copy: an empty column is the
                  information this grid exists to show. */}
              <ul className="flex flex-col">
                {day.entries.map((entry) => (
                  <li key={entry.tripId} className="px-2 pb-2">
                    <div
                      className={`rounded-xl border px-3 py-2.5 ${
                        entry.status === "sailed"
                          ? "border-border bg-surface-sunken"
                          : "border-border bg-surface"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <p
                          className={`text-xs font-bold tabular-nums ${
                            entry.status === "sailed" ? "text-muted" : ""
                          }`}
                        >
                          {entry.time}
                        </p>
                        {/* Move / copy / remove carry over from the stream —
                            the board is the only place they exist. A boat
                            already home is refused all three by
                            src/db/trips-schedule.ts, so it is offered none. */}
                        {canConfigure && entry.status === "upcoming" ? (
                          <button
                            type="button"
                            ref={registerToggle(`w:menu:${entry.tripId}`)}
                            onClick={() => onToggle(`w:menu:${entry.tripId}`)}
                            aria-expanded={openKey === `w:menu:${entry.tripId}`}
                            aria-label={fill(copy.rowActionsAria, { ref: entry.ref })}
                            className={buttonClass({
                              variant: "ghost",
                              size: "sm",
                              className: "-mt-1 -me-2 min-w-11",
                            })}
                          >
                            <DiveDayIcon name="more" className="size-4" />
                          </button>
                        ) : null}
                      </div>
                      <Link
                        href={`/shop/${shopSlug}/trips/${entry.tripId}`}
                        className={`mt-0.5 line-clamp-2 text-sm leading-snug font-semibold hover:text-primary ${
                          entry.status === "sailed" ? "text-muted" : ""
                        }`}
                      >
                        {entry.title}
                      </Link>
                      <p className="mt-1 text-xs text-muted tabular-nums">{entry.meta}</p>
                      {/* The one toned mark a cell can carry, and only while
                          the departure can still be booked. Glyph and word
                          together: hue is never the whole signal. */}
                      {entry.unpriced && entry.status === "upcoming" ? (
                        <Link
                          href={`/shop/${shopSlug}/trips/${entry.tripId}#details`}
                          aria-label={fill(copy.noPriceSetAria, { ref: entry.ref })}
                          className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-warning-strong hover:underline"
                        >
                          <DiveDayIcon name="warning" className="size-3.5" />
                          {copy.noPriceSet}
                        </Link>
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
