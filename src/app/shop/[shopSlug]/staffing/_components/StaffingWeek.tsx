import Link from "next/link";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { GroupLabel } from "@/components/ui/group-label";
import { LedgerRow, ledgerRowBoxClass, ledgerRowRoomClass } from "@/components/ui/ledger";
import { WeekPager } from "@/components/ui/week-pager";
import { awayDatesText } from "@/i18n/away-labels";
import { fill } from "@/i18n/fill";
import { calendarDateToUtcMidnight } from "@/lib/calendar-date";
import type { AvailabilityBlock } from "@/lib/crew-requests";
import {
  formatDayParts,
  formatShortDate,
  formatTimeRangeTz,
  formatTimeZoneGeneric,
} from "@/lib/format";
import {
  GAP_TONE,
  type PlacedGap,
  type PlacedTrip,
  type StaffGapCode,
  type StaffWeek,
  type WeekShift,
} from "@/lib/staffing-week";
import { StaffingDepartureCrew } from "./StaffingDepartureCrew";
import { StaffingPersonalRows } from "./StaffingPersonalRows";
import { StaffingWeekHeader } from "./StaffingWeekHeader";
import { mobileDepartureGroups } from "./staffing-mobile-groups";
import { ShiftFace } from "./staffing-shift-face";
import { WarningLine } from "./staffing-warning-line";
import { windowOnThisDay } from "./window-on-this-day";

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
 * - **Credentials are not here.** They are a quiet ledger on each person’s
 *   Team card (`StaffCardCredentials`), and nothing in this grid is gated by one — H-59's
 *   clocks inform, never gate. Since issue #1853 a lapsed rating can open a
 *   gap here (the count reads recorded ratings), and the chip then says so
 *   (`PlacedGap.ratingLapsed`); it still disables nothing.
 * - **The grid is not the phone.** Below `lg` the same week renders as a day
 *   list, departures under each day: seven columns of time ranges have no honest
 *   390px form (the same call H-63 made for the schedule board). Both
 *   renderings carry the same acts, so nothing is lost by being on a phone.
 *
 * Everything arrives already localized and already formatted for the shop's
 * zone. It renders no state: the per-shift disclosure is a native `<details>`,
 * so keyboard and screen-reader semantics come free and a JS failure still
 * leaves Remove one tap away.
 */
export type StaffingWeekWords = {
  /** Each person's week in one figure, by person id (`personTotalsWords`, item 52). */
  personTotals?: Readonly<Record<string, string>>;
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
  shiftsAndAway: string;
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
  /** "Away" — what a blackout chip is (issue #1235). */
  away: string;
  /** "Away {dates}" — the warning a crewed departure wears when a blackout overlaps it. */
  awayConflict: string;
  /**
   * "Also rostered on {departure}" (issue #1695, reworded under H-80): this person is
   * rostered on another departure at these very hours. Named, never counted —
   * which boat is the question a manager has the moment they see it.
   */
  crewClash: string;
  /** "Ask for this one" — a crew member's own request. */
  request: string;
  /** "Ask to work {trip}" — that button out of context. */
  requestAria: string;
  requesting: string;
  /** "{person} asked" — one pending request on a gap. */
  requested: string;
  approve: string;
  decline: string;
  deciding: string;
  /** "Approved" / "Declined" — a request that has been answered. */
  requestApproved: string;
  requestDeclined: string;
  /** Beside the ask, when the reader's being aboard would not close it (#1339). */
  askWontClose: string;
  /**
   * Beside Approve, when approving *this* ask would not close it (#1339). The
   * decider is the one person on this surface who can, and they were the one
   * reader never told.
   */
  requestWontClose: string;
  /**
   * Under a gap's code when a lapsed rating is why it is short (issue #1853):
   * the crew list names somebody, and the chip alone read as nobody.
   */
  ratingLapsed: string;
  /**
   * "until {time} · from {day}" — a window that began on an earlier day and
   * ends on this one (UX review 2026-10-13, item 21). The whole range on the
   * second day read as a second night boat.
   */
  continuedUntil: string;
  /** "from {day}" — a middle day of a window that neither starts nor ends on it. */
  continuedFrom: string;
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
  return `/shop/${shopSlug}/trips/${tripId}?view=details#crew`;
}

/**
 * **One act per gap, chosen by who is reading it** (principle 8; the
 * `20260908-one-hand` canvas: "crew without the right to assign see 'Ask for
 * it ›' in the same cell").
 *
 * A ~120px cell used to carry both "Assign ›" and "Ask for this one" side by
 * side at link weight, on every gap, in both layouts — two doors onto the same
 * short-handed departure with nothing saying which one is the reader's. They
 * are not peers: assigning crews the boat, asking is a request somebody else
 * then answers, and which of the two a person can actually do is settled
 * before the cell is drawn. So a manager gets the assignment and nobody else
 * does; a crew member gets the ask, which is also the only door the crew
 * request has anywhere in the app.
 */
function gapAct(gap: PlacedGap, canManage: boolean): "assign" | "request" | "none" {
  if (canManage) return "assign";
  return gap.viewerMayRequest ? "request" : "none";
}

/**
 * **Every chip's box: one shape, one inset and one 1px border, on all four
 * kinds** (K-498). The crew and away chips drew a border and the shift and gap
 * chips none, so in one day column the chips' words started 1px apart and a
 * bordered chip stood 2px taller for the same lines. Every kind reserves the
 * pixel; a kind only colours it (`CHIP_KIND`), transparent where it draws none.
 */
const CHIP_BOX = "flex w-full flex-col rounded-lg border px-2 py-1.5 text-start text-base";

const CHIP_KIND = {
  shift: "gap-px border-transparent",
  crew: "gap-px border-primary/25 bg-primary-tint text-primary",
  away: "gap-px border-dashed border-border bg-surface-sunken text-muted",
  gap: "gap-1 border-transparent bg-surface-sunken",
  loudGap: "gap-1 border-transparent bg-warning-tint",
} as const;

function chipClass(kind: keyof typeof CHIP_KIND) {
  return `${CHIP_BOX} ${CHIP_KIND[kind]}`;
}

/**
 * **A chip a person can press hovers one step past its rest** (K-535, K-501).
 * Both hovered to a translucent copy of their own fill, which over the page's
 * ground is lighter, not deeper: `#e6f0ff` to `#eaf1fd` on the crew chip,
 * `#ececf1` to `#eeeef3` on the shift chip, 0px changed at the state atlas's
 * threshold. Each now steps the 1px edge every chip reserves (`CHIP_BOX`):
 * the crew chip deepens the rule it already draws, and the shift chip draws
 * `--border-strong` where it rests transparent, visible in every scheme.
 *
 * The edge, never the fill: a fill under the words moves their contrast.
 * `bg-border` did. `--border` is a hairline, not a well, and under
 * `prefers-contrast: more` (light) it is `#6b6a63`, where the hovered time
 * measured 3.10:1 and a past shift's muted time 1.84:1; even in the default
 * light scheme muted ink on it is 4.46:1, under AA for this 12px type.
 */
const CHIP_HOVER = {
  shift: "hover:border-border-strong",
  crew: "hover:border-primary/50",
} as const;

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
  if (!canManage) return <span className={chipClass("shift")}>{face}</span>;
  return (
    <details className="group/shift w-full">
      <summary
        aria-label={fill(words.shiftAria, { person: personName, day: dayLabel })}
        className={`${chipClass("shift")} cursor-pointer list-none transition-colors [&::-webkit-details-marker]:hidden ${CHIP_HOVER.shift}`}
      >
        {face}
      </summary>
      {/* The facts the chip could not fit, then the one act. The zone is
          spelled out here and nowhere else on the grid: seven columns of
          "EDT" would be the same word said 40 times. Its inset is the
          chip's own, a transparent 1px edge and then 8px, so the range and
          the flush Remove start on the chip's words, not 1px short (K-498). */}
      <div className="mt-1 flex flex-col items-start gap-1 border-s border-transparent ps-2">
        <span className="text-base text-muted tabular-nums">
          {formatTimeRangeTz(shift.startsAt, shift.endsAt, locale, timeZone)}
        </span>
        <form action={deleteShiftAction}>
          <input type="hidden" name="shiftId" value={shift.id} />
          <SubmitButton
            pendingLabel={words.removing}
            className={buttonClass({ variant: "ghost", size: "md", flush: true })}
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
      className={`${chipClass("crew")} transition-colors ${CHIP_HOVER.crew}`}
    >
      <span className="sr-only">{words.crewing}: </span>
      <span className="font-semibold tabular-nums">
        {windowOnThisDay(trip, words, locale, timeZone, "range")}
      </span>
      <span
        className="block truncate font-medium print:overflow-visible print:whitespace-normal"
        title={trip.title}
      >
        {trip.title}
      </span>
      {/* **One person, two hulls, these same hours** (issue #1695) — a state
          `setTripCrew` refuses to write and which three writes that move the
          boat manufacture anyway (a move, the departure's own Details form,
          and reinstating a called-off boat; `crewClashes` in
          src/db/trips-crew.ts names all three). Until now the schedule board's
          Move panel was the one surface that ever said so. It leads the
          blackout below it for the reason
          `composeMovePreflight` gives the same pair: a clash is a physical
          impossibility and a blackout is somebody's note. Still informs, never
          gates — nobody is taken off a boat here either (#1345).

          The blackout's chip exactly, down to the glyph, rather than the
          departure page's announced line: the week already has one warning
          grammar for "something is wrong with this person on this boat", and a
          second would leave the surface with two. The word carries the
          difference, which is this grid's own rule. */}
      {trip.clashes.map((clash) => (
        <WarningLine key={clash.tripId} size="xs" className="mt-0.5">
          {fill(words.crewClash, { departure: clash.title })}
        </WarningLine>
      ))}
      {/* **Informs, never gates** (ADR 20260902-crew-requests-and-blackouts):
          this person told the shop they were away across days this departure
          meets on. Nobody is taken off the boat and the assignment stands —
          the week says so, and the conversation is the shop's to have. */}
      {trip.awayBlocks.length > 0 ? (
        <WarningLine size="xs" className="mt-0.5">
          {fill(words.awayConflict, { dates: awayDatesText(trip.awayBlocks, locale) })}
        </WarningLine>
      ) : null}
    </Link>
  );
}

/** Away is a quiet fact; an overlapping crew assignment carries the warning. */
function AwayChip({ block, words }: { block: AvailabilityBlock; words: StaffingWeekWords }) {
  return (
    <span className={chipClass("away")}>
      <span className="font-semibold">{words.away}</span>
      {block.note ? <span className="font-medium print:hidden">{block.note}</span> : null}
    </span>
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
  canManage,
  canDecide,
  requestAction,
  decideRequestAction,
}: {
  gap: PlacedGap;
  shopSlug: string;
  locale: string;
  timeZone: string;
  gapWords: GapWords;
  words: StaffingWeekWords;
  /** Whose act this cell offers — see {@link gapAct}. */
  canManage: boolean;
  canDecide: boolean;
  requestAction: (formData: FormData) => void;
  decideRequestAction: (formData: FormData) => void;
}) {
  const loud = GAP_TONE[gap.gap] === "warning";
  const ink = loud ? "text-warning-strong" : "text-muted";
  const act = gapAct(gap, canManage);
  // The departure time alone, not its range: the cell is ~120px and the
  // question here is which boat, not how long it is out.
  const departure = (
    <>
      <span className="tabular-nums">{windowOnThisDay(gap, words, locale, timeZone, "start")}</span>{" "}
      {gap.title}
    </>
  );
  return (
    <div className={chipClass(loud ? "loudGap" : "gap")}>
      {loud ? (
        <WarningLine size="xs">{departure}</WarningLine>
      ) : (
        <span className={`font-semibold ${ink}`}>{departure}</span>
      )}
      <span className={ink}>{gapWords[gap.gap]}</span>
      {/* Why a crew that looks filled is short (issue #1853): a rating on file
          lapses before the departure. Under the code, in its ink, because it is
          the rest of the same fact. The trip's crew section names who. */}
      {gap.ratingLapsed ? <span className={ink}>{words.ratingLapsed}</span> : null}
      {/* **Who has asked to work it** (issue #1235). The owner's own act sits
          on the request rather than in a queue elsewhere: the departure, the
          reason it is short, and the person offering are one thing, and
          splitting them across two surfaces is what made staffing a page that
          could not crew. Approving runs the ordinary assignment mutation —
          this is a request, never a second way onto a boat. */}
      {gap.requests.map((request) => (
        <span key={request.id} className="flex flex-col gap-1 border-t border-border/60 pt-1">
          <span className="font-medium text-muted">
            {request.state === "pending"
              ? fill(words.requested, { person: request.personName })
              : `${request.personName} · ${
                  request.state === "approved" ? words.requestApproved : words.requestDeclined
                }`}
          </span>
          {/* The fact the requester was already given, said to the person who
              can act on it (issue #1339). Above the buttons, not under them: a
              manager clearing the queue at 06:40 taps and moves on, and a
              sentence after the control is one nobody reads. It goes with the
              buttons — it is about pressing Approve, so a reader who has no
              Approve to press is told nothing. */}
          {canDecide && request.askWontClose ? (
            <span className="text-warning-strong">{words.requestWontClose}</span>
          ) : null}
          {canDecide && request.state === "pending" ? (
            <span className="flex flex-wrap gap-1">
              <form action={decideRequestAction}>
                <input type="hidden" name="requestId" value={request.id} />
                <input type="hidden" name="decision" value="approved" />
                <SubmitButton
                  pendingLabel={words.deciding}
                  className={buttonClass({ variant: "primary", size: "sm" })}
                >
                  {words.approve}
                </SubmitButton>
              </form>
              <form action={decideRequestAction}>
                <input type="hidden" name="requestId" value={request.id} />
                <input type="hidden" name="decision" value="declined" />
                <SubmitButton
                  pendingLabel={words.deciding}
                  className={buttonClass({ variant: "ghost", size: "sm" })}
                >
                  {words.decline}
                </SubmitButton>
              </form>
            </span>
          ) : null}
        </span>
      ))}
      {/* The cell's one act, whichever one belongs to this reader (`gapAct`) —
          and no row at all for a reader with neither, rather than an empty
          flex child holding a gap open under the gap's own word. */}
      {act === "none" ? null : (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {act === "assign" ? (
            // Its slot-mate's spelling (the ask below): a flush `sm` link, so
            // a 44px target with the button's corner and ring, where the
            // chip's own `text-xs` line gave it about 52×16px (K-273). The
            // chevron is sized to the link's `text-sm`.
            <Link
              href={tripHref(shopSlug, gap.tripId)}
              aria-label={fill(words.assignAria, { trip: gap.title })}
              className={buttonClass({
                variant: "link",
                size: "md",
                flush: true,
                className: "print:hidden",
              })}
            >
              {words.assign}
              <DiveDayIcon name="chevron-right" className="size-3.5" />
            </Link>
          ) : (
            // Offered only when the write would accept it — same rule,
            // evaluated twice, rather than a button that produces a refusal.
            <form action={requestAction}>
              <input type="hidden" name="tripId" value={gap.tripId} />
              <SubmitButton
                pendingLabel={words.requesting}
                ariaLabel={fill(words.requestAria, { trip: gap.title })}
                className={buttonClass({ variant: "link", size: "md", flush: true })}
              >
                {words.request}
              </SubmitButton>
            </form>
          )}
        </span>
      )}
      {/* A note on the ask, not a refusal of it (issue #1339). It sits after
          the form so it reads as the consequence of pressing the control above
          it: a divemaster may still ask onto an intro session, but the ratio
          it is over is instructor-to-student and their yes does not clear it. */}
      {gap.viewerAskWontClose ? (
        <span className="text-warning-strong">{words.askWontClose}</span>
      ) : null}
    </div>
  );
}

const GRID_CLASS = "grid grid-cols-[9rem_repeat(7,minmax(0,1fr))]";

/**
 * **The grid's parts, one spelling each**, shared with its skeleton
 * (`../loading.tsx`), which drew its own copies and drifted from them.
 *
 * - `row`: every row is a ledger row's box (`ledgerRowBoxClass`). Its rules
 *   run 8px past the column with the row's room, as every rule under the grid
 *   does (the doors, the credentials), and the last row closes the grid, so
 *   the ledger closes itself whether or not the gap row is there. On the
 *   column, the grid's rules stepped 8px where they met the doors' (K-239).
 * - `personHead` / `person`: the person column has no rule on its left, so it
 *   keeps only the 8px before the first day's rule, and its words start on the
 *   column the pager, the h1 and the ledger's words start on (K-239).
 * - `dayHead` / `day`: a day's label takes its cells' inset, so it starts on
 *   its chips' painted edge (K-240). The band is `py-2.5` a side: `pt-3 pb-2`
 *   set its caps 1.5px below its centre (K-499).
 * - `shiftChip`: a shift chip's box, which the skeleton's chip bar wears
 *   around its two lines so it stands at the chip's height, edge and all. A
 *   fixed `h-11` was the chip before K-498 gave it its 1px edge, 2px short
 *   of the 46px it is now, a row (K-274).
 */
/**
 * The grid's name cell: the person, their roles, and their week in one figure
 * (fifth-loop ideas, item 52), the last only when they work at all.
 */
export function PersonFace({
  person,
  totals,
}: {
  person: { name: string; roles: readonly string[] };
  totals: string | undefined;
}) {
  return (
    <>
      <p className="text-base font-semibold">{person.name}</p>
      {person.roles.length > 0 ? (
        <p className="text-xs text-muted">{person.roles.join(" · ")}</p>
      ) : null}
      {totals ? <p className="text-xs text-muted tabular-nums">{totals}</p> : null}
    </>
  );
}

export const WEEK_GRID = {
  row: `${GRID_CLASS} ${ledgerRowBoxClass}`,
  personHead: "pe-2 py-2.5",
  dayHead: "border-s border-border px-1.5 py-2.5",
  person: "pe-2 py-3",
  day: "flex flex-col items-start gap-1 border-s border-border px-1.5 py-2",
  shiftChip: chipClass("shift"),
} as const;

/**
 * **A row hung under the week**: the page's doors ("Add a shift", "Add days
 * away") and its skeleton's stand-ins for them. The week closes
 * itself (the grid's last row, the day list's last ledger row), so a row under
 * it draws only its own closing rule, with a ledger row's room so the rule
 * ends where the week's do. The doors drew a ledger row's box: its top rule
 * doubled the week's, 2px of hairline at every width, and its `last:border-b`
 * never fired, because the consent row follows them (K-195).
 */
export const weekTailRowClass = `${ledgerRowRoomClass} border-b border-border`;

export function StaffingWeek({
  week,
  gapWords,
  words,
  links,
  locale,
  timeZone,
  shopSlug,
  shopName,
  canManage,
  canDecide,
  deleteShiftAction,
  requestAction,
  decideRequestAction,
}: {
  week: StaffWeek;
  gapWords: GapWords;
  words: StaffingWeekWords;
  links: StaffingWeekLinks;
  locale: string;
  timeZone: string;
  shopSlug: string;
  shopName: string;
  canManage: boolean;
  /** Whether this reader may answer a crew member's request (issue #1235). */
  canDecide: boolean;
  deleteShiftAction: (formData: FormData) => void;
  requestAction: (formData: FormData) => void;
  decideRequestAction: (formData: FormData) => void;
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
  // The day list's days, below `lg`: a day someone works, crews a boat or is
  // away, or a boat is short of crew. Worked out before drawing, so the list
  // knows when none did.
  const listDays = dayFaces
    .map((day, index) => ({
      day,
      rows: week.people
        .map((person) => ({ person, cell: person.days[index] }))
        .filter(
          ({ cell }) =>
            cell && (cell.shifts.length > 0 || cell.crewing.length > 0 || cell.away.length > 0),
        ),
      gaps: week.gapDays[index]?.gaps ?? [],
      departures: mobileDepartureGroups(week.people, index, week.gapDays[index]?.gaps ?? []),
    }))
    .filter(({ rows, gaps }) => rows.length > 0 || gaps.length > 0);

  return (
    <section aria-label={words.ariaLabel}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <WeekPager
          rangeLabel={links.rangeLabel}
          previousHref={links.previousHref}
          nextHref={links.nextHref}
          thisWeekHref={links.thisWeekHref}
          words={words}
        />
      </div>

      {/* Native table groups give PDF renderers an explicit repeatable
          header row. Screen rows keep their grid layout. */}
      <table className="staffing-print-grid mt-4 hidden w-full lg:block print:table">
        <StaffingWeekHeader
          days={dayFaces}
          shopName={shopName}
          rangeLabel={links.rangeLabel}
          timeZoneLabel={formatTimeZoneGeneric(locale, timeZone)}
          words={words}
          grid={WEEK_GRID}
        />

        <tbody className="block print:table-row-group">
          {/* Empty gap rows say nothing; only short-handed departures render. */}
          {week.hasGaps ? (
            <tr className={WEEK_GRID.row}>
              <th scope="row" className={`${WEEK_GRID.person} text-start font-normal`}>
                <p className="text-sm font-semibold text-muted">{words.needsCrew}</p>
              </th>
              {week.gapDays.map((cell) => (
                <td key={cell.date} className={WEEK_GRID.day}>
                  {cell.gaps.map((gap) => (
                    <GapChip
                      key={gap.tripId}
                      gap={gap}
                      shopSlug={shopSlug}
                      locale={locale}
                      timeZone={timeZone}
                      gapWords={gapWords}
                      words={words}
                      canManage={canManage}
                      canDecide={canDecide}
                      requestAction={requestAction}
                      decideRequestAction={decideRequestAction}
                    />
                  ))}
                </td>
              ))}
            </tr>
          ) : null}
          {week.people.map((person) => (
            <tr key={person.personId} className={WEEK_GRID.row}>
              <th scope="row" className={`${WEEK_GRID.person} text-start font-normal`}>
                <PersonFace person={person} totals={words.personTotals?.[person.personId]} />
              </th>
              {person.days.map((cell, index) => {
                const day = week.days[index];
                return (
                  <td key={cell.date} className={WEEK_GRID.day}>
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
                    {cell.away.map((block) => (
                      <AwayChip key={block.id} block={block} words={words} />
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* ---- The same week as a day list, below `lg`. Days with nothing in
          them are absent rather than empty: the reader is paging a week, and
          "Wednesday, nothing" seven times is chrome. A day someone is away
          is not nothing: the grid draws it as that person's chip, and the
          list as their row (ADR 20260902-crew-requests-and-blackouts). It
          drew a day away only beside a shift or a boat, so a week of days
          away drew no list at all, and no rule over the doors (K-195). */}
      <div className="mt-4 lg:hidden print:hidden">
        {listDays.map(({ day, rows, departures }) => {
          return (
            <div key={day.date} className="mt-6 first:mt-0">
              {/* `h2` for the same reason the grid's day headers are: the
                  page's `<h1>` is the level directly above this. */}
              <GroupLabel as="h2" tone={day.isToday ? "primary" : "muted"}>
                {day.label}
                {day.isToday ? ` · ${words.today}` : ""}
              </GroupLabel>
              <ul className="mt-2">
                {departures.map(({ key, trip, gap, crew }) => (
                  <LedgerRow
                    key={key}
                    kind={gap ? { word: words.needsCrew, tone: GAP_TONE[gap.gap] } : undefined}
                    stacked
                    // The same one act the grid draws (`gapAct`): the phone
                    // loses the columns, never the work — and never gains a
                    // second door the grid does not have either.
                    trailing={
                      gap && gapAct(gap, canManage) === "assign" ? (
                        <Link
                          href={tripHref(shopSlug, gap.tripId)}
                          aria-label={fill(words.assignAria, { trip: gap.title })}
                          className={buttonClass({
                            variant: "link",
                            size: "md",
                            className: "print:hidden",
                          })}
                        >
                          {words.assign}
                        </Link>
                      ) : null
                    }
                  >
                    <Link
                      href={tripHref(shopSlug, trip.tripId)}
                      className="flex min-h-11 flex-col justify-center text-base font-medium text-primary hover:underline"
                    >
                      <span className="sr-only">{words.crewing}: </span>
                      <span className="tabular-nums">
                        {windowOnThisDay(trip, words, locale, timeZone, "range")}{" "}
                      </span>
                      <span>{trip.title}</span>
                    </Link>
                    {gap ? (
                      <>
                        <p
                          className={`text-base font-medium ${
                            GAP_TONE[gap.gap] === "warning" ? "text-warning-strong" : "text-muted"
                          }`}
                        >
                          {gapWords[gap.gap]}
                        </p>
                        {gap.ratingLapsed ? (
                          <p
                            className={`text-base ${
                              GAP_TONE[gap.gap] === "warning" ? "text-warning-strong" : "text-muted"
                            }`}
                          >
                            {words.ratingLapsed}
                          </p>
                        ) : null}
                        {/* The same acts the grid carries: the phone loses the
                        columns, never the work (`GRID_CLASS`'s note above). */}
                        {/* A <div>, not a <p>: the parser closes a paragraph at its
                        first <form>, and the markup would no longer hydrate. */}
                        {gap.requests.map((request) => (
                          <div key={request.id} className="mt-1 text-base text-muted">
                            {request.state === "pending"
                              ? fill(words.requested, { person: request.personName })
                              : `${request.personName} · ${
                                  request.state === "approved"
                                    ? words.requestApproved
                                    : words.requestDeclined
                                }`}
                            {/* The grid's own line, wrapped as a block so the two
                            buttons still get a row of their own (#1339). */}
                            {canDecide && request.askWontClose ? (
                              <span className="block text-warning-strong">
                                {words.requestWontClose}
                              </span>
                            ) : null}
                            {canDecide && request.state === "pending" ? (
                              <span className="ms-2 inline-flex gap-2">
                                <form action={decideRequestAction} className="inline">
                                  <input type="hidden" name="requestId" value={request.id} />
                                  <input type="hidden" name="decision" value="approved" />
                                  <SubmitButton
                                    pendingLabel={words.deciding}
                                    className={buttonClass({ variant: "link", size: "sm" })}
                                  >
                                    {words.approve}
                                  </SubmitButton>
                                </form>
                                <form action={decideRequestAction} className="inline">
                                  <input type="hidden" name="requestId" value={request.id} />
                                  <input type="hidden" name="decision" value="declined" />
                                  <SubmitButton
                                    pendingLabel={words.deciding}
                                    className={buttonClass({ variant: "link", size: "sm" })}
                                  >
                                    {words.decline}
                                  </SubmitButton>
                                </form>
                              </span>
                            ) : null}
                          </div>
                        ))}
                        {gapAct(gap, canManage) === "request" ? (
                          <form action={requestAction} className="mt-1">
                            <input type="hidden" name="tripId" value={gap.tripId} />
                            <SubmitButton
                              pendingLabel={words.requesting}
                              ariaLabel={fill(words.requestAria, { trip: gap.title })}
                              className={buttonClass({ variant: "link", size: "sm" })}
                            >
                              {words.request}
                            </SubmitButton>
                          </form>
                        ) : null}
                        {/* Under the ask rather than beside it, which is the only
                        difference from the grid's copy of this (issue #1339). */}
                        {gap.viewerAskWontClose ? (
                          <p className="mt-1 text-base text-warning-strong">{words.askWontClose}</p>
                        ) : null}
                      </>
                    ) : null}
                    <StaffingDepartureCrew
                      crew={crew}
                      href={tripHref(shopSlug, trip.tripId)}
                      words={words}
                      locale={locale}
                    />
                  </LedgerRow>
                ))}
                <StaffingPersonalRows
                  rows={rows}
                  day={day}
                  words={words}
                  canManage={canManage}
                  locale={locale}
                  timeZone={timeZone}
                  deleteShiftAction={deleteShiftAction}
                />
              </ul>
            </div>
          );
        })}
        {/* One honest line when the list has no day to draw, where the
            grid's own emptiness is not visible to say it. It is a ledger row,
            the list's last, so it closes the week as the day rows do, and the
            doors below hang on their closing rules alone as under any week
            (K-195). */}
        {listDays.length === 0 ? (
          <LedgerRow as="div">
            <p className="text-base text-muted">{words.empty}</p>
          </LedgerRow>
        ) : null}
      </div>
    </section>
  );
}
