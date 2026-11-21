import { rosterRowIsBlocked } from "@/features/boarding/roster-filters";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { dockCallAt } from "@/lib/dock-call";
import { isSameCalendarDay } from "@/lib/format";
import {
  type MeetingPointShopRow,
  type MeetingPointTripRow,
  meetingPointOfRows,
} from "@/lib/meeting-point";
import {
  CLOCK_PHASES,
  type ClockPhase,
  clockPhaseOf,
  isLookBack,
  nextMeetingStart,
  phaseWhens,
  readyFrom,
  sentencePhaseOf,
  shownClockPhase,
} from "@/lib/trip-clock";
import { boatStageOf, finalHomeSaid, type tripPhaseOf } from "@/lib/trip-phase";
import { seatsOnSale } from "@/lib/trips";
import { tripFacts } from "./TripHeader";
import { phaseStripCopy } from "./trip-clock-copy";
import { tripHeaderDaySpan } from "./trip-header-price";
import { tripSentence } from "./trip-sentence";

type RosterRow = {
  booking: { id: string; status: string };
  checkedIn: boolean;
};

/**
 * **The frame every phase wears**, read once off what the page already holds
 * (ADR 20261117-trip-page-clock): the phase now and the one on screen, the
 * header's facts, the strip's words, the sentence, and whether Roll call has
 * its door yet.
 */
export function tripFrame({
  clock,
  trip,
  shop,
  roster,
  readiness,
  notBack,
  askedPhase,
  boatName,
  locale,
  t,
}: {
  clock: Parameters<typeof tripPhaseOf>[0] & {
    meetingWindows: readonly { startsAt: Date; endsAt: Date }[];
  };
  trip: MeetingPointTripRow & {
    title: string;
    startsAt: Date;
    endsAt: Date;
    booked: number;
    capacity: number;
    sellableCapacity: number;
  };
  shop: MeetingPointShopRow & { timezone: string; dockCallMinutes: number };
  roster: readonly RosterRow[];
  readiness: ReadonlyMap<
    string,
    { readiness?: Parameters<typeof rosterRowIsBlocked>[0] } | undefined
  >;
  /** Seats recorded not back aboard and not counted since. */
  notBack: number;
  askedPhase: string | undefined;
  boatName: string | null | undefined;
  locale: string;
  t: StaffTranslator;
}) {
  const timeZone = shop.timezone;
  const current = clockPhaseOf(clock);
  const shown: ClockPhase = shownClockPhase(askedPhase, current);
  const active = roster.filter(({ booking }) => booking.status !== "no_show");
  const here = active.filter((entry) => entry.checkedIn).length;
  const blocked = active.filter(({ booking }) =>
    rosterRowIsBlocked(readiness.get(booking.id)?.readiness),
  ).length;
  const capacity = seatsOnSale(trip).capacity;
  const nextStartsAt = nextMeetingStart(clock);
  const dockBy = dockCallAt(nextStartsAt, shop.dockCallMinutes);
  return {
    current,
    shown,
    /** The phase on screen is an earlier one, seen after the boat left (`isLookBack`). */
    lookBack: isLookBack(shown, current),
    capacity,
    /** When guests are wanted at the dock: the shop's call, else the departure. */
    dockBy: dockBy ?? nextStartsAt,
    /** When Getting ready opens: shop-local midnight of the day before. */
    readyFrom: readyFrom(nextStartsAt, timeZone),
    // **Roll call has a door** whenever the trip is today in the shop's zone,
    // on every cancelled trip (a blow-out leaves every booking active, so the
    // crew may still need it to put people back ashore), and whenever the phase
    // on screen is Check-in, On the water, or Wrapped up (dive-domain review
    // 20260920 and review-g). Otherwise it waits in More.
    rollCallDoor:
      current === null ||
      CLOCK_PHASES.indexOf(current) >= CLOCK_PHASES.indexOf("checkin") ||
      shown === "checkin" ||
      shown === "water" ||
      shown === "wrapped" ||
      isSameCalendarDay(clock.now, nextStartsAt, timeZone),
    facts: tripFacts({
      trip,
      daySpan: tripHeaderDaySpan(clock.meetingWindows, locale, timeZone, t),
      boatName,
      meetingPlace: meetingPointOfRows(shop, trip).label,
      locale,
      timeZone,
    }),
    strip: phaseStripCopy(t, phaseWhens({ ...clock, booked: trip.booked, capacity, here }), {
      locale,
      timeZone,
    }),
    sentence: tripSentence(
      {
        phase: sentencePhaseOf(shown, current),
        cancelled: clock.cancelled,
        now: clock.now,
        startsAt: trip.startsAt,
        endsAt: trip.endsAt,
        nextStartsAt,
        dockCallAt: dockBy,
        booked: trip.booked,
        capacity,
        guests: active.length,
        here,
        blocked,
        notBack,
        stage: boatStageOf(clock),
        homeSaidAt: finalHomeSaid(clock) ? (clock.stage?.recordedAt ?? null) : null,
        locale,
        timeZone,
      },
      t,
    ),
  };
}

/**
 * **Where Roll call's door sits** (design review of the final screens, finding
 * 5): the hero only where it is the work, Check-in and On the water; before
 * it has a door, in More; everywhere else (a cancelled trip included), a quiet
 * link in the header.
 */
export function rollCallPlace({
  door,
  editing,
  cancelled,
  shown,
}: {
  door: boolean;
  editing: boolean;
  cancelled: boolean;
  shown: ClockPhase;
}): "more" | "header" | "hero" {
  if (!door) return "more";
  const hero = !editing && !cancelled && (shown === "checkin" || shown === "water");
  return hero ? "hero" : "header";
}
