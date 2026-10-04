"use client";

import Link from "next/link";
import { type ReactNode, useRef } from "react";
import { PrintButton } from "@/components/PrintButton";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { GroupLabel, groupLabelClass } from "@/components/ui/ledger";
import { MENU_PANEL, menuRowClass } from "@/components/ui/menu";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { FIGURE_INLINE_CLASS } from "@/components/ui/typography";
import { WeekPager } from "@/components/ui/week-pager";
import { useMenuDismissal } from "@/components/useMenuDismissal";
import { fill } from "@/i18n/fill";
import { isUsualCrew, mostCommonCrew } from "@/lib/usual-crew";
import { isSoldOut, seatFill } from "@/lib/week-seats";
import { WEEK_DAY_GRID_CLASS, WEEK_EMPTY_DAY_CLASS, WEEK_ROW_BOX_CLASS } from "./week-geometry";

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
 * The seats behind a departure's bar. The formatted `seatsLabel` beside it is
 * the words a reader gets; these are the two numbers the bar is a picture of,
 * and they are separate because `src/lib/week-seats.ts` cannot parse "10 of
 * 12" and must never have to try.
 */
export type WeekSeats = { booked: number; capacity: number };

/** One departure on a day's row. */
export type WeekEntry = WeekDeparture & {
  /** Preformatted departure time, e.g. "7:00 AM". */
  time: string;
  seats: WeekSeats;
  /** "10 of 12", printed beside the bar. */
  seatsLabel: string;
  /** "Molasses Reef · Mantis II · $95", or "Sailed" for a boat already home. */
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
  /** "$595 · Marcus Webb". */
  meta: string;
  seats: WeekSeats;
  /** "4 of 5", printed beside the bar. */
  seatsLabel: string;
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
  words: { previous: string; next: string; thisWeek: string; today: string; print: string };
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
  move: string;
  moveAria: string;
  copy: string;
  copyAria: string;
  remove: string;
  removeAria: string;
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

/** The three acts a departure still to sail can take from its row. */
export type RowActionKind = "move" | "copy" | "remove";

/** A form the builder has open, and the row or day it opens under. */
export type WeekPanel =
  | { under: "departure"; tripId: string; node: ReactNode }
  | { under: "day"; dateIso: string; node: ReactNode };

/**
 * **Move / copy / remove, dropped from the "⋯" itself.** A course bar wears
 * the same one as a boat: the bar replaces the entries for the days it owns,
 * so without it a multi-day course could not be moved at all. A boat already
 * home is refused all three by `src/db/trips-schedule.ts`, so it is offered
 * none.
 *
 * **The list opens under the button that opened it.** It used to render as a
 * strip at the foot of the whole week and take focus there, so a tap on a
 * Friday "⋯" scrolled the page 700px to a bar that named the departure in
 * words, and the row the reader was looking at sat off screen above it. A
 * second tap on the same "⋯" re-opened the strip instead of closing it: the
 * outside-tap listener did not count the trigger as inside.
 *
 * The trigger and the list share one root, so `useMenuDismissal` treats a tap
 * on either as inside: the trigger's own click is the only thing that
 * toggles. Escape and an outside tap close it as every staff menu does.
 */
function RowActions({
  departure,
  open,
  onToggle,
  onChoose,
  onClose,
  registerToggle,
  copy,
  className,
}: {
  departure: WeekDeparture;
  open: boolean;
  onToggle: (key: string) => void;
  onChoose: (kind: RowActionKind, tripId: string) => void;
  /** Closes this list, and only this list; referentially stable. */
  onClose: () => void;
  registerToggle: (key: string) => (el: HTMLButtonElement | null) => void;
  copy: Pick<
    WeekBoardCopy,
    "rowActionsAria" | "move" | "moveAria" | "copy" | "copyAria" | "remove" | "removeAria"
  >;
  className: string;
}) {
  const key = `w:menu:${departure.tripId}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  useMenuDismissal({ open, close: onClose, inside: [rootRef], returnFocus: triggerRef });
  const register = registerToggle(key);
  const items: { kind: RowActionKind; label: string; aria: string }[] = [
    { kind: "move", label: copy.move, aria: copy.moveAria },
    { kind: "copy", label: copy.copy, aria: copy.copyAria },
    { kind: "remove", label: copy.remove, aria: copy.removeAria },
  ];
  return (
    // `data-row-menu` is the copy-free hook a spec asks "is this list open?" with.
    <div
      ref={rootRef}
      className={`${open ? "z-30" : "z-10"} relative print:hidden ${className}`.trim()}
    >
      <button
        type="button"
        ref={(el) => {
          triggerRef.current = el;
          register(el);
        }}
        onClick={() => onToggle(key)}
        aria-expanded={open}
        aria-label={fill(copy.rowActionsAria, { ref: departure.ref })}
        className={buttonClass({ variant: "ghost", size: "icon-sm" })}
      >
        <DiveDayIcon name="more" className="size-4" />
      </button>
      {open ? (
        <div
          data-row-menu={departure.tripId}
          className={`absolute end-0 top-full mt-1 w-40 animate-scale-in ${MENU_PANEL}`}
        >
          {items.map((item, index) => (
            <button
              key={item.kind}
              type="button"
              // The first act takes focus, so a keyboard reader lands in the
              // list they opened, and Escape hands it back to the "⋯".
              ref={index === 0 ? focusOnMount : undefined}
              onClick={() => onChoose(item.kind, departure.tripId)}
              aria-label={fill(item.aria, { ref: departure.ref })}
              className={menuRowClass(item.kind === "remove" ? "danger" : "quiet", {
                gutter: false,
              })}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function focusOnMount(el: HTMLElement | null) {
  el?.focus({ preventScroll: true });
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
 *
 * Both flags are a 44px target that ends at its words (`FLAG_CLASS`), lifted
 * over the row's own door.
 */
function RollCallFlag({
  departure,
  shopSlug,
  copy,
}: {
  departure: WeekDeparture & { rollCallOpen: { diveNumber: number; uncounted: number } };
  shopSlug: string;
  copy: { rollCallOpen: string; rollCallOpenAria: string };
}) {
  return (
    <Link
      href={`/shop/${shopSlug}/trips/${departure.tripId}/manifest?checkpoint=after_dive_${departure.rollCallOpen.diveNumber}`}
      aria-label={fill(copy.rollCallOpenAria, {
        ref: departure.ref,
        dive: departure.rollCallOpen.diveNumber,
      })}
      className={`${FLAG_CLASS} text-danger`}
    >
      <DiveDayIcon name="warning" className="size-3.5" />
      {fill(copy.rollCallOpen, { count: departure.rollCallOpen.uncounted })}
    </Link>
  );
}

/**
 * **A flag is its own target, over the row's door** (pixel-craft class 7). It
 * was a block `flex` link with no floor: 16px tall, and at 390 228px wide for
 * 90px of words, its hit area running the whole column. `tapTargetLinkClass`
 * gives it the 44px floor and ends its box at its words; `relative z-10`
 * stands it above the row's stretched link, so a tap on it is a tap on it.
 * No margin above it: the 44px box's own band is the room under the title.
 */
const FLAG_CLASS = `${tapTargetLinkClass} relative z-10 gap-1.5 text-xs font-semibold hover:underline`;

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
}: {
  departure: WeekDeparture;
  shopSlug: string;
  copy: { noPriceSet: string; noPriceSetAria: string };
}) {
  return (
    <Link
      href={`/shop/${shopSlug}/trips/${departure.tripId}?view=details#details`}
      aria-label={fill(copy.noPriceSetAria, { ref: departure.ref })}
      className={`${FLAG_CLASS} text-warning-strong`}
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
 * **A departure's seats: a bar and its count.** Tide's week is a run of days
 * and each boat on one is a time, this, and the count (ADR 20260919-one-idea,
 * decision I · Tide, slice 23f).
 *
 * The bar is `aria-hidden` and the count beside it is not: the words are the
 * half that survives a reader who cannot see a fill, and a bar that also
 * announced itself would say one fact twice. They sit together at the row's
 * end, so a column of departures reads as one column of fills and counts.
 * Below `sm` the bar gives its room to the title and the count stands alone.
 *
 * A sailed boat's bar is set down in the same muted ink its time and title
 * wear, rather than a fourth colour: the row already says "Sailed".
 */
function Seats({ seats, label, sailed }: { seats: WeekSeats; label: string; sailed: boolean }) {
  return (
    <div className="flex min-h-8 shrink-0 items-center gap-2">
      <ProgressBar
        aria-hidden="true"
        className="hidden h-1.5 w-16 shrink-0 sm:block"
        segments={[
          {
            key: "sold",
            fraction: seatFill(seats),
            // Sold out is a win worth noticing, the same call
            // `TripCapacityBadge` makes: "success" stands out where the
            // ordinary fill recedes. Never the only carrier — the count says
            // 12 of 12.
            className: sailed ? "bg-border-strong" : isSoldOut(seats) ? "bg-success" : "bg-primary",
          },
        ]}
      />
      <p className="text-sm whitespace-nowrap text-muted tabular-nums sm:min-w-14 sm:text-end">
        {label}
      </p>
    </div>
  );
}

/**
 * One departure on a day's row — a boat, or a multi-day course on the day it
 * starts. Both wear the same move/copy/remove menu and the same flags, which
 * is what `WeekDeparture` exists to make unrepresentable otherwise.
 *
 * **Time, then what it is, then how full.** From `md` up the row is four
 * columns: the time in a slot sized for "12:00 PM" (so every title starts at
 * one x), the title over its facts, the seats, and the "⋯". Below `md` the
 * time, the seats and the "⋯" share the first line and the title and its
 * facts take the row's whole measure under them, because a phone has no room
 * for a title between a time and a count.
 *
 * The title leads, not the facts. The row used to open on the seat bar and a
 * run of facts — "Molasses Reef · Mantis I · 9 of 12 · $95" — with the name
 * of the trip underneath it, so the line a reader scans for was the second
 * one on every row.
 */
function WeekBoat({
  departure,
  seats,
  seatsLabel,
  meta,
  time,
  runs,
  crewLine,
  hasUsualCrew,
  shopSlug,
  canConfigure,
  openKey,
  onToggle,
  onChoose,
  onCloseMenu,
  registerToggle,
  copy,
}: {
  departure: WeekDeparture;
  seats: WeekSeats;
  seatsLabel: string;
  meta: string;
  /** Preformatted; a course bar has none of its own, so its slot stays empty. */
  time: string | null;
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
  onChoose: (kind: RowActionKind, tripId: string) => void;
  onCloseMenu: () => void;
  registerToggle: (key: string) => (el: HTMLButtonElement | null) => void;
  copy: WeekBoardCopy;
}) {
  const sailed = departure.status === "sailed";
  const actions = canConfigure && !sailed;
  return (
    // **The row is the departure's door** (pixel-craft class 7) — the ledger
    // row's construction (`LedgerRow`, src/components/ui/ledger.tsx): a
    // stretched link, last in the row, named by the title, over a row that
    // hovers and presses as one. What else in the row is a control — the
    // "⋯", a flag — stands above the door (`z-10`).
    <div
      className={`group/boat pressable-row relative ${WEEK_ROW_BOX_CLASS} hover:bg-surface has-[a:focus-visible]:bg-surface`}
    >
      <div
        data-week-row-grid=""
        className={`grid w-full items-start gap-x-3 ${
          canConfigure
            ? "grid-cols-[minmax(0,1fr)_auto_auto] md:grid-cols-[4.75rem_minmax(0,1fr)_auto_auto]"
            : "grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[4.75rem_minmax(0,1fr)_auto]"
        }`}
      >
        {/* The first line is 32px whatever is on it (pixel-craft class 1), so
            the rail's weekday and "No boats" beside it read level with it. */}
        <p
          className={`col-start-1 row-start-1 flex min-h-8 items-center text-base leading-tight font-semibold whitespace-nowrap tabular-nums ${sailed ? "text-muted" : ""}`}
        >
          {time}
        </p>
        <div className="col-span-full row-start-2 min-w-0 md:col-span-1 md:col-start-2 md:row-start-1 md:pt-1">
          {/* **Two lines, never one clipped one.** A week's titles share their
              prefix — "Dawn Two-Tank — …", "Morning Two-Tank — …" — so a
              truncation eats exactly the half that says which boat this is.

              **A course's length is in the title's own run** (pixel-craft
              class 8), so it follows the last word at every width, and it is
              never clamped: nothing else on its row says how long it runs. */}
          <p
            className={`text-base leading-snug font-semibold group-hover/boat:text-primary ${runs ? "" : "line-clamp-2"} ${sailed ? "text-muted" : ""}`}
          >
            {departure.title}
            {runs ? (
              <span className="ms-1.5 text-xs font-medium whitespace-nowrap text-primary tabular-nums">
                {runs}
              </span>
            ) : null}
          </p>
          {meta ? <p className="mt-0.5 text-sm text-muted">{meta}</p> : null}
          {/* **The one line a departure prints about its people**, and only
              when it is the exception (#1923, principle 9). It sheds the muted
              class where there *is* a habit — a line printed only when it
              differs should not read like the caption it replaced. "Nobody
              yet" is warning ink either way. */}
          {crewLine ? (
            <p className={`mt-0.5 text-sm ${hasUsualCrew ? "" : "text-muted"}`}>
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
          {/* One slot, one grammar: an open head count outranks a missing
              price rather than stacking two marks on one row. */}
          {departure.rollCallOpen ? (
            <RollCallFlag
              departure={{ ...departure, rollCallOpen: departure.rollCallOpen }}
              shopSlug={shopSlug}
              copy={copy}
            />
          ) : departure.unpriced && !sailed ? (
            <PriceFlag departure={departure} shopSlug={shopSlug} copy={copy} />
          ) : null}
        </div>
        <div className="col-start-2 row-start-1 md:col-start-3">
          <Seats seats={seats} label={seatsLabel} sailed={sailed} />
        </div>
        {actions ? (
          <RowActions
            departure={departure}
            open={openKey === `w:menu:${departure.tripId}`}
            onToggle={onToggle}
            onChoose={onChoose}
            onClose={onCloseMenu}
            registerToggle={registerToggle}
            copy={copy}
            // The "⋯" overhangs the 32px line by its excess (44 − 2 × 6).
            className="col-start-3 row-start-1 -my-1.5 -me-2 md:col-start-4"
          />
        ) : canConfigure ? (
          // A boat already home has no "⋯", and keeps its column empty so its
          // seats stand in the same column as every other row's.
          <span aria-hidden="true" className="col-start-3 row-start-1 -me-2 w-11 md:col-start-4" />
        ) : null}
      </div>
      {/* Last, so it paints over everything before it that is positioned, and
          under only what asks to be above it. `data-departure-door` is the
          copy-free hook a spec takes a departure by. */}
      <Link
        href={`/shop/${shopSlug}/trips/${departure.tripId}`}
        aria-label={departure.title}
        data-departure-door=""
        className="absolute inset-0 z-0 rounded-[inherit] focus-visible:focus-ring-inset"
      />
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
  onChoose = () => {},
  onCloseMenu = () => {},
  registerToggle,
  panel = null,
  copy,
}: {
  week: BuilderWeek;
  canConfigure: boolean;
  shopSlug: string;
  openKey: string | null;
  onToggle: (key: string) => void;
  /** A row's "⋯" list chose an act: open that act's panel under the row. */
  onChoose?: (kind: RowActionKind, tripId: string) => void;
  /** Closes whichever "⋯" list is open; referentially stable. */
  onCloseMenu?: () => void;
  registerToggle: (key: string) => (el: HTMLButtonElement | null) => void;
  /**
   * **The open form, and where it belongs.** A departure's move, copy or
   * remove renders under that departure's row, and a day's add under that
   * day's boats — where the reader's eye already is. They used to render
   * beneath the whole week, so a tap on Friday opened a form below Sunday.
   */
  panel?: WeekPanel | null;
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
      {/* The pager and the week's one number share a line: the seats are
          the one figure a shop asks a week for, and they belong to the run
          rather than to any day in it. A separate "THE WEEK" label row above
          the days named what the range beside the arrows already says. */}
      <div
        data-week-line=""
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border pb-3"
      >
        <WeekPager
          rangeLabel={week.rangeLabel}
          previousHref={week.previousHref}
          nextHref={week.nextHref}
          thisWeekHref={week.thisWeekHref}
          words={week.words}
        />
        <div className="flex items-center gap-x-2">
          <p data-week-seat-tally="" className="text-sm text-muted tabular-nums">
            {week.seatTally}
          </p>
          {/* The week a shop pins by the dock: beside the range it prints.
              Desk-sized only: on a phone it would push the tally onto a
              line of its own, and nobody prints the schedule from one. */}
          <PrintButton label={week.words.print} quiet className="max-sm:hidden" />
        </div>
      </div>

      {/* When *every* departure still to sail this week is unpriced, the
          per-row warning is the same fact on seven rows. Said once here
          instead; the rows keep their mark only while some are priced and some
          are not, which is when a per-row mark distinguishes anything. */}
      {week.allUnpriced ? <AllUnpricedNotice>{copy.noPriceSetAll}</AllUnpricedNotice> : null}

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
          const addKey = `w:add:${day.dateIso}`;
          // Never on a day that has already been: a departure is put on the
          // board, and the board is ahead.
          const addButton =
            canConfigure && !day.isPast ? (
              <button
                type="button"
                ref={registerToggle(addKey)}
                onClick={() => onToggle(addKey)}
                aria-expanded={openKey === addKey}
                aria-label={fill(copy.addDepartureOnDay, { day: day.label })}
                className={buttonClass({
                  variant: "ghost",
                  size: "sm",
                  className: "shrink-0 print:hidden",
                })}
              >
                <span aria-hidden="true">+</span> {copy.add}
              </button>
            ) : null;
          const panelUnder = (tripId: string) =>
            panel?.under === "departure" && panel.tripId === tripId ? panel.node : null;
          const boatRow = (
            departure: WeekDeparture,
            row: Pick<WeekEntry, "seats" | "seatsLabel" | "meta"> & {
              time: string | null;
              runs: string | null;
              crewLine: { names: string } | null;
            },
          ) => (
            <li key={departure.tripId}>
              <WeekBoat
                departure={departure}
                seats={row.seats}
                seatsLabel={row.seatsLabel}
                meta={row.meta}
                time={row.time}
                runs={row.runs}
                crewLine={row.crewLine}
                hasUsualCrew={usualCrew !== null}
                shopSlug={shopSlug}
                canConfigure={canConfigure}
                openKey={openKey}
                onToggle={onToggle}
                onChoose={onChoose}
                onCloseMenu={onCloseMenu}
                registerToggle={registerToggle}
                copy={copy}
              />
              {panelUnder(departure.tripId) ? (
                <div className="px-2 pb-3">{panelUnder(departure.tripId)}</div>
              ) : null}
            </li>
          );
          return (
            <div key={day.dateIso} className="border-b border-border">
              {/* One rail, 72px, at every width — sized, and shared with
                  the loading skeleton, in `week-geometry.ts`. */}
              <div className={WEEK_DAY_GRID_CLASS}>
                {/* **The day holds its place while its own boats scroll**
                    (ADR 20260827-clearwater-surface-language, decision 10).
                    `top-(--chrome-h)`, never a number — the bar's height is a
                    token. `self-start` so the sticky box is the header's own
                    height rather than the grid row's.

                    **One line at every width**: "FRI 2", level with the
                    first departure's time beside it. Stacked from `sm` up, the
                    weekday and its numeral made every day two lines tall, and
                    an empty day twice the height of the one line it says. */}
                <h3
                  id={`week-day-${day.dateIso}`}
                  className="sticky top-(--chrome-h) z-10 self-start bg-background py-2"
                >
                  <span className="sr-only">{day.label}</span>
                  <span aria-hidden="true" className="flex min-h-8 items-center gap-1.5">
                    {/* A fixed width, so every numeral after it starts at
                        one x. */}
                    <span
                      className={`${groupLabelClass(day.isToday ? "primary" : "muted")} w-8 shrink-0`}
                    >
                      {day.weekday}
                    </span>
                    {/* Today is a *filled* disc, not a smaller numeral.
                        Colour is never the only carrier — the pager's "This
                        week" and the weekday's own ink say it too. */}
                    <span
                      className={`${FIGURE_INLINE_CLASS} ${
                        day.isToday
                          ? "flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
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
                    {spans.map((span) =>
                      boatRow(span, {
                        seats: span.seats,
                        seatsLabel: span.seatsLabel,
                        meta: span.meta,
                        time: null,
                        runs: span.runsLabel,
                        crewLine: null,
                      }),
                    )}
                    {day.entries.map((entry) =>
                      boatRow(entry, {
                        seats: entry.seats,
                        seatsLabel: entry.seatsLabel,
                        meta: entry.meta,
                        time: entry.time,
                        runs: null,
                        crewLine: isUsualCrew(entry.crew, usualCrew)
                          ? null
                          : { names: entry.crew.join(", ") },
                      }),
                    )}
                  </ul>
                  {/* A day with nothing on it says so, and offers to fill it on
                      the same line: one empty row in a run of rows is just a
                      gap, and a second line for "+ Add" made it two. */}
                  {empty ? (
                    <div className={WEEK_EMPTY_DAY_CLASS}>
                      <p className="text-sm text-muted">{copy.noBoats}</p>
                      {addButton ? <div className="-my-1.5 -me-2">{addButton}</div> : null}
                    </div>
                  ) : addButton ? (
                    <div className="px-2 pb-1">
                      <div className="-ms-3">{addButton}</div>
                    </div>
                  ) : null}
                  {panel?.under === "day" && panel.dateIso === day.dateIso ? (
                    <div className="px-2 pb-3">{panel.node}</div>
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
          <div className="border-b border-border pb-2">
            <GroupLabel id="week-asked" meta={week.askedCount}>
              {copy.asked}
            </GroupLabel>
          </div>
          <ul className="flex flex-col">
            {week.asked.map((ask) => (
              <li
                key={ask.dateIso}
                // On the section's own edges (pixel-craft class 3): the row
                // paints no fill, so it keeps no room for one, and its words
                // start where "ASKED FOR" does. The act is centred on them
                // (class 1), since the names wrap to two lines on a phone.
                className="flex items-center gap-3 border-b border-border py-3"
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
                    // `flush`: its word ends on the column, under the count
                    // it answers, not 12px inside it.
                    className={buttonClass({
                      variant: "ghost",
                      size: "sm",
                      flush: true,
                      className: "shrink-0 print:hidden",
                    })}
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
