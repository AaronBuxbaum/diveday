"use client";

import Link from "next/link";
import { SiteMark } from "@/components/illustration/SiteMark";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";
import { groupLabelClass } from "@/components/ui/ledger";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { FIGURE_INLINE_CLASS } from "@/components/ui/typography";
import { WeekPager } from "@/components/ui/week-pager";
import { fill } from "@/i18n/fill";
import type { SiteMarkCode } from "@/lib/site-mark";
import { isUsualCrew, mostCommonCrew } from "@/lib/usual-crew";
import { isSoldOut, seatFill } from "@/lib/week-seats";

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

/**
 * The seats behind a departure's bar. The formatted `meta` beside it is the
 * sentence a reader gets; these are the two numbers the bar is a picture of,
 * and they are separate because `src/lib/week-seats.ts` cannot parse "10 of
 * 12" and must never have to try.
 */
export type WeekSeats = { booked: number; capacity: number };

/** One departure on a day's row. */
export type WeekEntry = WeekDeparture & {
  /** Preformatted departure time, e.g. "7:00 AM". */
  time: string;
  seats: WeekSeats;
  /** Which drawing marks it — read off the site's name (`siteMarkFor`). */
  mark: SiteMarkCode;
  /** "Molasses Reef · Mantis II · 10 of 12 · $95", or "Sailed · 9 of 12" for a boat already home. */
  meta: string;
  /**
   * **Who is crewing this departure**, in the shop's own order — lead first
   * (#1923). Empty means nobody is assigned, which is the gap the board
   * exists to show and never the same thing as "the usual people".
   *
   * It is the whole assignment rather than a formatted sentence, because the
   * row does not decide on its own whether to print it: `mostCommonCrew` votes
   * over the week and only the departures that differ from the habit say
   * anything. A pre-joined string could not be compared.
   */
  crew: string[];
};

/** A multi-day course session as one bar across the columns it owns. */
export type WeekSpan = WeekDeparture & {
  /** "4 of 5 · $595 · Marcus Webb". */
  meta: string;
  seats: WeekSeats;
  /**
   * "3 days" — how long the course runs, where a boat says when it leaves.
   * Formatted on the server rather than filled from a template here: it needs
   * an ICU plural, and `fill` (`src/i18n/fill.ts`) replaces placeholders
   * without one. A Client Component may format neither a date nor a count.
   */
  runsLabel: string;
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
  /**
   * "62 of 84 seats" — the one number a shop asks a week for, formatted for
   * the reader from `weekSeatTally` (`src/lib/week-seats.ts`). Data rather
   * than copy, because it changes with the week.
   */
  seatTally: string;
  days: WeekDay[];
  spans: WeekSpan[];
  /**
   * **The days in this week nobody put a boat on, that somebody asked for**
   * (ADR 20260919-one-idea, slice 23f — "a request is a day someone asked for,
   * drawn as a ghost on the week"). Empty when there are none, and the section
   * does not render.
   */
  asked: WeekAsk[];
  /** "2 days" — how many are below, said once at the section's head. */
  askedCount: string;
};

/** One day the divers asked for, and the act that answers it. */
export type WeekAsk = {
  dateIso: string;
  /** "Wed, Sep 2 · four people" — the date and the heads, already pluralised. */
  lead: string;
  /** Who asked, in the reader's own list grammar. */
  who: string;
  /** The builder, opened on that day with these leads carried forward. */
  href: string;
};

/**
 * The words the week needs, named once so the three components that draw a
 * row cannot take three different subsets of them.
 */
export type WeekBoardCopy = {
  add: string;
  addDepartureOnDay: string;
  rowActionsAria: string;
  noPriceSet: string;
  noPriceSetAria: string;
  noPriceSetAll: string;
  rollCallOpen: string;
  rollCallOpenAria: string;
  /** What a day with nothing on it says, because a blank row is just a gap. */
  noBoats: string;
  /** The heading over the days somebody asked for. */
  asked: string;
  /** The act that answers one — the Requests page's own word for it. */
  addDeparture: string;
  /** "Crew:" — the lead-in on the one line a departure prints about its people. */
  crewLabel: string;
  /** What stands where the names would be when nobody is assigned. */
  crewNobodyYet: string;
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
/**
 * **A boat's seats as a bar.** Tide's week is a run of days and each boat on
 * one is a time, this, and the count (ADR 20260919-one-idea, decision I ·
 * Tide, slice 23f).
 *
 * `aria-hidden`, because `meta` beside it already says "10 of 12" in words —
 * a bar that also announced itself would say one fact twice, and the words are
 * the half that survives a reader who cannot see a fill. That is the same
 * split `ProgressBar`'s own note describes: it owns the pixels, the caller
 * owns the meaning.
 *
 * A sailed boat's bar is set down in the same muted ink its time and title
 * wear, rather than a fourth colour: the row already says "Sailed".
 */
function SeatBar({ seats, sailed }: { seats: WeekSeats; sailed: boolean }) {
  return (
    <ProgressBar
      aria-hidden="true"
      className="h-1.5 w-14 shrink-0 sm:w-20"
      segments={[
        {
          key: "sold",
          fraction: seatFill(seats),
          // Sold out is a win worth noticing, the same call
          // `TripCapacityBadge` makes: "success" stands out where the ordinary
          // fill recedes. Never the only carrier — the count says 12 of 12.
          className: sailed ? "bg-border-strong" : isSoldOut(seats) ? "bg-success" : "bg-primary",
        },
      ]}
    />
  );
}

/**
 * One departure on a day's row — a boat, or a multi-day course on the day it
 * starts. Both wear the same move/copy/remove menu and the same flags, which
 * is what `WeekDeparture` exists to make unrepresentable otherwise.
 */
function WeekBoat({
  departure,
  seats,
  meta,
  time,
  mark,
  runs,
  crewLine,
  hasUsualCrew,
  shopSlug,
  canConfigure,
  openKey,
  onToggle,
  registerToggle,
  copy,
}: {
  departure: WeekDeparture;
  seats: WeekSeats;
  meta: string;
  /** Preformatted; a course bar has none of its own, so its day leads instead. */
  time: string | null;
  mark: SiteMarkCode | null;
  /** "3 days", on a course that owns more than the day it starts. */
  runs: string | null;
  /**
   * The crew to print, or null to print nothing — the caller has already
   * asked `isUsualCrew`, so this row never re-decides it. `names` is empty for
   * a departure nobody is assigned to, which is a line that renders and not a
   * line that is skipped.
   *
   * **A course bar passes null.** Its `meta` already names who is teaching it
   * (`instructorName`), and a bar that also carried a crew line would say one
   * fact twice on the one shape that has no hull to be about.
   */
  crewLine: { names: string } | null;
  /** Whether the week has a habit at all — decides the line's ink, not its presence. */
  hasUsualCrew: boolean;
  shopSlug: string;
  canConfigure: boolean;
  openKey: string | null;
  onToggle: (key: string) => void;
  registerToggle: (key: string) => (el: HTMLButtonElement | null) => void;
  copy: WeekBoardCopy;
}) {
  const sailed = departure.status === "sailed";
  return (
    <div className="flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-surface has-[a:focus-visible]:bg-surface sm:gap-3">
      {/* The drawn site mark leads the row (ADR 20260901-diveday-reimagined,
          slice 13f). No coral: the budget is one creature's detail per
          surface, and a week has no one boat to give it to. */}
      {mark ? <SiteMark mark={mark} size="sm" coral={false} className="mt-0.5 shrink-0" /> : null}
      <div className="min-w-0 flex-1">
        {/* The lead line is what the canvas draws: when it leaves, how full it
            is, and the count. The bar sits between them rather than after, so
            a reader scanning a column of times meets every fill at one x. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:flex-nowrap sm:gap-x-3">
          {time ? (
            <p
              className={`text-base leading-tight font-semibold tabular-nums ${sailed ? "text-muted" : ""}`}
            >
              {time}
            </p>
          ) : null}
          <SeatBar seats={seats} sailed={sailed} />
          {/* **A full line of its own on a phone, inline from `sm` up.** The
              week was a desktop-only grid until #1923 and this sentence had a
              row's whole measure to sit in; at 390 it has about 120px between
              the seat bar and the "⋯", which truncated "Molasses Reef ·
              Mantis II · 10 of 12 · $95" to "Molas…" — every fact in it lost,
              including the two the bar is a picture of.

              `basis-full order-last` drops it below the controls on a phone
              and `sm:` puts it back where the desktop design has it, so the
              sentence is one node in one place in the reading order rather
              than two copies fighting a media query. */}
          <p className="order-last basis-full text-sm text-muted tabular-nums sm:order-none sm:min-w-0 sm:flex-1 sm:basis-auto sm:truncate">
            {meta}
          </p>
          {canConfigure && !sailed ? (
            <RowActions
              departure={departure}
              openKey={openKey}
              onToggle={onToggle}
              registerToggle={registerToggle}
              label={copy.rowActionsAria}
              className="-my-1 -me-2 ms-auto shrink-0 sm:ms-0"
            />
          ) : null}
        </div>
        {/* **Two lines, never one clipped one.** A week's titles share their
            prefix — "Dawn Two-Tank — …", "Morning Two-Tank — …" — so a
            truncation eats exactly the half that says which boat this is,
            which is the one question the week exists to answer. A row is the
            full measure now rather than a 150px column, so two lines is
            generous rather than a compromise.

            No `block` beside `line-clamp-2`: the clamp supplies its own
            `display`, and two display utilities resolve by stylesheet order
            rather than the order they are written. */}
        <div className="mt-0.5 flex items-baseline gap-2">
          <Link
            href={`/shop/${shopSlug}/trips/${departure.tripId}`}
            className={`text-sm leading-snug font-semibold line-clamp-2 hover:text-primary ${sailed ? "text-muted" : ""}`}
          >
            {departure.title}
          </Link>
          {runs ? (
            <span className="shrink-0 text-xs font-medium text-primary tabular-nums">{runs}</span>
          ) : null}
        </div>
        {/* **The one line a departure prints about its people**, and only when
            it is the exception (#1923, principle 9). The board ran with a
            usual crew and said so on every row until this rule replaced the
            standing caption; what survives is the row a manager opened the
            board to find. It sheds the muted class where there *is* a habit —
            a line printed only when it differs should not read like the
            caption it replaced — and keeps caption grey on a week that has no
            habit, where every row carries one.

            "Nobody yet" is warning ink either way. That is the gap this line
            exists to show, and a quiet week is exactly when it would otherwise
            be missed. */}
        {crewLine ? (
          <p className={`mt-1 text-sm ${hasUsualCrew ? "" : "text-muted"}`}>
            {crewLine.names ? (
              `${copy.crewLabel} ${crewLine.names}`
            ) : (
              <>
                {copy.crewLabel}{" "}
                <span className="font-medium text-warning">{copy.crewNobodyYet}</span>
              </>
            )}
          </p>
        ) : null}
        {/* One slot, one grammar: an open head count outranks a missing price
            rather than stacking two marks on one row. */}
        {departure.rollCallOpen ? (
          <RollCallFlag
            departure={{ ...departure, rollCallOpen: departure.rollCallOpen }}
            shopSlug={shopSlug}
            copy={copy}
            className="mt-1"
          />
        ) : departure.unpriced && !sailed ? (
          <PriceFlag departure={departure} shopSlug={shopSlug} copy={copy} className="mt-1" />
        ) : null}
      </div>
    </div>
  );
}

/**
 * **The week, as a run of days.** ADR 20260919-one-idea, decision I · Tide,
 * slice 23f: "the week is a pinch". Each day is a row holding its boats, and
 * each boat a time, a bar that fills with the seats sold, and the count.
 *
 * **Rows, because seven columns were the wrong shape for the data.** A seeded
 * week sails on two days, so five of the seven columns were empty whitespace
 * holding a grid open, and the two that had boats got 150px each — which is
 * why the titles in them had to be clamped and why the meta had to be capped
 * and clipped. As rows, an empty day is one line saying "No boats" and a boat
 * has the full measure.
 *
 * **Still `xl` and up for now, and that is the half of the slice still to
 * come.** Rows need no breakpoint — a day is a row on a phone and a row on a
 * desk — so this is meant to become the board's one reading and the
 * `xl:hidden` day stream is meant to go. That deletion is its own commit: the
 * stream owns the cursor paging that reaches past this week, and what happens
 * to a reader who was scrolling forward through departures is a product
 * question, not a layout one. Until then the two compositions stay as they
 * were, panels rendered once outside both (issue #1309).
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
  copy: WeekBoardCopy;
}) {
  // A course is drawn once, on the day it starts — `startColumn` is 1-based,
  // and a course that began before this week is clamped to column 1 by the
  // page. Never also in the days it covers: a three-day course rendered four
  // times is one fact said four times.
  const spansByDay = new Map<string, WeekSpan[]>();
  for (const span of week.spans) {
    const dayIso = week.days[span.startColumn - 1]?.dateIso ?? week.days[0]?.dateIso;
    if (!dayIso) continue;
    spansByDay.set(dayIso, [...(spansByDay.get(dayIso) ?? []), span]);
  }
  // **The habit this week runs with**, voted on here rather than handed down,
  // so nothing can pass the grid a `usual` that disagrees with the rows it is
  // about to draw (#1923; the rule is `src/lib/usual-crew.ts`). Boats only:
  // the vote is over departures that have a crew to assign, and a course bar
  // names its instructor in its own meta.
  const usualCrew = mostCommonCrew(week.days.flatMap((day) => day.entries));

  return (
    // `data-week-board` is the copy-free hook a test asks "is the board
    // here?" with. The `aria-label` beside it is localised, so a Spanish run
    // cannot name the region — which is the same reason the day stream this
    // replaced carried `data-day-stream` (#1923).
    <section data-week-board="" aria-label={week.ariaLabel}>
      {/* Paging is by week, so the control is a pair of steps and a way home
          — not a cursor. `WeekPager` (src/components/ui/week-pager.tsx) is
          shared with the staffing week, which reads the same `?week=`
          parameter over the same dates. */}
      <WeekPager
        rangeLabel={week.rangeLabel}
        previousHref={week.previousHref}
        nextHref={week.nextHref}
        thisWeekHref={week.thisWeekHref}
        words={week.words}
      />

      {/* When *every* departure still to sail this week is unpriced, the
          per-row warning is the same fact on seven rows. Said once here
          instead; the rows keep their mark only while some are priced and some
          are not, which is when a per-row mark distinguishes anything. */}
      {week.allUnpriced ? <AllUnpricedNotice>{copy.noPriceSetAll}</AllUnpricedNotice> : null}

      {/* The week's own line. It is the one number a shop asks a week for, and
          it belongs to the whole run rather than to any day in it. */}
      <p className="mt-4 flex items-baseline justify-between gap-3 border-b border-border pb-2">
        <span className={groupLabelClass("muted")}>{week.ariaLabel}</span>
        <span className="text-sm font-semibold text-muted tabular-nums">{week.seatTally}</span>
      </p>

      {/* **Not a list of days.** Each day's boats are a list, labelled by that
          day's own heading; wrapping the seven in a second list would nest
          `listitem` inside `listitem`, so every locator asking for "the rows"
          — in a test, in a spec, in a screen reader's rotor — would get seven
          days plus their boats and have to say which it meant. The headings
          are the structure. */}
      <div className="flex flex-col">
        {week.days.map((day) => {
          const spans = spansByDay.get(day.dateIso) ?? [];
          const empty = day.entries.length === 0 && spans.length === 0;
          return (
            <div key={day.dateIso} className="border-b border-border">
              <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-start gap-x-3 py-2 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-x-5">
                {/* **The day holds its place while its own boats scroll**
                    (ADR 20260827-clearwater-surface-language, decision 10).
                    This was the day stream's behaviour and it moves here
                    rather than going down with it (#1923): a run of rows on a
                    phone is as easy to lose your place in as a stream was.

                    `top-(--chrome-h)`, never a number — the bar's height is a
                    token and a measured pixel value went stale the first time
                    the bar changed shape (`src/components/chrome/chrome.test.ts`
                    has the incident). `self-start` so the sticky box is the
                    header's own height rather than the grid row's, which
                    would pin an invisible column beside every boat. */}
                <h3
                  id={`week-day-${day.dateIso}`}
                  className="sticky top-(--chrome-h) z-10 self-start bg-background py-2"
                >
                  <span className="sr-only">{day.label}</span>
                  <span
                    aria-hidden="true"
                    className="flex items-center gap-1.5 sm:flex-col sm:items-start sm:gap-0"
                  >
                    <span className={groupLabelClass(day.isToday ? "primary" : "muted")}>
                      {day.weekday}
                    </span>
                    {/* Today is a *filled* disc, not a smaller numeral: the
                        ramp's figure step stays inside it and the disc grows
                        to hold it. Colour is never the only carrier — the
                        pager's "This week" and the weekday's own ink say it
                        too. */}
                    <span
                      className={`${FIGURE_INLINE_CLASS} ${
                        day.isToday
                          ? "flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground"
                          : day.isPast
                            ? "text-muted"
                            : ""
                      }`}
                    >
                      {day.dayNumber}
                    </span>
                  </span>
                </h3>
                <div className="min-w-0">
                  {/* More departures than hulls, or one hull in two places —
                      the question the board exists to answer, on the day it is
                      about. */}
                  {day.boatWarning ? (
                    <p className="flex items-start gap-1.5 px-2 pt-2 text-xs font-medium text-warning">
                      <DiveDayIcon name="warning" className="mt-0.5 size-3.5 shrink-0" />
                      <span>{day.boatWarning}</span>
                    </p>
                  ) : null}
                  <ul aria-labelledby={`week-day-${day.dateIso}`} className="flex flex-col">
                    {spans.map((span) => (
                      <li key={span.tripId}>
                        <WeekBoat
                          departure={span}
                          seats={span.seats}
                          meta={span.meta}
                          time={null}
                          mark={null}
                          runs={span.runsLabel}
                          crewLine={null}
                          hasUsualCrew={usualCrew !== null}
                          shopSlug={shopSlug}
                          canConfigure={canConfigure}
                          openKey={openKey}
                          onToggle={onToggle}
                          registerToggle={registerToggle}
                          copy={copy}
                        />
                      </li>
                    ))}
                    {day.entries.map((entry) => (
                      <li key={entry.tripId}>
                        <WeekBoat
                          departure={entry}
                          seats={entry.seats}
                          meta={entry.meta}
                          time={entry.time}
                          mark={entry.mark}
                          runs={null}
                          crewLine={
                            isUsualCrew(entry.crew, usualCrew)
                              ? null
                              : { names: entry.crew.join(", ") }
                          }
                          hasUsualCrew={usualCrew !== null}
                          shopSlug={shopSlug}
                          canConfigure={canConfigure}
                          openKey={openKey}
                          onToggle={onToggle}
                          registerToggle={registerToggle}
                          copy={copy}
                        />
                      </li>
                    ))}
                  </ul>
                  {/* A day with nothing on it says so. The grid could leave a
                      column blank and be read, because six columns beside it
                      gave the blank its meaning; one empty row in a run of
                      rows is just a gap. */}
                  {empty ? <p className="px-2 py-2.5 text-sm text-muted">{copy.noBoats}</p> : null}
                  {/* Never on a day that has already been: a departure is put
                      on the board, and the board is ahead. */}
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
                        className: "mx-1 justify-start",
                      })}
                    >
                      <span aria-hidden="true">+</span> {copy.add}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* **The ghost days.** A request is a day somebody asked for, drawn
          under the week it belongs to so the ask and the board are read
          together — which is the one thing a week can say that the Requests
          page cannot, and the reason this is not a second copy of it. */}
      {week.asked.length > 0 ? (
        <section aria-labelledby="week-asked" className="mt-8">
          <p className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
            <span id="week-asked" className={groupLabelClass("muted")}>
              {copy.asked}
            </span>
            <span className="text-sm text-muted tabular-nums">{week.askedCount}</span>
          </p>
          <ul className="flex flex-col">
            {week.asked.map((ask) => (
              <li
                key={ask.dateIso}
                className="flex items-start gap-3 border-b border-border px-2 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug font-semibold">{ask.lead}</p>
                  <p className="mt-0.5 text-sm text-muted line-clamp-2">{ask.who}</p>
                </div>
                {/* Never gated on `canConfigure`: a staffer who cannot open a
                    departure has no use for the door, and the ask itself is
                    already said above it. */}
                {canConfigure ? (
                  <Link
                    href={ask.href}
                    className={buttonClass({ variant: "ghost", size: "sm", className: "shrink-0" })}
                  >
                    {copy.addDeparture}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* A week of empty rows and no way forward is a dead end. One line, and
          it is a link to the week that has something in it. */}
      {week.nextDeparture ? (
        <p className="px-2 py-6 text-sm text-muted">
          <Link href={week.nextDeparture.href} scroll={false} className="hover:underline">
            {week.nextDeparture.label}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
