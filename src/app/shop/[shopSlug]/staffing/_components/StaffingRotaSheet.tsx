import {
  GAP_TONE,
  type PlacedGap,
  type PlacedTrip,
  type StaffWeek,
} from "@/features/staffing-week";
import { awayDatesText } from "@/i18n/away-labels";
import { fill } from "@/i18n/fill";
import { PersonFace } from "./StaffingWeek";
import { weekDayFaces } from "./staffing-day-faces";
import { ShiftFace } from "./staffing-shift-face";
import { WarningLine } from "./staffing-warning-line";
import type { GapWords, StaffingWeekWords } from "./staffing-week-types";
import { windowOnThisDay } from "./window-on-this-day";

/**
 * **The crew week on paper** (issue #2745): the rota a shop pins to its
 * noticeboard, read from the same week the Crew screen draws
 * (`readStaffingWeek`) and rendered as facts only. No Assign, no Remove, no
 * Approve: nothing on it is a control, because nothing interactive is
 * rendered, not because a stylesheet hides it.
 *
 * What a shift, a crewed departure and a gap say is the screen's own words.
 * Two things the screen shows are left off on purpose: why somebody is away
 * (#2673: the reason is theirs, and a noticeboard is read by everybody), and
 * the advisories addressed to whoever is reading the screen ("your being
 * aboard would not close this"), which on a shared sheet address nobody.
 *
 * A real `<table>`, so a rota that runs to a second page repeats its column
 * heads, and its first head repeats the shop, the week and the zone every
 * time is in (`data-crew-print-context`): a continuation page off the board
 * still says whose week it is.
 */
export function StaffingRotaSheet({
  week,
  gapWords,
  words,
  locale,
  timeZone,
  shopName,
  rangeLabel,
  timeZoneLabel,
}: {
  week: StaffWeek;
  gapWords: GapWords;
  words: StaffingWeekWords;
  locale: string;
  timeZone: string;
  shopName: string;
  rangeLabel: string;
  /** The zone every time on the sheet is in, said once. */
  timeZoneLabel: string;
}) {
  const days = weekDayFaces(week.days, locale);
  return (
    <table className="w-full table-fixed border-collapse text-xs leading-snug">
      <thead>
        <tr className="border-b border-border-strong">
          <th scope="col" className="w-28 py-2 pe-2 text-start align-bottom font-normal">
            <span className="sr-only">{words.person}</span>
            <span data-crew-print-context className="block">
              <span className="block font-semibold">{shopName}</span>
              <span className="mt-0.5 block tabular-nums">{rangeLabel}</span>
              <span data-crew-print-zone className="mt-0.5 block text-muted">
                {timeZoneLabel}
              </span>
            </span>
          </th>
          {days.map((day) => (
            <th
              key={day.date}
              scope="col"
              className="border-s border-border px-1.5 py-2 text-start align-bottom font-normal"
            >
              <span className="sr-only">{day.label}</span>
              <span aria-hidden="true" className="block font-semibold tracking-wide uppercase">
                {day.weekday} {day.day}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {/* Only short-handed departures render; an empty gap row says nothing. */}
        {week.hasGaps ? (
          <tr className="border-b border-border">
            <th scope="row" className="py-2 pe-2 text-start align-top font-semibold">
              {words.needsCrew}
            </th>
            {week.gapDays.map((cell) => (
              <td key={cell.date} className={DAY_CELL}>
                {cell.gaps.map((gap) => (
                  <GapFact
                    key={gap.tripId}
                    gap={gap}
                    gapWords={gapWords}
                    words={words}
                    locale={locale}
                    timeZone={timeZone}
                  />
                ))}
              </td>
            ))}
          </tr>
        ) : null}
        {week.people.map((person) => (
          <tr key={person.personId} className="border-b border-border">
            <th scope="row" className="py-2 pe-2 text-start align-top font-normal">
              <PersonFace person={person} totals={words.personTotals?.[person.personId]} />
            </th>
            {person.days.map((cell, index) => (
              <td key={cell.date} className={DAY_CELL}>
                {cell.shifts.map((shift) => (
                  <span key={shift.id} className="block">
                    <ShiftFace
                      shift={shift}
                      locale={locale}
                      timeZone={timeZone}
                      isPast={week.days[index]?.isPast ?? false}
                    />
                  </span>
                ))}
                {cell.crewing.map((trip) => (
                  <CrewFact
                    key={trip.tripId}
                    trip={trip}
                    words={words}
                    locale={locale}
                    timeZone={timeZone}
                  />
                ))}
                {cell.away.map((block) => (
                  <span key={block.id} className="block font-semibold text-muted">
                    {words.away}
                  </span>
                ))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const DAY_CELL = "space-y-1.5 border-s border-border px-1.5 py-2 align-top break-words";

/** A departure this person crews that day: its window and name, and any clash. */
function CrewFact({
  trip,
  words,
  locale,
  timeZone,
}: {
  trip: PlacedTrip;
  words: StaffingWeekWords;
  locale: string;
  timeZone: string;
}) {
  return (
    <span className="block border-s-2 border-border-strong ps-1.5">
      <span className="sr-only">{words.crewing}: </span>
      <span className="block font-semibold tabular-nums">
        {windowOnThisDay(trip, words, locale, timeZone, "range")}
      </span>
      <span className="block font-medium">{trip.title}</span>
      {trip.clashes.map((clash) => (
        <WarningLine key={clash.tripId} size="xs">
          {fill(words.crewClash, { departure: clash.title })}
        </WarningLine>
      ))}
      {trip.awayBlocks.length > 0 ? (
        <WarningLine size="xs">
          {fill(words.awayConflict, { dates: awayDatesText(trip.awayBlocks, locale) })}
        </WarningLine>
      ) : null}
    </span>
  );
}

/** A departure short of crew: when, which, why, and who has asked for it. */
function GapFact({
  gap,
  gapWords,
  words,
  locale,
  timeZone,
}: {
  gap: PlacedGap;
  gapWords: GapWords;
  words: StaffingWeekWords;
  locale: string;
  timeZone: string;
}) {
  const loud = GAP_TONE[gap.gap] === "warning";
  const ink = loud ? "text-warning-strong" : "text-muted";
  const departure = (
    <>
      <span className="tabular-nums">{windowOnThisDay(gap, words, locale, timeZone, "start")}</span>{" "}
      {gap.title}
    </>
  );
  return (
    <span className="block">
      {loud ? (
        <WarningLine size="xs">{departure}</WarningLine>
      ) : (
        <span className={`block font-semibold ${ink}`}>{departure}</span>
      )}
      <span className={`block ${ink}`}>
        {gap.ratingUnverified ? words.ratingUnverified : gapWords[gap.gap]}
      </span>
      {gap.ratingLapsed && !gap.ratingUnverified ? (
        <span className={`block ${ink}`}>{words.ratingLapsed}</span>
      ) : null}
      {gap.requests.map((request) => (
        <span key={request.id} className="block text-muted">
          {request.state === "pending"
            ? fill(words.requested, { person: request.personName })
            : `${request.personName} · ${
                request.state === "approved" ? words.requestApproved : words.requestDeclined
              }`}
        </span>
      ))}
    </span>
  );
}
