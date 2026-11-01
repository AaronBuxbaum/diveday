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
  type StaffWeek,
  type WeekShift,
} from "@/lib/staffing-week";
import { StaffingDepartureCrew } from "./StaffingDepartureCrew";
import { StaffingPersonalRows } from "./StaffingPersonalRows";
import { StaffingWeekHeader } from "./StaffingWeekHeader";
import type { GapWords, StaffingWeekLinks, StaffingWeekWords } from "./staffing-week-types";

export type { GapWords, StaffingWeekLinks, StaffingWeekWords } from "./staffing-week-types";

import { mobileDepartureGroups } from "./staffing-mobile-groups";
import { ShiftFace } from "./staffing-shift-face";
import { WarningLine } from "./staffing-warning-line";
import { windowOnThisDay } from "./window-on-this-day";

/** Weekly staffing view (ADR 20260827-the-shops-shelves, decision 3): people by
 * day, with shifts, crew, away time and gaps.
 * Desktop and mobile render the same work and actions; gaps carry words as
 * well as color. Warnings and credentials inform but never gate (H-20260825-staff-credentials-renewal-clock).
 * Dates and shift times arrive formatted for the shop's zone. Native details
 * preserve keyboard and screen-reader access to shift actions. */

function tripHref(shopSlug: string, tripId: string) {
  return `/shop/${shopSlug}/trips/${tripId}?view=details#crew`;
}

/** Offer the action available to this viewer for the gap. */
function gapAct(gap: PlacedGap, canManage: boolean): "assign" | "request" | "none" {
  if (canManage) return "assign";
  return gap.viewerMayRequest ? "request" : "none";
}

/** Keep chip borders consistent so their text aligns within a day column. */
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

/** Hover changes the chip edge, preserving text contrast across schemes. */
const CHIP_HOVER = {
  shift: "hover:border-border-strong",
  crew: "hover:border-primary/50",
} as const;

/** Managers can open a shift chip to see its shop-zoned range and remove it. */
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

/** Link a person's crew assignment to the departure details. */
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
      {/* Conflicting crew times are advisory; the blackout warning below is
          also informational and does not change the assignment. */}
      {trip.clashes.map((clash) => (
        <WarningLine key={clash.tripId} size="xs" className="mt-0.5">
          {fill(words.crewClash, { departure: clash.title })}
        </WarningLine>
      ))}
      {/* Away conflicts inform the shop; they do not remove crew assignments. */}
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

/** Show why a departure needs crew and the action available to this viewer.
 * Warning tone marks higher-priority gaps; shop targets stay advisory.
 * Every gap includes a text label so color is never the only signal. */
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
  // In the compact cell, show the departure start to identify the boat.
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
      <span className={ink}>
        {gap.ratingUnverified ? words.ratingUnverified : gapWords[gap.gap]}
      </span>
      {/* A lapsed rating explains the gap without blocking assignment. */}
      {gap.ratingLapsed && !gap.ratingUnverified ? (
        <span className={ink}>{words.ratingLapsed}</span>
      ) : null}
      {/* Keep requests with their gap; approval uses the normal assignment
          path and can still be refused by domain rules. */}
      {gap.requests.map((request) => (
        <span key={request.id} className="flex flex-col gap-1 border-t border-border/60 pt-1">
          <span className="font-medium text-muted">
            {request.state === "pending"
              ? fill(words.requested, { person: request.personName })
              : `${request.personName} · ${
                  request.state === "approved" ? words.requestApproved : words.requestDeclined
                }`}
          </span>
          {/* Show the approval outcome warning only to viewers who can decide. */}
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
      {/* Render only the action this viewer may take. */}
      {act === "none" ? null : (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {act === "assign" ? (
            // Keep the assignment target comfortably tappable.
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
            // Offer a request only when domain rules allow it.
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
      {/* A request may remain available even when approval would not clear the
          underlying advisory warning. */}
      {gap.viewerAskWontClose ? (
        <span className="text-warning-strong">{words.askWontClose}</span>
      ) : null}
    </div>
  );
}

const GRID_CLASS = "grid grid-cols-[9rem_repeat(7,minmax(0,1fr))]";

/** Shared grid classes keep the live week aligned with its loading skeleton. */
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

/** Closing rule for actions below the week and its loading skeleton. */
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
  // Preserve calendar-day labels; shift instants are formatted in shop time.
  const dayFaces = week.days.map((day) => {
    const instant = calendarDateToUtcMidnight(day.date);
    const parts = formatDayParts(instant, locale, "UTC");
    return { ...day, ...parts, label: formatShortDate(instant, locale, "UTC") };
  });
  // Mobile omits days with no shifts, crew, away time or staffing gaps.
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

      {/* Keep table semantics for print/PDF header repetition; screen rows use
          the same grid layout. */}
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

      {/* Mobile presents the same work and actions as a day list; empty days
          are omitted, while away-only days remain visible (ADR
          20260902-crew-requests-and-blackouts). */}
      <div className="mt-4 lg:hidden print:hidden">
        {listDays.map(({ day, rows, departures }) => {
          return (
            <div key={day.date} className="mt-6 first:mt-0">
              {/* Day headings follow the page heading in the document outline. */}
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
                    // Keep mobile gap actions in parity with the desktop grid.
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
                          {gap.ratingUnverified ? words.ratingUnverified : gapWords[gap.gap]}
                        </p>
                        {gap.ratingLapsed && !gap.ratingUnverified ? (
                          <p
                            className={`text-base ${
                              GAP_TONE[gap.gap] === "warning" ? "text-warning-strong" : "text-muted"
                            }`}
                          >
                            {words.ratingLapsed}
                          </p>
                        ) : null}
                        {/* Keep request decisions and warnings available on
                            mobile. Use a div because this content contains forms. */}
                        {gap.requests.map((request) => (
                          <div key={request.id} className="mt-1 text-base text-muted">
                            {request.state === "pending"
                              ? fill(words.requested, { person: request.personName })
                              : `${request.personName} · ${
                                  request.state === "approved"
                                    ? words.requestApproved
                                    : words.requestDeclined
                                }`}
                            {/* Keep the warning with the decision controls. */}
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
                        {/* The advisory remains visible alongside the request. */}
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
        {/* Show an explicit empty state when no mobile day has content. */}
        {listDays.length === 0 ? (
          <LedgerRow as="div">
            <p className="text-base text-muted">{words.empty}</p>
          </LedgerRow>
        ) : null}
      </div>
    </section>
  );
}
