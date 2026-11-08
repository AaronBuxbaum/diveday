import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { todayBoatSafety } from "@/db/boat-safety";
import type { AppDb } from "@/db/client";
import { courseCrewCountsByTrip } from "@/db/course-crew-counts";
import {
  listFitAdjustedReturns,
  listGearDueBack,
  listGearServiceDue,
  listOverdueGearReservations,
} from "@/db/gear";
import { countUnansweredMessages } from "@/db/inbound-messages";
import { listUnfiledIncidentDrafts } from "@/db/incident-reports";
import { countWaitingDateInterests } from "@/db/interest-dates";
import { listOpenAnytimeWindows } from "@/db/interests";
import {
  listBoardedAtAnyCheckpointByTrip,
  listDepartureCrewRollCallByTrip,
  listDepartureRollCallByTrip,
} from "@/db/manifests";
import { listNotificationDeliveryIssues } from "@/db/notifications";
import { openOrdersForBookings } from "@/db/orders";
import { listTripsReadiness } from "@/db/readiness";
import { newestMarkFirst } from "@/db/roll-call-order";
import { markBookingId, seatMarks } from "@/db/roll-call-subject";
import {
  boats,
  bookings,
  interests,
  people,
  personRoles,
  rollCallEvents,
  shops,
  tripAssignments,
  tripScheduleDays,
  trips,
} from "@/db/schema";
import { listStaffCredentials } from "@/db/staff-credentials";
import {
  canAcceptPayments,
  paymentsRestrictedSince,
  shopStripeAccountForRender,
} from "@/db/stripe-accounts";
import { currentMeetingDayMarks, meetingWindowsByTrip } from "@/db/trip-meeting-windows";
import {
  boatClashesByTrip,
  countShopTrips,
  crewClashesByTrip,
  listStaff,
  liveTrip,
  seatNotCancelled,
} from "@/db/trips";
import { listUnfinished } from "@/db/unfinished";
import { sharedWelcomeSeatsByTrip } from "@/db/welcome-cues";
import { listAgencyCheckableCards } from "@/features/agency-check";
import {
  blockedOnNextBoatDay,
  type HorizonReadinessEvidence,
  inHorizonReadiness,
  type NextBoatDayBlocked,
  sharedInHorizonReadiness,
} from "@/features/blockers";
import { openSnagsForShop } from "@/features/boat-snags";
import { readBoatWork } from "@/features/boat-work";
import { crewAwayByTrip } from "@/features/crew-away";
import { diveIntentTallyForTrips } from "@/features/dive-intent";
import { type HandledHelpRequest, listTodayHelpWork } from "@/features/help-requests";
import { countOpenLostItems } from "@/features/lost-items";
import { listOpenPaymentDisputes } from "@/features/payment-disputes";
import { readReviewsAwaitingModeration } from "@/features/reviews";
import { listRollCallGaps } from "@/features/roll-call-gaps";
import type { ShopClock } from "@/features/shop-clock";
import { plannedSitesByTrip } from "@/features/trip-planned-sites";
import { latestTripStagesByTrip } from "@/features/trip-stages";
import { listWorkOrdersNeedingAttention } from "@/features/work-order-follow-up";
import type { StaffTranslator } from "@/i18n/staff-messages";
import {
  highWindAlertDetailText,
  openTripActionText,
  openUnitsActionText,
  unitsUnconfirmedDetailText,
  unitsUnconfirmedSubjectText,
} from "@/i18n/today-labels";
import type { AgencyCheckableCard } from "@/lib/agency-check-queue";
import { raisedOnTodayBefore } from "@/lib/attempts";
import type { Role } from "@/lib/authz";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { HOUR_MS } from "@/lib/clock";
import { perDiverBookingPriceCents } from "@/lib/courses";
import type { AvailabilityBlock } from "@/lib/crew-requests";
import { effectiveCrewRoles, groupCrewAssignments } from "@/lib/crew-roles";
import { DEPARTURE_BUFFER_MS } from "@/lib/departure-clock";
import type { DiveIntentCount } from "@/lib/dive-intent";
import { DEFAULT_DIVERS_PER_DIVEMASTER } from "@/lib/divemaster-ratio";
import { emergencyCardHasNumbers } from "@/lib/emergency-reference";
import { type CrewIncompleteReason, rollCallCompleteness } from "@/lib/manifests";
import {
  type AutomatedMarineForecast,
  fetchAutomatedMarineForecast,
  isHighWind,
  shouldShowAutomatedForecast,
} from "@/lib/marine-forecast";
import { operationalWindow } from "@/lib/operational-window";
import { BLOCKER_CATEGORY } from "@/lib/readiness";
import { meetsOnShopDay } from "@/lib/trip-days";
import { boatStageOf, tripPhaseOf } from "@/lib/trip-phase";
import type { TripStageReading } from "@/lib/trip-stages";
import { hasSailed } from "@/lib/trips";
import { type WelcomeCue, welcomeCueFor } from "@/lib/welcome-cue";
import { shopDayBounds } from "@/lib/zoned";
import { filterActionsForRoles, isBlockedAboard, oneRowPerDiver, type TodayAction } from "./today";
import { pushCrewAwayRows } from "./today-crew-away-rows";
import { pushDepartureRows } from "./today-departure-rows";
import { pushDeskRows } from "./today-desk-rows";
import { pushEquipmentRows } from "./today-equipment-rows";
import { pushBoatClashRows, pushRollCallRows } from "./today-roll-call-rows";
import type { TodayRowsContext } from "./today-rows-context";
import { at, shopDay } from "./today-shared";
import { pushShopRows } from "./today-shop-rows";
import { pushBoatSnagRows } from "./today-snag-rows";

/**
 * Today's boat: the trip id staff would check in for right now, or null on a
 * day the shop has no departure. The command palette uses it to offer a
 * "Boarding — today's boat" jump straight to the manifest. Deliberately
 * lightweight — a bounded scan of scheduled trips around now, filtered to the
 * shop's calendar day, preferring a boat that hasn't finished over one that
 * already sailed.
 *
 * "Today" is the clock's own day (`clock.day`), the exact UTC pair around the
 * shop's calendar date, so the query needs no looser scan and no second pass.
 */
export async function todayNextDepartureTripId(
  db: AppDb,
  shopId: string,
  clock: ShopClock,
): Promise<string | null> {
  return nextOfTodaysDepartures(await todaysDepartures(db, shopId, clock), clock.now);
}

/** The departure a boarding door opens: the first still out or to come, else the first. */
export function nextOfTodaysDepartures(
  todays: readonly { id: string; endsAt: Date }[],
  now: Date,
): string | null {
  const active = todays.find((row) => row.endsAt >= now) ?? todays[0];
  return active?.id ?? null;
}

/**
 * **Today's scheduled departures, in clock order** — the boarding door's
 * source, and ⌘K's "Today" group before anything is typed (fifth loop, item
 * 13), from one read.
 */
export async function todaysDepartures(
  db: AppDb,
  shopId: string,
  clock: ShopClock,
): Promise<{ id: string; title: string; startsAt: Date; endsAt: Date }[]> {
  // **By meeting day, not by the departure's one window** (#2557): a course
  // that meets on two Saturdays is today's departure on both and on none of
  // the days between. The row carries the day's own window, so "still out or
  // to come" (`nextOfTodaysDepartures`) is that day's, not the whole run's.
  // A departure with no day rows is read from `trips.starts_at`, as before.
  const rows = await db
    .select({
      id: trips.id,
      title: trips.title,
      startsAt: sql<Date>`coalesce(${tripScheduleDays.startsAt}, ${trips.startsAt})`.mapWith(
        tripScheduleDays.startsAt,
      ),
      endsAt: sql<Date>`coalesce(${tripScheduleDays.endsAt}, ${trips.endsAt})`.mapWith(
        tripScheduleDays.endsAt,
      ),
    })
    .from(trips)
    .leftJoin(
      tripScheduleDays,
      and(
        eq(tripScheduleDays.tripId, trips.id),
        gte(tripScheduleDays.startsAt, clock.day.from),
        lt(tripScheduleDays.startsAt, clock.day.to),
      ),
    )
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        or(
          isNotNull(tripScheduleDays.id),
          and(gte(trips.startsAt, clock.day.from), lt(trips.startsAt, clock.day.to)),
        ),
      ),
    )
    .orderBy(
      asc(sql`coalesce(${tripScheduleDays.startsAt}, ${trips.startsAt})`),
      asc(trips.title),
      asc(trips.id),
    );
  // Two of one departure's days on the same shop day read as one boat, its first.
  const seen = new Set<string>();
  return rows.filter((row) => !seen.has(row.id) && seen.add(row.id));
}

/** A departure happening today, with just enough to know whether it can sail. */
export type DepartureSummary = {
  tripId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  booked: number;
  /** The stated seats, as the details form edits them. */
  capacity: number;
  /**
   * The seats on sale: `capacity` capped at the boat's certificate (H-20261009-certificate-caps-seats,
   * `sellableSeats`). Open seats and the readiness bar count against this
   * (#2388), as the booking transaction does.
   */
  sellableCapacity: number;
  /** A practice departure (ADR 20261012-rehearsal-departures). */
  rehearsal: boolean;
  ready: number;
  blocked: number;
  /**
   * Who each of the two blocked groups holds, in roster order. The card's
   * caption names a lone blocked diver outright — the answer, not a door to
   * the list that holds it (design/principles.md #10) — and falls back to the
   * count once naming everyone would be a paragraph.
   *
   * **Split, because the counts are.** This was one flat list while
   * `blockedAboard`/`blockedAshore` were separate numbers, and the card's
   * naming condition read `blocked === 1` — so on a boat with one diver
   * blocked aboard and one blocked ashore it rendered two lines, one person
   * each, both known by name, and named neither (issue #791). Each line asks
   * about its own group now, so its condition is correct on its own.
   */
  blockedAshoreNames: string[];
  boarded: number;
  /**
   * How `blocked` splits once roll call starts, which is what stops the card
   * contradicting itself. `blocked` stays the readiness fact about the whole
   * roster and is the right number for the counts line; these two say which of
   * those divers the *sentence* can still be about (issue #698).
   *
   * - `blockedAboard` — blocked and already on the boat. The more serious of
   *   the two: the gate is behind them, not in front. Boarding a blocked diver
   *   is legitimate (this app informs, never gates), but the screen has to say
   *   what happened.
   * - `blockedAshore` — blocked with no departure result at all, so still
   *   genuinely "cannot board yet".
   *
   * A diver whose latest departure result is `not_boarded` is in **neither**.
   * They never left the dock, and describing their waiver as something to fix
   * before departure is noise on a boat that has sailed.
   */
  blockedAboard: number;
  blockedAshore: number;
  courseTitle: string | null;
  /**
   * The three facts the day spine's station line says about a departure — site
   * · boat · price (ADR 20260827-clearwater-surface-language, decision 4). They
   * are read here, in the one departures pass, rather than by the surface: a
   * station is a *rendering* of this row, and a second query at the page would
   * be a second answer about the same boat.
   *
   * `siteName` is every planned dive's site, distinct and in dive order,
   * joined by commas ("Molasses, French"), and
   * `boatName` is `boats.name` through `trips.boat_id`. All three are null for
   * a departure that has not been given one: a shop may price at the counter,
   * run a shore dive, or not own a hull.
   */
  siteName: string | null;
  boatName: string | null;
  priceCents: number | null;
  crew: { id: string; fullName: string; roles: string[] }[];
  /**
   * **The crew half of "is this checkpoint closed", from the one authority.**
   *
   * The card's celebration used to fire on `boarded === booked`, which counts
   * bookings — so Today threw confetti while the manifest, reading the same
   * departure, correctly refused to close a checkpoint with a divemaster
   * unaccounted for. Two surfaces, one fact, two answers (issue #789);
   * `docs/product/glossary.md` is explicit that "divers alone were never the
   * whole boat".
   *
   * Computed by `rollCallCompleteness` in `src/lib/manifests.ts` — the same
   * call the live manifest and the offline copy make — rather than by a second
   * rule written here, which is how the two came to disagree in the first
   * place.
   */
  crewAccountedFor: boolean;
  /** Why the crew half is open, as a **code**; the UI picks the words. */
  crewReason: CrewIncompleteReason | null;
  /**
   * Where the crew last said this boat was, and when (ADR
   * 20260904-reef-all-the-way-down, Budget rule 4), by `boatStageOf`: the
   * same reading the departure header and the manifest strip print, so the
   * three say one word (UX review 2026-10-10, item 1). Null when nobody has
   * said anything today, which renders nothing.
   */
  stage: TripStageReading | null;
  /**
   * **What the divers aboard came for, as counts** (D12/#1172 with D23/#1183,
   * issue #1386). Empty on a departure nobody answered on — which renders
   * nothing, so a shop that never asks never sees a row about it.
   *
   * Read for the whole day in one query below, never one per station.
   */
  intents: DiveIntentCount[] /** Today's divers to greet (`SpineDeparture.welcome`); absent on tomorrow's cards. */;
  welcome?: { name: string; cue: WelcomeCue }[];
};

export type CrewedSessionSummary = {
  tripId: string;
  title: string;
  courseTitle: string | null;
  startsAt: Date;
  booked: number;
  ready: number;
  blocked: number;
  /**
   * The reader's own days away that this session meets on (fourth review,
   * item 12; `crewAwayByTrip`). Empty when they are not away. Optional so a
   * summary built elsewhere reads as "not away".
   */
  away?: AvailabilityBlock[];
};

export type TodayWork = {
  departures: DepartureSummary[];
  actions: TodayAction[];
  /** Today's handled help requests, so Today can offer Reopen after the undo toast (issue #2939). */
  handledHelp: HandledHelpRequest[];
  /**
   * The high-wind rows, still arriving: the marine forecast is the one read
   * here that is not the database, so the queue answers without it and the
   * page streams these under their own `<Suspense>` (`highWindActions`).
   * Already filtered for the reader's roles; never rejects. Not in
   * {@link actions}, so no count on the page includes them.
   */
  highWind: Promise<TodayAction[]>;
  /**
   * Departures that have started and are not home: every started departure
   * the crew-clash read saw (issue #1814), plus every boat still out by its
   * roll call or clock, cancelled-after-boarding included (issue #2064). A
   * row about one that is no longer a station files at the desk rather than
   * into the week's count (`assembleDaySpine`).
   */
  outTripIds: string[];
  /**
   * Blocked divers aboard boats still out past the horizon (issue #2064), the
   * divers the `blocked_aboard` rows below name. Added to the nav badge and
   * the summary's blocked figure (`blockedOnNextBoatDay`).
   */
  blockedAboard: number;
  /** Shown only when nothing sails today, so the page still orients the crew. */
  nextDeparture: {
    tripId: string;
    title: string;
    startsAt: Date;
    booked: number;
    /** The seats on sale (`sellableSeats`), which the booked count is read against. */
    sellableCapacity: number;
  } | null;
  /**
   * The role lens's raw material (20260721-role-aware-landing): which of the
   * window's trips the signed-in person crews, and a per-session readiness
   * summary for the course sessions among them. Empty unless a personId was
   * passed.
   */
  crewedTripIds: string[];
  crewedSessions: CrewedSessionSummary[];
  availableStaff: { id: string; fullName: string; roles: string[] }[];
};

/**
 * **Who is standing in a crew clash on the queue's boats** (H-20260916-may-one-hull-carry, issues #1776
 * and #1814) — one batched read of `crewClashesByTrip` across every departure
 * the queue cares about, never one query per boat.
 *
 * The departures asked about are the queue's own window (`inWindow`) and every
 * one that has started and is not yet home, because a boat out on the water
 * has already fallen out of that forward-looking window — the same reason
 * `listRollCallGaps` runs its own query. The `startsAt`/`endsAt` comparisons
 * below are only the scan's bounds; whether a clash is still ahead, out on the
 * water, or over is decided per leg by `crewClashPhase` (src/features/today/today.ts),
 * through `hasSailed` and `hasReturned`.
 *
 * A departure already **home** reports nothing (`crewClashesByTrip` and
 * `crewClashPhase` both ask `hasReturned`). That is a deliberate silence, not
 * coverage elsewhere: a crew member nobody tapped is not a roll-call subject,
 * so neither the roll call nor the close-out will name them afterwards. It is
 * said while the boat is out (#1814) because that is the last moment it can
 * change who is counted aboard.
 */
async function standingCrewClashes(
  db: AppDb,
  shopId: string,
  inWindow: readonly {
    id: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    boatId: string | null;
  }[],
  now: Date,
  timeZone: string,
) {
  const started = await db
    .select({
      id: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      boatId: trips.boatId,
    })
    .from(trips)
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        lte(trips.startsAt, now),
        // Scan bound only: a buffered hour past its return is `hasReturned`.
        gt(trips.endsAt, new Date(now.getTime() - DEPARTURE_BUFFER_MS)),
      ),
    )
    .orderBy(asc(trips.startsAt), asc(trips.title), asc(trips.id));
  const departures = new Map<
    string,
    { id: string; title: string; startsAt: Date; endsAt: Date; boatId: string | null }
  >();
  for (const trip of [...started, ...inWindow]) {
    if (!departures.has(trip.id)) {
      departures.set(trip.id, {
        id: trip.id,
        title: trip.title,
        startsAt: trip.startsAt,
        endsAt: trip.endsAt,
        boatId: trip.boatId,
      });
    }
  }
  const ids = [...departures.keys()];
  // The departure roll call is read here for every one of these departures,
  // not borrowed from the station reader: a boat that left more than an hour
  // ago is no longer a station, and it is the boat this question is about.
  const [clashes, boatClashes, divers, crew, stages, meetingWindows] = await Promise.all([
    crewClashesByTrip(db, shopId, ids, now),
    // The hull half of the same fault (H-20260916-may-one-hull-carry, issue #2135): one batched read.
    boatClashesByTrip(db, shopId, ids, now),
    listDepartureRollCallByTrip(db, shopId, ids),
    listDepartureCrewRollCallByTrip(db, shopId, ids),
    latestTripStagesByTrip(
      db,
      shopId,
      started.map((trip) => trip.id),
    ),
    meetingWindowsByTrip(db, started),
  ]);
  // Out is the departure phase's own answer (`tripPhaseOf`), the rule
  // `blockedAboardOnBoatsOut` reads too: one rule, one answer. A `home` from
  // the last day brings a boat in; a course whose crew said home after day
  // one is still out on day two. Every row here is short of `hasReturned`
  // (the scan bound), where no other tap can turn a departure Back.
  const isOut = (trip: { id: string; startsAt: Date; endsAt: Date }) =>
    tripPhaseOf({
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      now,
      timeZone,
      stage: stages.get(trip.id) ?? null,
      cancelled: false,
      meetingWindows: meetingWindows.get(trip.id),
    }) === "aboard";
  return {
    clashes,
    boatClashes,
    divers,
    crew,
    departures: [...departures.values()],
    // Every departure that has started and is not home, which is what files a
    // row about it at the desk once it has dropped out of the stations
    // (`assembleDaySpine`). Started is the departure's own `startsAt`, so a
    // course between two of its days still counts as out.
    outTripIds: started.filter(isOut).map((trip) => trip.id),
  };
}

/**
 * How many divers asked for each departure *and* one suggested interest per trip,
 * so a freed seat can be offered to a real person without leaving Today. The
 * suggestion is the one who asked first: a sensible default, not an entitlement
 * and never a ranking by fit (ADR 20260813-wait-list-is-a-lead-list). A diver
 * who holds a seat is not wanting one (an interest is read against the seats, never
 * written by the booking). Name, email and offered stamp ride along so the
 * Today row can offer in one tap and fall back to the composer exactly like the
 * trip page's panel (`OfferSeat`).
 */
export type SeatWantedInterest = {
  interestId: string;
  personName: string;
  personEmail: string | null;
  invitedAt: Date | null;
  /** The seats this interest waits for, themselves included. */
  partySize: number;
};

/**
 * How many want in, and every one of them in the order they asked: the row
 * offers the first whose whole party fits the open seats (dive-domain review
 * of #2656, m2), as the roll does, never "a seat opened" to a party of four
 * for one seat.
 */
export type SeatWantedFront = { count: number; interests: SeatWantedInterest[] };

async function seatWantedByTrip(db: AppDb, shopId: string, tripIds: string[]) {
  const fronts = new Map<string, SeatWantedFront>();
  if (tripIds.length === 0) return fronts;
  const rows = await db
    .select({
      tripId: interests.tripId,
      interestId: interests.id,
      invitedAt: interests.offeredAt,
      partySize: interests.partySize,
      personName: people.fullName,
      personEmail: people.email,
    })
    .from(interests)
    .innerJoin(people, eq(people.id, interests.personId))
    // **Read whatever the wait list's switch says** (review 2026-10-23, item
    // 8): a diver already waiting when the shop turned it off stays on Today
    // until someone handles them. The one tap's email is the wait list's own
    // send, so off it falls back to the composer and staff write by hand.
    .where(
      and(
        eq(interests.scope, "departure"),
        eq(interests.askedBy, "diver"),
        eq(interests.shopId, shopId),
        inArray(interests.tripId, tripIds),
        notExists(
          db
            .select({ id: bookings.id })
            .from(bookings)
            .where(
              and(
                eq(bookings.tripId, interests.tripId),
                eq(bookings.personId, interests.personId),
                seatNotCancelled,
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(interests.askedAt), asc(people.fullName), asc(interests.id));
  for (const row of rows) {
    if (!row.tripId) continue;
    // Rows arrive oldest-first, so each trip's list is in the order people asked.
    const front = fronts.get(row.tripId) ?? { count: 0, interests: [] };
    front.count += 1;
    front.interests.push({
      interestId: row.interestId,
      personName: row.personName,
      personEmail: row.personEmail,
      invitedAt: row.invitedAt,
      partySize: row.partySize ?? 1,
    });
    fronts.set(row.tripId, front);
  }
  return fronts;
}

/**
 * Everything the Today queue needs, in one pass. Every signal is derived from a
 * source-of-truth model, so this never becomes a second place where operational
 * state is decided.
 */
/**
 * How far back a departure may have started and still be out. Two weeks is
 * past any boat day or liveaboard this product schedules; the bound is what
 * lets the read use the `(shop_id, starts_at)` index instead of every past
 * departure the shop has run.
 */
const OUT_LOOKBACK_MS = 14 * 24 * HOUR_MS;

/**
 * The bookings whose standing result at their departure's **last** after-dive
 * checkpoint is `boarded`: counted back aboard with no dive left to make. The
 * newest result per booking wins, so a later `cleared` or `not_boarded`
 * takes the booking back out (the supersession every roll-call reader here
 * applies).
 */
async function boardedAfterLastDive(
  db: AppDb,
  shopId: string,
  departures: readonly { id: string; plannedDives: number }[],
): Promise<Set<string>> {
  const counted = new Set<string>();
  if (departures.length === 0) return counted;
  const lastCheckpoint = new Map(
    departures.map((trip) => [trip.id, `after_dive_${Math.max(1, trip.plannedDives)}`]),
  );
  const rows = await db
    .select({
      tripId: rollCallEvents.tripId,
      bookingId: markBookingId(),
      checkpoint: rollCallEvents.checkpoint,
      status: rollCallEvents.status,
    })
    .from(rollCallEvents)
    .where(
      and(
        eq(rollCallEvents.shopId, shopId),
        seatMarks(),
        inArray(
          rollCallEvents.tripId,
          departures.map((trip) => trip.id),
        ),
        // The meeting day out now: day one's last count is not day two's (#2557).
        currentMeetingDayMarks(),
      ),
    )
    .orderBy(...newestMarkFirst());
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.checkpoint !== lastCheckpoint.get(row.tripId)) continue;
    if (seen.has(row.bookingId)) continue;
    seen.add(row.bookingId);
    if (row.status === "boarded") counted.add(row.bookingId);
  }
  return counted;
}

/**
 * **Blocked divers aboard a boat that is still out** (issue #2064).
 *
 * Every other readiness row on Today comes from the forward-looking horizon
 * (`inHorizonReadiness`), which drops a departure an hour after it sails. That
 * is right for an ashore blocker, which nobody can act on once the boat has
 * gone, and wrong for a diver who boarded on a medical hold or with no
 * release: they may be in the water now, which is when their "Aboard" row
 * matters most. So this reads the departures that have left that window and
 * are not back yet, by the departure stage pill's own rule (`tripPhaseOf`: the
 * crew's tap beats the clock, so a late boat stays out and one that tied up
 * early is home), and keeps only divers the crew counted aboard at any of its
 * checkpoints (`listBoardedAtAnyCheckpointByTrip`, issue #2142).
 *
 * **A boarding outranks a later desk cancel**, as it does for the fly-safe
 * reader (issue #1836). Both roll-call writers refuse a cancelled departure, so
 * a standing `boarded` at any checkpoint is older than the cancel and was true when
 * it was made: the people it names are on that boat. A cancelled departure
 * nobody boarded is not out at all, so its rows never leave the week count.
 *
 * Bounded: one trips read on the `(shop_id, starts_at)` index, then the stage,
 * departure roll call and readiness reads keyed on the handful of departures
 * that are out, and nothing at all on a day with no boat out.
 */
async function blockedAboardOnBoatsOut(
  db: AppDb,
  shopId: string,
  timeZone: string,
  now: Date,
  inWindowTripIds: ReadonlySet<string>,
) {
  const sailed = await db
    .select({
      id: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      status: trips.status,
      plannedDives: trips.plannedDives,
    })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        // No status filter: a desk cancel written after the boat left does
        // not bring anybody ashore. A cancelled departure stays only when its
        // dock roll call says somebody boarded (below).
        liveTrip(),
        gte(trips.startsAt, new Date(now.getTime() - OUT_LOOKBACK_MS)),
        lte(trips.startsAt, now),
      ),
    )
    .orderBy(asc(trips.startsAt), asc(trips.title), asc(trips.id));
  // A departure still inside the horizon is a live station already, and its
  // blocked divers come through the ordinary path with `aboard` set there.
  const candidates = sailed.filter((trip) => !inWindowTripIds.has(trip.id));
  if (candidates.length === 0) return { out: [], blocked: [] };
  const [stages, meetingWindows] = await Promise.all([
    latestTripStagesByTrip(
      db,
      shopId,
      candidates.map((trip) => trip.id),
    ),
    meetingWindowsByTrip(db, candidates),
  ]);
  const byClock = candidates.filter(
    (trip) =>
      tripPhaseOf({
        startsAt: trip.startsAt,
        endsAt: trip.endsAt,
        now,
        timeZone,
        stage: stages.get(trip.id) ?? null,
        meetingWindows: meetingWindows.get(trip.id),
        // Deliberately the scheduled reading even for a cancelled row: the
        // question is whether the boat is on the water, and the roll call
        // below decides whether a cancelled one ever left.
        cancelled: false,
      }) === "aboard",
  );
  if (byClock.length === 0) return { out: [], blocked: [] };
  // Boarded at the dock *or* first counted aboard at a later checkpoint — a
  // diver picked up at the second site is on this boat too (issue #2142).
  const boardedAnywhere = await listBoardedAtAnyCheckpointByTrip(
    db,
    shopId,
    byClock.map((trip) => trip.id),
  );
  const out = byClock.filter(
    (trip) => trip.status === "scheduled" || (boardedAnywhere.get(trip.id)?.size ?? 0) > 0,
  );
  if (out.length === 0) return { out: [], blocked: [] };
  const outIds = out.map((trip) => trip.id);
  const [readiness, countedBackAfterLastDive] = await Promise.all([
    listTripsReadiness(db, shopId, outIds, now),
    boardedAfterLastDive(db, shopId, out),
  ]);
  // The row is about somebody who may be in the water. A diver the crew
  // counted back aboard after the boat's last dive is not, however long the
  // ride home: the evening's "All boats are home" line is drawn from exactly
  // that count, and the two must not disagree.
  const blocked = readiness.filter(
    (row) =>
      row.readiness.status === "blocked" &&
      boardedAnywhere.get(row.booking.tripId)?.has(row.booking.id) === true &&
      !countedBackAfterLastDive.has(row.booking.id),
  );
  return { out, blocked };
}

type DepartureTrip = HorizonReadinessEvidence["trips"][number];

/**
 * What a departure card reads beyond readiness and the roll call: what its
 * divers came for, the hull it sails on, and who crews it. Shared by today's
 * stations (`getTodayWork`) and tomorrow's (`getShopDayDepartures`), so the two
 * disclosures can never draw a card from different readers.
 */
async function departureCardFacts(
  db: AppDb,
  shopId: string,
  trips: readonly DepartureTrip[],
  /** The horizon pass's meeting windows: every trip here is one of its trips, so none is read again. */
  meetingWindows: Awaited<ReturnType<typeof meetingWindowsByTrip>>,
) {
  const tripIds = trips.map((t) => t.id);
  // What the divers on these boats came for, as counts (issue #1386).
  // **One query for the whole day**, keyed on the trip ids already in hand —
  // one call per station is the shape this is written to avoid, and the reader
  // leaves departures nobody answered on out of its map entirely, so an
  // absent entry is the ordinary "nobody said" rather than a case to test for.
  //
  // The hull each departure sails on, for the station's meta line.
  // A bounded lookup keyed on the trips already in hand rather than a join
  // widened into `pagedUpcomingTripsWithCounts`: that reader also feeds the
  // public schedule and the booking picker, neither of which has any business
  // knowing a boat's name.
  const boatIds = [
    ...new Set(trips.map((trip) => trip.boatId).filter((id): id is string => Boolean(id))),
  ];
  const [diveIntents, boatRows, assignments, plannedSites] = await Promise.all([
    diveIntentTallyForTrips(db, shopId, tripIds),
    boatIds.length > 0
      ? db
          .select({ id: boats.id, name: boats.name })
          .from(boats)
          .where(and(eq(boats.shopId, shopId), inArray(boats.id, boatIds)))
      : [],
    tripIds.length > 0
      ? db
          .select({
            tripId: tripAssignments.tripId,
            personId: people.id,
            fullName: people.fullName,
            tripRole: tripAssignments.tripRole,
            role: personRoles.role,
          })
          .from(tripAssignments)
          .innerJoin(people, eq(people.id, tripAssignments.personId))
          .leftJoin(personRoles, eq(personRoles.personId, people.id))
          .where(inArray(tripAssignments.tripId, tripIds))
          // **By name, because otherwise there is no order at all.** Without
          // this the crew line renders in whatever order the database hands
          // back, which is not stable: the same departure read "Keiko Tanaka,
          // Sal Moretti" on one render and "Sal Moretti, Keiko Tanaka" on the
          // next, and a visual baseline caught it flapping between two runs of
          // identical seeded data. A shop reading its own board twice in a
          // morning should not have to wonder what changed. `personId` breaks
          // a tie between two people with the same name, so the order is total
          // rather than merely usually-stable. Matches `listTripCrew`
          // (src/db/trips-crew.ts), which already sorted by name.
          .orderBy(asc(people.fullName), asc(people.id))
      : [],
    plannedSitesByTrip(db, tripIds),
  ]);
  const boatNames = new Map(boatRows.map((row) => [row.id, row.name] as const));

  // What each person is doing on *this* boat when the roster says so, otherwise
  // their standing roles — `effectiveCrewRoles` (src/lib/crew-roles.ts), the one
  // definition. This used to be re-implemented inline right here, a sixth copy
  // of a rule that already had a home (review 20260803, D8); the standing role
  // list is true and misleading at once on a board whose whole question is "who
  // is doing what today", so it is worth exactly one implementation.
  const namesByPerson = new Map(assignments.map((row) => [row.personId, row.fullName] as const));
  const rowsByTrip = new Map<string, typeof assignments>();
  for (const row of assignments) {
    const list = rowsByTrip.get(row.tripId) ?? [];
    list.push(row);
    rowsByTrip.set(row.tripId, list);
  }
  const crewByTrip = new Map<string, { id: string; fullName: string; roles: string[] }[]>();
  for (const [tripId, rows] of rowsByTrip) {
    crewByTrip.set(
      tripId,
      groupCrewAssignments(rows).map((member) => ({
        id: member.personId,
        fullName: namesByPerson.get(member.personId) ?? "",
        roles: effectiveCrewRoles(member),
      })),
    );
  }

  return { diveIntents, boatNames, crewByTrip, meetingWindows, plannedSites };
}

type DepartureCardInputs = Awaited<ReturnType<typeof departureCardFacts>> & {
  readinessByTrip: HorizonReadinessEvidence["readinessByTrip"];
  departureRollCall: Awaited<ReturnType<typeof listDepartureRollCallByTrip>>;
  departureCrewRollCall: Awaited<ReturnType<typeof listDepartureCrewRollCallByTrip>>;
  stagesByTrip: Awaited<ReturnType<typeof latestTripStagesByTrip>>;
  meetingWindows: Awaited<ReturnType<typeof meetingWindowsByTrip>>;
};

/** One shop-day's departure cards, from facts already read. No queries. */
function summarizeDepartures(
  trips: readonly DepartureTrip[],
  inputs: DepartureCardInputs,
  now: Date,
  timeZone: string,
): DepartureSummary[] {
  const {
    readinessByTrip,
    departureRollCall,
    departureCrewRollCall,
    stagesByTrip,
    diveIntents,
    boatNames,
    crewByTrip,
    meetingWindows,
    plannedSites,
  } = inputs;
  return trips.map((trip) => {
    const rows = readinessByTrip.get(trip.id) ?? [];
    const blockedRows = rows.filter((row) => row.readiness.status === "blocked");
    const rollCall = departureRollCall.get(trip.id) ?? new Map();
    let aboardCount = 0;
    for (const state of rollCall.values()) if (state === "boarded") aboardCount += 1;
    const aboardBlocked = blockedRows.filter((row) => rollCall.get(row.booking.id) === "boarded");
    // `not_boarded` drops out **only once the boat has actually gone.**
    //
    // At the departure checkpoint that result means "never left the dock",
    // which is benign and accounted for — but the control a deckhand taps is
    // labelled "Mark not boarded", and at 07:05 on a 07:30 boat that reads as
    // "isn't aboard yet", not "isn't coming". This card lives from the moment a
    // trip is scheduled until about an hour after it sails, so silencing on the
    // tap alone took the prompt off the front desk 25 minutes before it stopped
    // being fixable (found by `dive-domain-expert` after #698 shipped). The
    // same 1-hour buffer every other "has it sailed" question in this app uses.
    const ashoreBlocked = blockedRows.filter((row) => {
      const result = rollCall.get(row.booking.id);
      if (result === "boarded") return false;
      if (result === undefined) return true;
      return !hasSailed(trip.startsAt, now);
    });
    // The crew list this trip names *now*, each carrying their own departure
    // result — the shape `rollCallCompleteness` requires, so that the verdict
    // Today renders is literally the manifest's own.
    const tripCrew = crewByTrip.get(trip.id) ?? [];
    const crewResults = departureCrewRollCall.get(trip.id) ?? new Map();
    const completeness = rollCallCompleteness({
      checkpoint: "departure",
      totalDivers: rows.length,
      awaiting: rows.filter((row) => rollCall.get(row.booking.id) === undefined).length,
      // Structurally zero at departure — there is no dive to not come back
      // from yet — and passed anyway, because the signature refuses to let a
      // caller quietly omit the half that means somebody is in the water.
      notBackAboard: 0,
      crew: tripCrew.map((member) => {
        const state = crewResults.get(member.id);
        return state ? { rollCall: { state, implied: false } } : {};
      }),
    });
    return {
      tripId: trip.id,
      title: trip.title,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      booked: trip.booked,
      capacity: trip.capacity,
      sellableCapacity: trip.sellableCapacity,
      rehearsal: trip.isRehearsal,
      ready: rows.filter((row) => row.readiness.status === "ready").length,
      blocked: blockedRows.length,
      boarded: aboardCount,
      blockedAboard: aboardBlocked.length,
      blockedAshore: ashoreBlocked.length,
      blockedAshoreNames: ashoreBlocked.map((row) => row.person.fullName),
      courseTitle: trip.course?.title ?? null,
      siteName: siteLine(plannedSites.get(trip.id)),
      boatName: trip.boatId ? (boatNames.get(trip.boatId) ?? null) : null,
      priceCents: trip.isRehearsal ? null : perDiverBookingPriceCents(trip, trip.course),
      crew: tripCrew,
      crewAccountedFor: completeness.crewAccountedFor,
      crewReason: completeness.crewReason,
      // The chip's one rule (`boatStageOf`), read off the raw tap like the
      // header and the manifest strip, so a card cannot say a word the boat's
      // own pages do not.
      stage: boatStageOf({
        startsAt: trip.startsAt,
        endsAt: trip.endsAt,
        now,
        timeZone,
        stage: stagesByTrip.get(trip.id) ?? null,
        cancelled: false,
        meetingWindows: meetingWindows.get(trip.id),
      }),
      // Absent from the map means nobody aboard answered, and an empty tally is
      // what makes the station render no line at all.
      intents: diveIntents.get(trip.id) ?? [],
    };
  });
}

/**
 * **One shop-day's departure cards and nothing else** - the Tomorrow
 * disclosure on the shop home (app audit 2026-10-07, item 2).
 *
 * The home used to read tomorrow by calling {@link getTodayWork} a second
 * time at noon tomorrow and keeping only its `departures`: the whole action
 * queue - about forty statements of fit, nitrox, contact, waitlist, delivery,
 * staffing, payments, reviews, gear - assembled and thrown away, because the
 * spine files every job from *today's* queue (`assembleDaySpine`). This reads
 * only what a card shows, through the same readers and the same summarizer
 * `getTodayWork` builds its own stations with, so a card cannot read
 * differently in the two disclosures.
 *
 * `day` is any instant inside the shop-day wanted (the home passes noon), and
 * it is also the "now" the cards are drawn at - exactly what the second
 * `getTodayWork` call used to pass. `evidence` is the request's one readiness
 * pass; the day's boats are drawn from its horizon.
 */
export async function getShopDayDepartures(
  db: AppDb,
  shopId: string,
  timeZone: string,
  day: Date,
  evidence: HorizonReadinessEvidence,
): Promise<DepartureSummary[]> {
  const wanted = shopDay(day, timeZone);
  // By meeting day (#2557), as `getTodayWork` reads today's own cards.
  const trips = evidence.trips.filter((trip) =>
    (evidence.meetingDays.get(trip.id) ?? [trip]).some(
      (d) => shopDay(d.startsAt, timeZone) === wanted,
    ),
  );
  if (trips.length === 0) return [];
  const tripIds = trips.map((trip) => trip.id);
  const [departureRollCall, departureCrewRollCall, stagesByTrip, facts] = await Promise.all([
    listDepartureRollCallByTrip(db, shopId, tripIds),
    listDepartureCrewRollCallByTrip(db, shopId, tripIds),
    latestTripStagesByTrip(db, shopId, tripIds),
    departureCardFacts(db, shopId, trips, evidence.meetingDays),
  ]);
  return summarizeDepartures(
    trips,
    {
      readinessByTrip: evidence.readinessByTrip,
      departureRollCall,
      departureCrewRollCall,
      stagesByTrip,
      ...facts,
    },
    day,
    timeZone,
  );
}

/**
 * The Today row's nav badge: blocked divers on the next boat day, plus those
 * aboard a boat still out (`blockedOnNextBoatDay` in `./blockers` says which
 * day and why). The same derivation the shop home's cards and summary read,
 * over the same two reads, so the three cannot disagree.
 */
export async function countBlockedDiversNextBoatDay(
  db: AppDb,
  shopId: string,
  clock: ShopClock,
): Promise<NextBoatDayBlocked> {
  const { timeZone, now } = clock;
  const evidence = await sharedInHorizonReadiness(db, shopId, now);
  const boatsOut = await blockedAboardOnBoatsOut(
    db,
    shopId,
    timeZone,
    now,
    new Set(evidence.trips.map((trip) => trip.id)),
  );
  const aboard = boatsOut.blocked.filter((row) => isBlockedAboard(row.readiness.blockers)).length;
  return blockedOnNextBoatDay(evidence, timeZone, now, aboard);
}

/**
 * The automated marine forecast for each in-window departure that would show
 * one — booked, inside the provider's ten-day window, at a site with a forecast
 * point — keyed by trip. Every lookup starts at once; departures to one site
 * share one provider request through `fetchAutomatedMarineForecast`'s cache,
 * so this is one request per distinct site, never one per trip in series. A
 * site the provider cannot answer for maps to null, as it always did.
 */
async function forecastsForDepartures(
  db: AppDb,
  trips: readonly DepartureTrip[],
  now: Date,
): Promise<Map<string, AutomatedMarineForecast | null>> {
  const plannedSites = await plannedSitesByTrip(
    db,
    trips.map((trip) => trip.id),
  );
  const wanted = trips.flatMap((trip) => {
    if (trip.booked <= 0 || !shouldShowAutomatedForecast(trip.startsAt, now)) return [];
    // Every planned site with a forecast point, not only the first dive's: a
    // two-site morning is as windy as its windier site.
    return (plannedSites.get(trip.id) ?? []).flatMap((site) =>
      site.forecastLatitude === null || site.forecastLongitude === null
        ? []
        : [
            {
              tripId: trip.id,
              point: { latitude: site.forecastLatitude, longitude: site.forecastLongitude },
              startsAt: trip.startsAt,
            },
          ],
    );
  });
  const forecasts = await Promise.all(
    wanted.map((entry) => fetchAutomatedMarineForecast(entry.point, entry.startsAt)),
  );
  const byTrip = new Map<string, AutomatedMarineForecast | null>();
  wanted.forEach((entry, index) => {
    const forecast = forecasts[index] ?? null;
    const kept = byTrip.get(entry.tripId) ?? null;
    byTrip.set(entry.tripId, windier(kept, forecast));
  });
  return byTrip;
}

/** The forecast with the harder wind (gusts, else speed); a missing one yields to a present one. */
function windier(
  a: AutomatedMarineForecast | null,
  b: AutomatedMarineForecast | null,
): AutomatedMarineForecast | null {
  if (!a?.wind) return b ?? a;
  if (!b?.wind) return a;
  const force = (wind: NonNullable<AutomatedMarineForecast["wind"]>) =>
    wind.gustsKnots ?? wind.speedKnots;
  return force(b.wind) > force(a.wind) ? b : a;
}

/** The departure card's site line: every planned site, once, in dive order. */
function siteLine(sites: readonly { name: string }[] | undefined): string | null {
  return sites && sites.length > 0 ? sites.map((site) => site.name).join(", ") : null;
}

/**
 * Every seat a payment row could be about: a blocked one in the window that
 * owes money (`blockedDiverActions` raises a payment row from no other).
 */
function owingSeatIds(
  trips: readonly DepartureTrip[],
  readinessByTrip: HorizonReadinessEvidence["readinessByTrip"],
): string[] {
  return trips.flatMap((trip) =>
    (readinessByTrip.get(trip.id) ?? [])
      .filter(
        (row) =>
          row.readiness.status === "blocked" &&
          row.readiness.blockers.some((blocker) => BLOCKER_CATEGORY[blocker.code] === "payment"),
      )
      .map((row) => row.booking.id),
  );
}

/**
 * **The high-wind rows, off the page's critical path** (code review
 * 2026-10-11, item 1). The forecast is the one read on Today that is not the
 * database: two outbound requests with four-second timeouts and a cache that
 * lives as long as one lambda. The queue used to await it inside its wave, so a
 * cold lambda held the shop's most-opened page for as long as Open-Meteo took.
 *
 * Now the queue returns these rows as a promise beside its answer, and the page
 * streams them under their own `<Suspense>` (`DaySpine`'s `highWind`), the way
 * both trip pages stream their conditions line. Filtered for the reader's
 * roles like every other row, and never rejected: a provider that fails
 * answers null per site, which raises no row, as it always did.
 */
async function highWindActions(
  trips: readonly DepartureTrip[],
  forecastsByTrip: Promise<Map<string, AutomatedMarineForecast | null>>,
  context: {
    shopSlug: string;
    timeZone: string;
    locale: string;
    t: StaffTranslator;
    roles: readonly Role[] | undefined;
  },
): Promise<TodayAction[]> {
  const forecasts = await forecastsByTrip.catch(
    () => new Map<string, AutomatedMarineForecast | null>(),
  );
  const { shopSlug, timeZone, locale, t } = context;
  const rows: TodayAction[] = [];
  for (const trip of trips) {
    const forecast = forecasts.get(trip.id) ?? null;
    if (!forecast?.wind || !isHighWind(forecast.wind)) continue;
    const when = at(trip.startsAt, timeZone, locale);
    rows.push({
      id: `high-wind:${trip.id}`,
      kind: "high_wind_alert",
      urgency: "now",
      subject: trip.title,
      context: when,
      departure: { tripId: trip.id, label: `${trip.title} · ${when}` },
      aboutDeparture: true,
      detail: highWindAlertDetailText(
        t,
        forecast.wind.speedKnots,
        forecast.wind.gustsKnots,
        forecast.wind.direction ? forecast.wind.direction.toUpperCase() : null,
      ),
      actionLabel: openTripActionText(t),
      href: `/shop/${shopSlug}/trips/${trip.id}`,
      dueAt: trip.startsAt,
    });
  }
  return filterActionsForRoles(rows, context.roles);
}

/** What the Today queue's one wave of reads answers. */
export type TodayWave = Awaited<ReturnType<typeof readTodayWave>>;

// **One wave.** Every read below takes only the shop, the window and the
// clock, so none waits on another: they used to run as this fan-out plus
// thirteen single reads one after another further down, each a round trip
// on the shop's most-opened page (code review 2026-10-10, item 2). The rows
// are still pushed in the order they always were; only the reads moved.
async function readTodayWave(
  db: AppDb,
  shopId: string,
  input: {
    now: Date;
    horizon: Date;
    timeZone: string;
    inWindow: HorizonReadinessEvidence["trips"];
    todayTrips: HorizonReadinessEvidence["trips"];
    meetingDays: HorizonReadinessEvidence["meetingDays"];
    todayTripIds: string[];
    todayLocal: string;
    bookingIdsByTrip: Map<string, string[]>;
    includeOpsAlerts: boolean;
    personId: string | undefined;
    /** The signed-in reader, for the rows only some roles may see (re-checked live). */
    viewerPersonId: string | undefined;
    owingBookingIds: string[];
    noOpenOrders: Map<string, { id: string; hostedInvoiceUrl: string | null }>;
  },
) {
  const {
    now,
    horizon,
    timeZone,
    inWindow,
    todayTrips,
    meetingDays,
    todayTripIds,
    todayLocal,
    bookingIdsByTrip,
    includeOpsAlerts,
    personId,
    viewerPersonId,
    owingBookingIds,
    noOpenOrders,
  } = input;
  // The shop's Stripe account, read at most once in this wave whoever asks
  // first: the owner's restricted-payments row and the payment rows' invoice
  // controls both read it. In a render it is also the page's own read
  // (`shopStripeAccountForRender`'s `cache()`).
  let accountRead: ReturnType<typeof shopStripeAccountForRender> | undefined;
  const stripeAccount = () => {
    accountRead ??= shopStripeAccountForRender(db, shopId);
    return accountRead;
  };
  const [
    departureRollCall,
    departureCrewRollCall,
    boatWork,
    seatWanted,
    courseCrewCounts,
    deliveryIssues,
    lastMinuteWindows,
    rollCallGaps,
    stagesByTrip,
    crewClashState,
    boardedAnywhere,
    sharedWelcomeSeats,
    { open: helpRequests, handled: handledHelp },
    rawStaff,
    credentialRows,
    { diveIntents, boatNames, crewByTrip, meetingWindows, plannedSites },
    boatsOut,
    opsAlerts,
    reviewsAwaiting,
    unanswered,
    openDateRequests,
    shopUnits,
    [overdueGear, dueBackGear, gearServiceDueRows, fitAdjustedReturns],
    boatSafety,
    workOrdersNeedingAttention,
    crewedAssignments,
    openOrders,
    unfiledIncidentDrafts,
    crewAway,
    boatSnags,
  ] = await Promise.all([
    // Each booking's latest departure result, not just a head count. The card
    // needs to tell "already aboard" from "still ashore" from "never left the
    // dock", and one number cannot (issue #698). Read through the one reader
    // that owns the question (`src/db/manifests.ts`) — a second hand-written
    // copy of this query used to live here, and only one of the two carried the
    // cancelled-booking guard.
    listDepartureRollCallByTrip(
      db,
      shopId,
      todayTrips.map((trip) => trip.id),
    ),
    // The crew half of the same checkpoint. Read for the same reason the diver
    // half is — the card has to tell an accounted-for boat from one where
    // somebody may still be in the water, and the diver count alone cannot
    // (issue #789).
    listDepartureCrewRollCallByTrip(
      db,
      shopId,
      todayTrips.map((trip) => trip.id),
    ),
    // The boat's work, one reader shared with the trip's own band
    // (`./boat-work`): sizes, nitrox, contacts and open orders per departure.
    readBoatWork(db, shopId, bookingIdsByTrip),
    seatWantedByTrip(
      db,
      shopId,
      inWindow.map((trip) => trip.id),
    ),
    // Every trip in the window, not just course sessions (issue #732): the
    // shop's own divemaster target below reads the same counts for a fun
    // dive, and `courseCrewCountsByTrip`'s query has never actually been
    // course-scoped — only every caller of it, until now, was.
    courseCrewCountsByTrip(
      db,
      shopId,
      inWindow.map((trip) => trip.id),
    ),
    listNotificationDeliveryIssues(db, shopId, { from: now, until: horizon }),
    // Who is even reachable by a blast. Not scoped to a trip: an entry is a
    // standing "I'm around these dates" preference, and which departures it
    // covers is arithmetic (`lastMinuteEntryMatchesTripDate`), done per trip
    // below against the same predicate the trip's own roster uses.
    listOpenAnytimeWindows(db, shopId),
    // Deliberately not derived from `inWindow`/`todayTrips`: those look only
    // forward, and a boat that is out or already came back is exactly what this
    // chases.
    listRollCallGaps(db, shopId, now),
    // One answer per boat in one pass, for the same reason the roll call reads
    // that way: a station-by-station read would be a query per departure.
    latestTripStagesByTrip(
      db,
      shopId,
      todayTrips.map((trip) => trip.id),
    ),
    // Who is on two boats at once, on every departure the queue holds and on
    // every boat still out (H-20260916-may-one-hull-carry) — one batched read.
    standingCrewClashes(db, shopId, inWindow, now, timeZone),
    // Who is on each of today's boats for the blocked rows' "Aboard" mark: the
    // same any-checkpoint rule the boats-out path below reads, so a diver
    // picked up at the second site is aboard on both (issue #2142).
    listBoardedAtAnyCheckpointByTrip(
      db,
      shopId,
      todayTrips.map((trip) => trip.id),
    ),
    // Who on today's boats said the crew may know it is their first trip, or
    // that they are back after a long gap (issue #1182, delight report D22).
    // Today's departures only: a cue is permission for one day, and a row about
    // Thursday's boat on Tuesday morning would be a badge with a date on it.
    sharedWelcomeSeatsByTrip(db, shopId, todayTripIds, now),
    listTodayHelpWork(db, shopId, todayTripIds, now),
    listStaff(db, shopId),
    listStaffCredentials(db, shopId),
    // What each card shows beyond readiness and the roll call - intents, hull,
    // crew - read the one way tomorrow's cards read it too.
    departureCardFacts(db, shopId, todayTrips, meetingDays),
    // Blocked divers aboard a boat that has left the horizon but is not back
    // (issue #2064).
    blockedAboardOnBoatsOut(db, shopId, timeZone, now, new Set(inWindow.map((trip) => trip.id))),
    // Owner/manager chores (task 157), read only for a caller that passes
    // `includeOpsAlerts`; the rows are built further down.
    includeOpsAlerts
      ? Promise.all([
          // Each kind's Today cutoff from Today's own `now` (`ATTEMPT_RULES`).
          listUnfinished(db, shopId, "payment_operation", {
            olderThan: raisedOnTodayBefore("payment_operation", now),
          }),
          listUnfinished(db, shopId, "media_deletion", {
            olderThan: raisedOnTodayBefore("media_deletion", now),
          }),
          listUnfinished(db, shopId, "shop_cancellation_refund", {
            olderThan: raisedOnTodayBefore("shop_cancellation_refund", now),
          }),
          listOpenPaymentDisputes(db, shopId),
          stripeAccount().then(paymentsRestrictedSince),
        ])
      : null,
    readReviewsAwaitingModeration(db, shopId),
    countUnansweredMessages(db, shopId),
    // Open date requests count into the same unanswered row (issue #2658);
    // with date requests switched off, only course inquiries do.
    countWaitingDateInterests(db, shopId),
    db
      .select({
        unitsConfirmedAt: shops.unitsConfirmedAt,
        currency: shops.currency,
        depthUnit: shops.depthUnit,
        // The blank-card desk row (fifth loop, item 3) rides this read.
        emergencyReference: shops.emergencyReference,
        temperatureUnit: shops.temperatureUnit,
        // The Features switches whose rows this queue raises (Lost and found,
        // gear servicing): off, their rows are dropped after the wave.
        lostFoundEnabled: shops.lostFoundEnabled,
        workOrdersEnabled: shops.workOrdersEnabled,
      })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1)
      .then((rows) => rows[0]),
    Promise.all([
      listOverdueGearReservations(db, shopId, todayLocal),
      listGearDueBack(db, shopId, todayLocal),
      // Six days, not seven: dueAt below is the *shop-local* midnight of the due
      // date, and the queue's one-week-horizon invariant is measured in flat UTC
      // hours — a seventh local day can poke past it by a DST hour.
      listGearServiceDue(db, shopId, todayLocal, 6),
      // Bounded to the shop's own day on purpose (issue #1174, D14): a question
      // that came back every evening until somebody answered it would be a nag.
      // Asked once, tonight.
      listFitAdjustedReturns(db, shopId, shopDayBounds(now, timeZone)),
    ]),
    todayBoatSafety(db, shopId, {
      todayLocal,
      departures: todayTrips.flatMap((trip) =>
        trip.boatId ? [{ tripId: trip.id, boatId: trip.boatId }] : [],
      ),
    }),
    listWorkOrdersNeedingAttention(db, shopId, { todayLocal, timezone: timeZone }),
    // Which of the day's trips this person crews, when the caller asked.
    personId
      ? readerCrewedTrips(db, shopId, personId, {
          windowTripIds: inWindow.map((trip) => trip.id),
          dayStart: shopDayBounds(now, timeZone).from,
          now,
        })
      : null,
    // The payment rows' invoice controls (below): the open order behind each
    // owing seat, read only when the shop's own Stripe account can take a
    // charge. Every payment row is an owing seat in this window, so those
    // seats are the whole set to ask about, known before the wave —
    // this used to be two reads one after another after it (code review
    // 2026-10-11, item 26). The account is the page's own read, shared per
    // render (`shopStripeAccountForRender`).
    owingBookingIds.length === 0
      ? noOpenOrders
      : stripeAccount().then((account) =>
          canAcceptPayments(account)
            ? openOrdersForBookings(db, shopId, owingBookingIds)
            : noOpenOrders,
        ),
    // Incident reports started and never filed (safety sheet 2026-10-15, item
    // 3): read for a named reader only, and answered for owners and managers
    // only (`listUnfiledIncidentDrafts` re-reads their roles). A caller reading
    // the shop's whole day with nobody behind it (the digest) gets none.
    viewerPersonId ? listUnfiledIncidentDrafts(db, shopId, viewerPersonId) : [],
    // Who is rostered on a departure ahead and said they are away on a day it
    // meets (fourth review, item 12): the `crew_away` rows.
    crewAwayByTrip(
      db,
      shopId,
      inWindow.map((trip) => trip.id),
      timeZone,
    ),
    // Problems a crew wrote against a boat's checklist, still open (fifth-loop
    // ideas, item 1): the `boat_snag` rows.
    openSnagsForShop(db, shopId, now),
  ]);
  return {
    departureRollCall,
    departureCrewRollCall,
    boatWork,
    seatWanted,
    courseCrewCounts,
    deliveryIssues,
    lastMinuteWindows,
    rollCallGaps,
    stagesByTrip,
    crewClashState,
    boardedAnywhere,
    sharedWelcomeSeats,
    helpRequests,
    handledHelp,
    rawStaff,
    credentialRows,
    diveIntents,
    boatNames,
    crewByTrip,
    meetingWindows,
    plannedSites,
    boatsOut,
    opsAlerts,
    reviewsAwaiting,
    unanswered,
    openDateRequests,
    shopUnits,
    overdueGear,
    dueBackGear,
    gearServiceDueRows,
    fitAdjustedReturns,
    boatSafety,
    workOrdersNeedingAttention,
    crewedAssignments,
    openOrders,
    unfiledIncidentDrafts,
    crewAway,
    boatSnags,
  };
}

export async function getTodayWork(
  db: AppDb,
  shopId: string,
  shopSlug: string,
  clock: ShopClock,
  /** When set, the result carries which in-window trips this person crews. */
  personId: string | undefined,
  /**
   * Resolves the blocked-diver rows' `detail`/`actionLabel` text
   * (`blockedDiverActions`, `src/features/today/today.ts`). The caller passes
   * its own request-locale translator.
   */
  t: StaffTranslator,
  /** Formats every departure time (`at()`). */
  locale = "en-US",
  /**
   * Stuck Stripe operations and failed photo-deletion retries (task 157) are
   * owner/manager chores — the same accountable gate Reports' monthly view
   * already uses (ADR 20260723-owner-reporting) — so they only join the queue
   * when a caller that has already checked `canViewShopReports` passes true.
   * Defaults false so every pre-existing caller (tests included) keeps
   * getting the diver-blocker-only queue.
   */
  includeOpsAlerts = false,
  /**
   * Precomputed horizon evidence from `inHorizonReadiness` (`./blockers`),
   * when the caller already ran the pass for another readiness surface in the
   * same request — the shop home passes it so its by-departure view doesn't
   * pay for the pipeline twice. Omitted, the queue runs its own.
   */
  evidence?: HorizonReadinessEvidence,
  /**
   * The shop's own divemaster target (`shops.divers_per_divemaster`), for the
   * `uncrewed_departure`/`crew_below_target` rows (issue #732). Defaults to
   * `DEFAULT_DIVERS_PER_DIVEMASTER` alongside `t`/`locale` above, for the same
   * reason: every pre-existing caller (tests included) keeps working
   * unchanged. The close-out surface's own read of this queue
   * (`src/features/today/closeout-reader.ts`) accepts that default rather than threading the
   * shop row the rest of the way down its call chain for a queue it only
   * reads as leftovers.
   */
  diversPerDivemaster: number | null = DEFAULT_DIVERS_PER_DIVEMASTER,
  /**
   * The viewer's roles, for filtering the action queue to the relevant audience
   * (issue #715). Multi-role viewers see the union; owners and managers see all.
   * Omitted, all actions are returned.
   */
  roles?: readonly Role[],
  /**
   * Whether to ask the marine forecast provider for the high-wind rows. A
   * caller that never reads `highWind` (the weekly digest) passes false: no
   * request goes out and `highWind` resolves to `[]`. Defaults true.
   */
  withForecast = true,
  /**
   * The signed-in reader, for the one row whose reading depends on who they
   * are rather than their JWT's roles: the unfiled incident reports, owners
   * and managers only, re-checked live. Omitted, that row is never raised.
   */
  viewerPersonId?: string,
): Promise<TodayWork> {
  const { timeZone, now } = clock;
  // The one horizon every readiness surface shares (src/lib/operational-window.ts).
  const { to: horizon } = operationalWindow(now);
  // One batched readiness pass for the whole window, not one per trip. The
  // per-trip call issues about ten queries of its own, so a six-departure
  // morning was sixty round trips to render the shop's most-visited page;
  // `inHorizonReadiness` bounds the fetch with the already-existing keyset
  // page and answers readiness for every trip at once.
  const {
    trips: inWindow,
    upcoming,
    readinessByTrip,
    meetingDays: horizonMeetingDays,
  } = evidence ?? (await inHorizonReadiness(db, shopId, now));
  // Today is the clock's own day, the same exact pair `todaysDepartures` reads.
  // By meeting day (#2557): day two of a course is today's departure on day
  // two (`meetingWindowsByTrip`, read once for the whole horizon).
  const todayTrips = inWindow.filter((trip) =>
    meetsOnShopDay(trip, horizonMeetingDays.get(trip.id) ?? [], clock.day),
  );
  const bookingIdsByTrip = new Map(
    inWindow.map((trip) => [
      trip.id,
      (readinessByTrip.get(trip.id) ?? []).map((row) => row.booking.id),
    ]),
  );

  // The shop's own calendar day, for the register, boat-papers and bench reads.
  const todayLocal = calendarDateInTimezone(now, timeZone);
  const todayTripIds = todayTrips.map((trip) => trip.id);

  // The marine forecast for every booked departure inside the provider's
  // window, started here and **never awaited by the queue**: the high-wind rows
  // it raises go back as a promise of their own (`highWindActions`). Departures
  // to one site share one request (`fetchAutomatedMarineForecast` keys its
  // cache and its in-flight promise by site), and a failed or slow provider
  // answers null.
  const owingBookingIds = owingSeatIds(inWindow, readinessByTrip);
  const noOpenOrders = new Map<string, { id: string; hostedInvoiceUrl: string | null }>();
  const highWind = withForecast
    ? highWindActions(inWindow, forecastsForDepartures(db, inWindow, now), {
        shopSlug,
        timeZone,
        locale,
        t,
        roles,
      })
    : Promise.resolve<TodayAction[]>([]);

  // **One wave** (`readTodayWave`): every read takes only the shop, the
  // window and the clock, so none waits on another. Beside it, the cards a
  // "certification pending" row could check (H-20261008-cert-check-extension), read now rather than
  // after the queue is built so they cost no phase of their own: every diver
  // the evidence blocks on a pending card is asked about, a superset of the
  // rows that end up carrying the offer (`attachAgencyChecks` keeps theirs).
  const [waveRead, agencyCheckCards, lostItemsFound] = await Promise.all([
    readTodayWave(db, shopId, {
      now,
      horizon,
      timeZone,
      inWindow,
      todayTrips,
      meetingDays: horizonMeetingDays,
      todayTripIds,
      todayLocal,
      bookingIdsByTrip,
      includeOpsAlerts,
      personId,
      viewerPersonId,
      owingBookingIds,
      noOpenOrders,
    }),
    listAgencyCheckableCards(db, {
      shopId,
      personIds: agencyCheckCandidates(readinessByTrip),
    }),
    // The found items waiting (fifth loop, item 7), beside the wave.
    countOpenLostItems(db, shopId, now),
  ]);
  // A feature the shop switched off on the Features page raises no row: the
  // reads above ran beside the shop row that says so, and what they found is
  // still there for when it is switched back on (`shop-features.ts`).
  // Gear servicing off keeps the shop's own units' late tickets: their service
  // is fleet safety, and the row opens the unit on the register instead.
  const wave =
    waveRead.shopUnits?.workOrdersEnabled === false
      ? {
          ...waveRead,
          workOrdersNeedingAttention: waveRead.workOrdersNeedingAttention
            .filter((row) => row.fleetUnitId !== null)
            .map((row) => ({ ...row, benchClosed: true as const })),
        }
      : waveRead;
  const lostItemsWaiting = waveRead.shopUnits?.lostFoundEnabled === false ? 0 : lostItemsFound;
  const {
    departureRollCall,
    departureCrewRollCall,
    stagesByTrip,
    crewClashState,
    helpRequests,
    handledHelp,
    rawStaff,
    diveIntents,
    boatNames,
    crewByTrip,
    meetingWindows,
    plannedSites,
    boatsOut,
    shopUnits,
    crewedAssignments,
    crewAway,
  } = wave;

  const helpRequestsByTrip = new Map<string, typeof helpRequests>();
  for (const request of helpRequests) {
    const requests = helpRequestsByTrip.get(request.tripId) ?? [];
    requests.push(request);
    helpRequestsByTrip.set(request.tripId, requests);
  }

  const availableStaff = rawStaff.map((s) => ({
    id: s.person.id,
    fullName: s.person.fullName,
    roles: s.roles,
  }));

  const actions: TodayAction[] = [];
  const rows: TodayRowsContext = {
    wave,
    inWindow,
    readinessByTrip,
    todayTrips,
    todayLocal,
    shopSlug,
    timeZone,
    locale,
    t,
    now,
    diversPerDivemaster,
    helpRequestsByTrip,
  };

  pushRollCallRows(actions, rows);
  pushBoatClashRows(actions, rows);

  pushCrewAwayRows(actions, rows);

  pushBoatSnagRows(actions, rows);

  pushDepartureRows(actions, rows);

  pushShopRows(actions, rows);

  // **The one first-run question a trading shop can still have open.**
  //
  // `units_confirmed_at` was read in exactly one place — the first-run
  // checklist on this page — and that checklist stops rendering at the shop's
  // first departure, which is step 4 of the same checklist. So a shop that
  // scheduled a trip before opening the Units row was never asked again and the
  // column stayed null for life, while the shop traded on a currency derived
  // from its timezone at sign-up. Currency is what a diver's card is charged
  // in, so a Cozumel shop could be selling in dollars having never been asked
  // (issue #835; Aaron chose this over a quieter badge in Settings, which only
  // the population least likely to need it would ever see).
  //
  // **Only once the checklist has gone**, which is the whole point: a shop
  // still being walked through setup is already being asked this, on the same
  // screen, as step 3. Asking twice at once would be noise, and the queue's
  // empty state is deliberately suppressed while the checklist is up (issue
  // #711), so a row here would drag it back onto a shop with no board.
  //
  // `countShopTrips` is the same signal the checklist itself is gated on, so
  // the two can never disagree about which is showing. It only runs for a shop
  // that has not answered — a confirmed shop pays nothing, which is every shop
  // after the first time.
  //
  // Self-gating like the gear rows below: answering the question empties the
  // row permanently, and a shop that answered it during onboarding never sees
  // one at all.
  if (shopUnits && !shopUnits.unitsConfirmedAt && (await countShopTrips(db, shopId)) > 0) {
    actions.push({
      id: "units:unconfirmed",
      kind: "units_unconfirmed",
      urgency: "later",
      // **Both guesses, and what to do about them.** The row used to ask the
      // question ("Which currency and depth unit does this shop work in?") and
      // then spend three clauses explaining where the guess came from. The two
      // derived values *are* the question, so the row states them.
      subject: unitsUnconfirmedSubjectText(t, {
        currency: shopUnits.currency.toUpperCase(),
        depthUnit: shopUnits.depthUnit,
        temperatureUnit: shopUnits.temperatureUnit,
      }),
      context: null,
      detail: unitsUnconfirmedDetailText(t),
      actionLabel: openUnitsActionText(t),
      href: `/shop/${shopSlug}/settings#units`,
      dueAt: null,
    });
  }

  pushEquipmentRows(actions, rows);

  pushDeskRows(actions, rows, {
    // A shop row that is not there has no card to warn about.
    emergencyCardHasNumbers: shopUnits
      ? emergencyCardHasNumbers(shopUnits.emergencyReference)
      : true,
    lostItemsWaiting,
  });

  // **Who to say hello to** rides on the card (fifth loop, item 10): one line
  // per departure, gone an hour after the boat is home because
  // `welcomeCueFor` stops returning a cue there.
  const departures = summarizeDepartures(
    todayTrips,
    {
      readinessByTrip,
      departureRollCall,
      departureCrewRollCall,
      stagesByTrip,
      diveIntents,
      boatNames,
      crewByTrip,
      meetingWindows,
      plannedSites,
    },
    now,
    timeZone,
  ).map((departure) => ({
    ...departure,
    welcome: (wave.sharedWelcomeSeats.get(departure.tripId) ?? []).flatMap((seat) => {
      const cue = welcomeCueFor({
        sharedAt: seat.sharedAt,
        lastDivedAt: seat.lastDivedAt,
        nonDiver: seat.nonDiver,
        diveDayCount: seat.diveDayCount,
        tripEndsAt: departure.endsAt,
        now,
      });
      return cue ? [{ name: seat.personName, cue }] : [];
    }),
  }));

  const next = todayTrips.length === 0 ? upcoming[0] : null;

  let crewedTripIds: string[] = [];
  let crewedSessions: CrewedSessionSummary[] = [];
  if (crewedAssignments) {
    const crewed = new Set(crewedAssignments.map((row) => row.tripId));
    // Every crewed trip, not only the window's: the dawn boat still out is a
    // card on the spine the window no longer holds (fourth review, item 14).
    crewedTripIds = [...crewed];
    crewedSessions = inWindow
      .filter((trip) => trip.course && crewed.has(trip.id))
      .map((trip) => {
        const rows = readinessByTrip.get(trip.id) ?? [];
        return {
          tripId: trip.id,
          title: trip.title,
          courseTitle: trip.course?.title ?? null,
          startsAt: trip.startsAt,
          booked: trip.booked,
          ready: rows.filter((row) => row.readiness.status === "ready").length,
          blocked: rows.filter((row) => row.readiness.status === "blocked").length,
          away: crewAway.get(trip.id)?.find((entry) => entry.personId === personId)?.blocks ?? [],
        };
      });
  }

  // **Each diver once per boat** (UX delight sheet 2026-10-22, item 4): folded
  // after the role filter, so a row names only the gaps its reader may see.
  const visibleActions = oneRowPerDiver(
    attachAgencyChecks(filterActionsForRoles(actions, roles), agencyCheckCards),
    t,
  );

  return {
    departures,
    actions: visibleActions,
    handledHelp,
    highWind,
    outTripIds: [
      ...new Set([...crewClashState.outTripIds, ...boatsOut.out.map((trip) => trip.id)]),
    ],
    blockedAboard: boatsOut.blocked.filter((row) => isBlockedAboard(row.readiness.blockers)).length,
    nextDeparture: next
      ? {
          title: next.title,
          startsAt: next.startsAt,
          tripId: next.id,
          booked: next.booked,
          sellableCapacity: next.sellableCapacity,
        }
      : null,
    crewedTripIds,
    crewedSessions,
    availableStaff,
  };
}

/**
 * **Which of the day's departures the reader crews** (fourth review, item 14):
 * the queue's own window, and every departure that has sailed since the shop's
 * day began. The window looks only forward, so the captain's dawn boat, still
 * out with them aboard, lost its "You're crewing" mark the moment it sailed
 * while the 1:30 PM card kept its own. The mark follows the assignment, not
 * the window.
 */
function readerCrewedTrips(
  db: AppDb,
  shopId: string,
  personId: string,
  input: { windowTripIds: readonly string[]; dayStart: Date; now: Date },
): Promise<{ tripId: string }[]> {
  const sailedToday = and(gte(trips.startsAt, input.dayStart), lte(trips.startsAt, input.now));
  return db
    .select({ tripId: tripAssignments.tripId })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .where(
      and(
        eq(tripAssignments.personId, personId),
        eq(trips.shopId, shopId),
        liveTrip(),
        input.windowTripIds.length > 0
          ? or(inArray(trips.id, [...input.windowTripIds]), sailedToday)
          : sailedToday,
      ),
    );
}

/**
 * **The cards a "certification pending" row can check from Today** (H-20261008-cert-check-extension).
 * The queue names the diver (`diverBlockerAction`); this reads which of their
 * cards the DiveDay browser extension could look up, by the same rule as the
 * action that judges the check (`listAgencyCheckableCards`), and drops the
 * offer from a row whose diver holds none.
 */
export async function withAgencyChecks(
  db: AppDb,
  shopId: string,
  actions: TodayAction[],
): Promise<TodayAction[]> {
  const personIds = actions.flatMap((action) =>
    action.agencyCheck ? [action.agencyCheck.personId] : [],
  );
  if (personIds.length === 0) return actions;
  return attachAgencyChecks(actions, await listAgencyCheckableCards(db, { shopId, personIds }));
}

/**
 * Who on the window's seats a "certification pending" row could name: blocked
 * on a pending card, and not a held seat (`diverBlockerAction` offers no check
 * to one until a staffer confirms who is standing there).
 */
function agencyCheckCandidates(
  readinessByTrip: HorizonReadinessEvidence["readinessByTrip"],
): string[] {
  const personIds: string[] = [];
  for (const rows of readinessByTrip.values()) {
    for (const row of rows) {
      const codes = row.readiness.blockers.map((blocker) => blocker.code);
      if (codes.includes("certification_pending") && !codes.includes("identity_unconfirmed")) {
        personIds.push(row.person.id);
      }
    }
  }
  return personIds;
}

/** Fills each row's offer from the cards read, and drops it where the diver holds none. */
function attachAgencyChecks(
  actions: TodayAction[],
  cards: ReadonlyMap<string, AgencyCheckableCard[]>,
): TodayAction[] {
  return actions.map((action) => {
    if (!action.agencyCheck) return action;
    const { agencyCheck, ...rest } = action;
    const found = cards.get(agencyCheck.personId);
    return found
      ? { ...rest, agencyCheck: { personId: agencyCheck.personId, cards: found } }
      : rest;
  });
}
