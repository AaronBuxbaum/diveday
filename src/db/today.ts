import { and, asc, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { gearServiceKindLabel } from "@/i18n/gear-labels";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import {
  crewBelowTargetDetailText,
  emailDeliveryDetailText,
  emailResendActionText,
  failedPhotoDeletionDetailText,
  gearDueBackDetailText,
  gearNeverPickedUpDetailText,
  gearOverdueDetailText,
  gearServiceDueDetailText,
  highWindAlertDetailText,
  instructorMissingDetailText,
  inviteFromWaitlistActionText,
  lastMinuteFillDetailText,
  mediaDeletionKindText,
  missingContactDetailText,
  missingContactNamedDetailText,
  missingFitDetailText,
  openDataSettingsActionText,
  openGearRegisterActionText,
  openGearUnitActionText,
  openGuestsActionText,
  openOrdersActionText,
  openPrepListActionText,
  openReviewsActionText,
  openRollCallActionText,
  openStaffingActionText,
  openTripActionText,
  openUnitsActionText,
  overRatioDetailText,
  overRatioIntroDetailText,
  owedRefundDetailText,
  reviewsPendingDetailText,
  reviewsPendingSubjectText,
  rollCallGapDetailText,
  staffCredentialDueDetailText,
  stuckOperationKindText,
  stuckPaymentOperationDetailText,
  uncrewedDepartureDetailText,
  ungatedNitroxDetailText,
  unitsUnconfirmedDetailText,
  unitsUnconfirmedSubjectText,
  waitlistSeatDetailText,
} from "@/i18n/today-labels";
import type { Role } from "@/lib/authz";
import {
  calendarDateInTimezone,
  calendarDateToUtcMidnight,
  formatCalendarDate,
  isCalendarDateExpired,
  isValidCalendarDate,
} from "@/lib/calendar-date";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { courseCrewGap } from "@/lib/course-ratios";
import { countInWaterCrew, effectiveCrewRoles, groupCrewAssignments } from "@/lib/crew-roles";
import {
  DEFAULT_DIVERS_PER_DIVEMASTER,
  divemasterRatioGap,
  inWaterDivemasterCount,
} from "@/lib/divemaster-ratio";
import { formatDateTimeTz, formatMoneyCents, formatShortDate, formatTime } from "@/lib/format";
import { lastMinuteEntryMatchesTripDate } from "@/lib/last-minute-list";
import {
  type CrewIncompleteReason,
  rollCallCheckpoints,
  rollCallCompleteness,
} from "@/lib/manifests";
import {
  fetchAutomatedMarineForecast,
  isHighWind,
  shouldShowAutomatedForecast,
} from "@/lib/marine-forecast";
import { operationalWindow, shopDayWindow } from "@/lib/operational-window";
import { publicTripPath } from "@/lib/public-routes";
import { type AboardBlockerKind, groupAboardBlockers } from "@/lib/readiness";
import { rentalFitCompleteness } from "@/lib/rentals";
import {
  collapseDiverActions,
  filterActionsForRoles,
  ROLL_CALL_GAP_KINDS,
  type RollCallGapReason,
  rollCallGapUrgency,
  type TodayAction,
  urgencyFor,
} from "@/lib/today";
import { toDateInputValue, utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import { type HorizonReadinessEvidence, inHorizonReadiness } from "./blockers";
import type { AppDb } from "./client";
import { listGearDueBack, listGearServiceDue, listOverdueGearReservations } from "./gear";
import { listActiveLastMinuteWindows } from "./last-minute-list";
import { listDepartureCrewRollCallByTrip, listDepartureRollCallByTrip } from "./manifests";
import { listPendingMediaDeletions, STALE_PENDING_AFTER_MS } from "./media-deletions";
import { authorizesNitroxFill } from "./nitrox";
import { listNotificationDeliveryIssues } from "./notifications";
import { openOrdersForBookings } from "./orders";
import { listStuckPaymentOperations, STALE_AFTER_MS } from "./payment-operations";
import { listOwedShopCancellationRefunds, OWED_REFUND_STALE_AFTER_MS } from "./refunds";
import { readReviewsAwaitingModeration } from "./reviews";
import {
  bookings,
  nitroxCertifications,
  people,
  personRoles,
  rentalFitProfiles,
  rollCallCrewEvents,
  rollCallEvents,
  shops,
  tripAssignments,
  trips,
  tripWaitlistEntries,
} from "./schema";
import { listStaffCredentials } from "./staff-credentials";
import { canAcceptPayments, getShopStripeAccount } from "./stripe-accounts";
import { tripIdsNeverSentLastMinuteDeal } from "./trip-promos";
import { countShopTrips, listStaff } from "./trips";
import { liveTrip } from "./trips-live";

/**
 * Today's boat: the trip id staff would check in for right now, or null on a
 * day the shop has no departure. The command palette uses it to offer a
 * "Boarding — today's boat" jump straight to the manifest. Deliberately
 * lightweight — a bounded scan of scheduled trips around now, filtered to the
 * shop's calendar day, preferring a boat that hasn't finished over one that
 * already sailed.
 *
 * The scan's bounds are `shopDayWindow` (src/lib/operational-window.ts), beside
 * the other windows this app slices time with, rather than the freestanding
 * ±hours this query used to carry inline. It is a query bound, not a lens: the
 * shop-local date filter below is what actually decides "today".
 */
export async function todayNextDepartureTripId(
  db: AppDb,
  shopId: string,
  timeZone: string,
  now: Date = nowDate(),
): Promise<string | null> {
  const today = shopDay(now, timeZone);
  const scan = shopDayWindow(now);
  const rows = await db
    .select({ id: trips.id, startsAt: trips.startsAt, endsAt: trips.endsAt })
    .from(trips)
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, scan.from),
        lte(trips.startsAt, scan.to),
      ),
    )
    .orderBy(asc(trips.startsAt));
  const todays = rows.filter((row) => shopDay(row.startsAt, timeZone) === today);
  const active = todays.find((row) => row.endsAt >= now) ?? todays[0];
  return active?.id ?? null;
}

/** A departure happening today, with just enough to know whether it can sail. */
export type DepartureSummary = {
  tripId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  booked: number;
  capacity: number;
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
  /**
   * The aboard group split by what each diver is blocked *on*, worst kind
   * first — **one entry per kind present, never one reason over the whole
   * count.** See `groupAboardBlockers` for why a single kind for the group
   * states a falsehood about most of it, and `aboardBlockerKind` for why this
   * is not `BLOCKER_CATEGORY`.
   *
   * Empty when nobody blocked is aboard. `blockedAboard` above stays the total
   * across these: the counts line is a census, and this is not.
   */
  blockedAboardGroups: { kind: AboardBlockerKind; names: string[] }[];
  courseTitle: string | null;
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
};

export type CrewedSessionSummary = {
  tripId: string;
  title: string;
  courseTitle: string | null;
  startsAt: Date;
  booked: number;
  ready: number;
  blocked: number;
};

export type TodayWork = {
  departures: DepartureSummary[];
  actions: TodayAction[];
  /** How many actions were filtered out for the reader's role lens (issue #715). */
  withheldCount: number;
  /** Shown only when nothing sails today, so the page still orients the crew. */
  nextDeparture: { tripId: string; title: string; startsAt: Date } | null;
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

function shopDay(date: Date, timeZone: string): string {
  return toDateInputValue(utcToWallTime(date, timeZone));
}

function at(date: Date, timeZone: string, locale: string): string {
  return formatTime(date, locale, timeZone);
}

/**
 * How long an unclosed head count is still *dock work* (DOM-H3). Two days: long
 * enough that a boat which tied up late last night is still chased through the
 * next morning's shift — the case that matters — and short enough that the
 * queue stays a list of work someone can still do.
 */
export const RETURNED_ROLL_CALL_LOOKBACK_MS = 48 * HOUR_MS;

/**
 * How long an after-dive count that was *never closed* keeps saying so, at a
 * lower urgency, after it stops being dock work.
 *
 * Past `RETURNED_ROLL_CALL_LOOKBACK_MS` this used to age to **nothing**: at
 * hour 49 the row left Today and the schedule board with nothing anywhere
 * recording that a count was never closed. The old docstring called that fine
 * because "the trip's own manifest is where it gets reconstructed" — which only
 * works if somebody knows to look, and the only thing that would have told them
 * had just vanished. A missing-diver signal that self-clears is not a signal,
 * so it degrades instead: `stale` rows keep the same evidence, drop a urgency
 * band, and say plainly that the count was never closed.
 *
 * Only the two *after-dive* reasons age this way. An unfinished dock count and
 * a trip with no roll call at all are paperwork; carrying those for a month
 * would bury the rows that mean a person may be in the water, which is the
 * failure mode this whole change exists to remove.
 */
export const ROLL_CALL_RESIDUE_MS = 30 * 24 * HOUR_MS;

/**
 * How long after its scheduled departure a boat is still treated as at the
 * dock. Trips run late, so every "has it sailed" question in this app carries
 * the same hour (`src/db/ready.ts`).
 */
const DEPARTURE_BUFFER_MS = 60 * 60 * 1000;

/**
 * One trip's unclosed head count, as codes and numbers — `src/i18n/today-labels.ts`
 * picks the words. Named `OpenRollCall` still because the schedule board reads
 * the same shape.
 */
export type OpenRollCall = {
  tripId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  priceCents: number | null;
  reason: RollCallGapReason;
  /**
   * 1-based dive number of the after-dive checkpoint this is about, or `0` when
   * the gap is at departure (`departure_uncounted`) or trip-wide (`no_roll_call`).
   */
  diveNumber: number;
  /**
   * People not accounted for at that checkpoint — awaiting *or* not back
   * aboard. Divers for a diver reason, crew for a crew one (`reason` says
   * which); the two are never summed into one row, because "2 unaccounted for"
   * that could mean either is exactly the wording that stops being read.
   */
  uncounted: number;
  /** How many people that checkpoint was counting (see `inAfterDivePopulation`). */
  total: number;
  /**
   * The trip's non-cancelled booking count, whatever this gap is about. The
   * schedule board renders a returned-with-an-open-count boat as an ordinary
   * departure card, and that card's "booked" figure is a fact about the trip —
   * not about whichever half of the head count happens to be open.
   */
  rosterSize: number;
  /** The boat is still out: `startsAt <= now < endsAt`. */
  underway: boolean;
  /** Older than the dock-work window — kept as residue rather than vanishing. */
  stale: boolean;
};

/**
 * `not_boarded` means two opposite things depending on where it is recorded,
 * and conflating them is what silenced this alarm with the exact input that
 * should have raised it (DOM-H3):
 *
 * - at `departure` it means **never left the dock**. Benign, genuinely
 *   accounted for, and correctly true of every later checkpoint too.
 * - at `after_dive_n` it means **did not return to the boat**. That *is* the
 *   missing-diver event. The DM who taps the only control that isn't "Boarded"
 *   is saying "not back yet, check again", and the checkpoint must open, not
 *   close.
 *
 * So this module does not ask `carryForwardNotBoarded` (src/lib/manifests.ts)
 * what a diver's effective state is — that helper carries *any* `not_boarded`
 * forward as an accounted-for record, which closes every later checkpoint too.
 * The rule here is the boring one instead: **at an after-dive checkpoint a
 * diver is accounted for only if their latest live result there is `boarded`.**
 * Departure carry-forward then needs no special case at all, because a diver
 * left ashore never enters the after-dive population below.
 */
function isAccountedForAfterDive(state: "boarded" | "not_boarded" | undefined): boolean {
  return state === "boarded";
}

/**
 * Who an after-dive count is counting. **Not** everyone who bought a seat.
 *
 * Crews tap "Boarded" for the people standing in front of them and never touch
 * the two who didn't show; there is no bulk action and nothing in the app ever
 * writes `no_show`. Counting walk-aways as uncounted after every dive raised a
 * danger-toned row on most real trips, and a red row that fires on most trips
 * is read by nobody within a fortnight — at which point the row that means a
 * diver is in the water stops working too.
 *
 * The population at risk in the water is therefore the people who actually
 * boarded: `boarded` at departure, plus anyone explicitly recorded at an
 * after-dive checkpoint later (a diver who joined at the second site, or one
 * the crew counted without a dock result). A diver with no departure result at
 * all is a *departure*-count problem and gets its own, quieter row.
 */
function inAfterDivePopulation(states: readonly ("boarded" | "not_boarded" | undefined)[]) {
  return states[0] === "boarded" || states.slice(1).some((state) => state !== undefined);
}

/**
 * Every trip whose head count is not closed — the number that says whether
 * anybody is still in the water (DOM-H3).
 *
 * **This is the one reader here that looks backwards, on purpose.** Every other
 * signal on this page hangs off `pagedUpcomingTripsWithCounts`, which only ever
 * returns trips whose `startsAt` is still ahead of `now`; a boat that sailed at
 * 07:00 has already fallen out of it by 07:01, and one that tied up late last
 * night was never in it at all. So this runs its own query over `endsAt`.
 *
 * Bounds: the time window *is* the bound. There is deliberately no row cap.
 * The old one (`limit(20)` over `asc(endsAt)`) applied before any openness test
 * ran, so a four-boat operation with two dozen trips in the window kept the
 * twenty oldest — mostly already closed — and silently dropped the 16:30 boat
 * that had just tied up with an open count. A cap that can hide exactly the
 * newest open count is worse than the scan it saves, and AGENTS.md forbids a
 * silent one. `desc(endsAt)` on top of that, so the freshest boat is examined
 * first whatever else changes.
 *
 * **Crew are counted here too** (ADR 20260803-per-person-crew-roll-call). The
 * per-person crew half used to reach this function not at all: a crew member
 * tapped "not back aboard" against a divemaster, the manifest went red with
 * `crew_not_back_aboard` — "the loudest thing on this list" — and Today showed
 * nothing, the board badged nothing, and none of the 48-hour dock-work chase or
 * the 30-day residue a *diver* gets applied to the people most reliably in the
 * water (review 20260803, D1). Crew rows are built by the same rules, in the
 * same pass, and age on the same schedule; only the words differ.
 *
 * "Not closed" is defined the same way the manifest defines it, except for the
 * `not_boarded` split above:
 *
 * - the roster is the manifest's roster — every booking that is not cancelled;
 * - a diver's result at a checkpoint is their *latest* event there, and a
 *   latest `cleared` is an undo that returns them to awaiting
 *   (`listLatestRollCallByBooking`, src/db/manifests.ts);
 * - a trip still underway raises only a checkpoint that was **started and
 *   abandoned** (at least one result and at least one diver still awaiting).
 *   A four-hour two-tank runs dive one's count about ninety minutes in; if the
 *   DM counts nine of twelve and gets pulled away, the boat is still on the
 *   mooring and the three are still findable. Waiting for `endsAt` costs three
 *   hours. Zero events while underway stays quiet — that checkpoint has not
 *   happened yet.
 */
export async function listRollCallGaps(
  db: AppDb,
  shopId: string,
  now: Date = nowDate(),
): Promise<OpenRollCall[]> {
  const sailed = await db
    .select({
      id: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      capacity: trips.capacity,
      priceCents: trips.priceCents,
      plannedDives: trips.plannedDives,
    })
    .from(trips)
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        // A cancelled trip never sailed, so it has nobody to count back.
        eq(trips.status, "scheduled"),
        // Underway or home; a boat that has not left the dock has no count due.
        lte(trips.startsAt, now),
        gte(trips.endsAt, new Date(now.getTime() - ROLL_CALL_RESIDUE_MS)),
      ),
    )
    .orderBy(desc(trips.endsAt));
  if (sailed.length === 0) return [];
  const tripIds = sailed.map((trip) => trip.id);

  const [roster, events, crewEvents] = await Promise.all([
    db
      .select({ tripId: bookings.tripId, bookingId: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.shopId, shopId),
          inArray(bookings.tripId, tripIds),
          ne(bookings.status, "cancelled"),
        ),
      ),
    db
      .select({
        bookingId: rollCallEvents.bookingId,
        checkpoint: rollCallEvents.checkpoint,
        status: rollCallEvents.status,
        occurredAt: rollCallEvents.occurredAt,
      })
      .from(rollCallEvents)
      // Same guard `boardedCountsByTrip` applies: a booking cancelled after the
      // boat left keeps its event rows, and they must not answer for a roster
      // it is no longer on.
      .innerJoin(
        bookings,
        and(eq(bookings.id, rollCallEvents.bookingId), ne(bookings.status, "cancelled")),
      )
      .where(and(eq(rollCallEvents.shopId, shopId), inArray(rollCallEvents.tripId, tripIds)))
      // `seq` is the final key for the same reason `src/db/manifests.ts` gives:
      // `created_at` is transaction time, so a batched write inside one
      // transaction leaves the order arbitrary — and Today's missing-diver row
      // and the manifest must never disagree about who is still in the water.
      .orderBy(
        asc(rollCallEvents.occurredAt),
        asc(rollCallEvents.createdAt),
        asc(rollCallEvents.seq),
      ),
    db
      .select({
        tripId: rollCallCrewEvents.tripId,
        personId: rollCallCrewEvents.personId,
        checkpoint: rollCallCrewEvents.checkpoint,
        status: rollCallCrewEvents.status,
        occurredAt: rollCallCrewEvents.occurredAt,
      })
      .from(rollCallCrewEvents)
      // The crew counterpart of the cancelled-booking guard above: a person
      // taken off the roster keeps their event rows, and they must not answer
      // for a crew list they are no longer on. (`changeTripCrew` refuses to
      // remove somebody who has roll-call history, so this is belt-and-braces
      // — but a head count is where belt-and-braces belongs.)
      .innerJoin(
        tripAssignments,
        and(
          eq(tripAssignments.tripId, rollCallCrewEvents.tripId),
          eq(tripAssignments.personId, rollCallCrewEvents.personId),
        ),
      )
      .where(
        and(eq(rollCallCrewEvents.shopId, shopId), inArray(rollCallCrewEvents.tripId, tripIds)),
      )
      .orderBy(
        asc(rollCallCrewEvents.occurredAt),
        asc(rollCallCrewEvents.createdAt),
        asc(rollCallCrewEvents.seq),
      ),
  ]);

  const rosterByTrip = new Map<string, string[]>();
  for (const row of roster) {
    const list = rosterByTrip.get(row.tripId) ?? [];
    list.push(row.bookingId);
    rosterByTrip.set(row.tripId, list);
  }

  // Ordered oldest-first, so the last write per booking *and checkpoint* wins.
  const latestByBookingCheckpoint = new Map<string, (typeof events)[number]>();
  for (const event of events) {
    latestByBookingCheckpoint.set(`${event.bookingId}\0${event.checkpoint}`, event);
  }

  // The crew half, keyed the same way and superseded by the same rule. The
  // crew "roster" for a trip is whoever has a result on it: a shop that has
  // never tapped a crew roll call has no crew subjects here, so it raises no
  // crew rows at all rather than a red row on every trip it ever ran.
  const crewByTripId = new Map<string, Set<string>>();
  const latestByCrewCheckpoint = new Map<string, (typeof crewEvents)[number]>();
  for (const event of crewEvents) {
    latestByCrewCheckpoint.set(`${event.tripId}\0${event.personId}\0${event.checkpoint}`, event);
    const people = crewByTripId.get(event.tripId) ?? new Set<string>();
    people.add(event.personId);
    crewByTripId.set(event.tripId, people);
  }

  const gaps: OpenRollCall[] = [];
  for (const trip of sailed) {
    const bookingIds = rosterByTrip.get(trip.id) ?? [];
    const crewIds = [...(crewByTripId.get(trip.id) ?? [])];
    // An empty boat has nobody to count, exactly as the manifest's own
    // "complete" rule requires a `totalDivers > 0` before it says so — but a
    // crew member somebody recorded as not back aboard is a person to count
    // whether or not anybody bought a seat, so a crewed trip with no divers
    // still reaches the crew scan below.
    if (bookingIds.length === 0 && crewIds.length === 0) continue;
    const checkpoints = rollCallCheckpoints(trip.plannedDives);
    const home = new Date(trip.endsAt.getTime() + 60 * 60 * 1000) <= now;
    const underway = !home;
    const stale = home && trip.endsAt.getTime() < now.getTime() - RETURNED_ROLL_CALL_LOOKBACK_MS;

    // Per after-dive checkpoint index (index 0 is `departure` and stays 0):
    const population = checkpoints.map(() => 0);
    const recorded = checkpoints.map(() => 0);
    const unaccounted = checkpoints.map(() => 0);
    const notBackAboard = checkpoints.map(() => 0);
    // The crew half, scanned into its own arrays by the identical rules — one
    // pass, one set of predicates, so the two can never drift into disagreeing
    // about what "accounted for after a dive" means.
    const crewPopulation = checkpoints.map(() => 0);
    const crewRecorded = checkpoints.map(() => 0);
    const crewUnaccounted = checkpoints.map(() => 0);
    const crewNotBackAboard = checkpoints.map(() => 0);
    let departureAwaiting = 0;
    let anyEvent = false;

    for (const bookingId of bookingIds) {
      const states = checkpoints.map((checkpoint) => {
        const event = latestByBookingCheckpoint.get(`${bookingId}\0${checkpoint}`);
        // A latest `cleared` is staff undoing a mistake: the diver reads as
        // awaiting again, so it must re-alarm rather than stay resolved.
        if (!event || event.status === "cleared") return undefined;
        // Only the state decides a head count. The recorder's name and note are
        // the manifest's display fields, so they are deliberately not queried.
        return event.status;
      });
      if (states.some((state) => state !== undefined)) anyEvent = true;
      if (states[0] === undefined) departureAwaiting += 1;
      if (!inAfterDivePopulation(states)) continue;
      for (let dive = 1; dive < checkpoints.length; dive++) {
        const state = states[dive];
        population[dive] = (population[dive] ?? 0) + 1;
        if (state !== undefined) recorded[dive] = (recorded[dive] ?? 0) + 1;
        if (isAccountedForAfterDive(state)) continue;
        unaccounted[dive] = (unaccounted[dive] ?? 0) + 1;
        if (state === "not_boarded") notBackAboard[dive] = (notBackAboard[dive] ?? 0) + 1;
      }
    }

    for (const personId of crewIds) {
      const states = checkpoints.map((checkpoint) => {
        const event = latestByCrewCheckpoint.get(`${trip.id}\0${personId}\0${checkpoint}`);
        if (!event || event.status === "cleared") return undefined;
        return event.status;
      });
      // A crew result is a roll call. A trip whose only head count is of its
      // crew has started one, so it is not a `no_roll_call` trip.
      if (states.some((state) => state !== undefined)) anyEvent = true;
      if (!inAfterDivePopulation(states)) continue;
      for (let dive = 1; dive < checkpoints.length; dive++) {
        const state = states[dive];
        crewPopulation[dive] = (crewPopulation[dive] ?? 0) + 1;
        if (state !== undefined) crewRecorded[dive] = (crewRecorded[dive] ?? 0) + 1;
        if (isAccountedForAfterDive(state)) continue;
        crewUnaccounted[dive] = (crewUnaccounted[dive] ?? 0) + 1;
        if (state === "not_boarded") crewNotBackAboard[dive] = (crewNotBackAboard[dive] ?? 0) + 1;
      }
    }

    const base = {
      tripId: trip.id,
      title: trip.title,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      capacity: trip.capacity,
      priceCents: trip.priceCents,
      rosterSize: bookingIds.length,
      underway,
      stale,
    };

    // A human said a diver did not come back. That outranks every other gap on
    // this boat wherever it sits, so it is searched across all dives first — a
    // per-dive "first problem wins" scan would hide a dive-two missing diver
    // behind a dive-one clerical gap.
    const missingDive = checkpoints.findIndex(
      (_, dive) => dive >= 1 && (notBackAboard[dive] ?? 0) > 0,
    );
    // Index 0 is `departure`; the after-dive checkpoints start at 1 and their
    // index *is* their dive number.
    const openDive = checkpoints.findIndex(
      (_, dive) =>
        dive >= 1 &&
        (unaccounted[dive] ?? 0) > 0 &&
        // Underway: only a checkpoint someone started and abandoned.
        (home || (recorded[dive] ?? 0) > 0),
    );
    if (missingDive >= 1) {
      gaps.push({
        ...base,
        reason: "missing_diver",
        diveNumber: missingDive,
        uncounted: notBackAboard[missingDive] ?? 0,
        total: population[missingDive] ?? 0,
      });
    } else if (openDive >= 1) {
      gaps.push({
        ...base,
        reason: "after_dive_uncounted",
        diveNumber: openDive,
        uncounted: unaccounted[openDive] ?? 0,
        total: population[openDive] ?? 0,
      });
    }

    // The crew rows, scanned identically and pushed **beside** the diver row
    // rather than instead of it. A boat can be missing a diver and a divemaster
    // at once, and collapsing that into one row loses the name of one of them.
    const crewMissingDive = checkpoints.findIndex(
      (_, dive) => dive >= 1 && (crewNotBackAboard[dive] ?? 0) > 0,
    );
    const crewOpenDive = checkpoints.findIndex(
      (_, dive) =>
        dive >= 1 && (crewUnaccounted[dive] ?? 0) > 0 && (home || (crewRecorded[dive] ?? 0) > 0),
    );
    if (crewMissingDive >= 1) {
      gaps.push({
        ...base,
        reason: "missing_crew",
        diveNumber: crewMissingDive,
        uncounted: crewNotBackAboard[crewMissingDive] ?? 0,
        total: crewPopulation[crewMissingDive] ?? 0,
      });
    } else if (crewOpenDive >= 1) {
      gaps.push({
        ...base,
        reason: "crew_uncounted",
        diveNumber: crewOpenDive,
        uncounted: crewUnaccounted[crewOpenDive] ?? 0,
        total: crewPopulation[crewOpenDive] ?? 0,
      });
    }

    // The dock count. Never while the boat is out (nobody can settle it from
    // ashore) and never once the trip is only residue — it is paperwork, and
    // carrying a month of it would bury the rows above. Divers only: a
    // dock-side crew gap on a shop that has not adopted crew roll call is every
    // trip it has ever run.
    if (home && !stale && bookingIds.length > 0) {
      if (!anyEvent) {
        gaps.push({
          ...base,
          reason: "no_roll_call",
          diveNumber: 0,
          uncounted: bookingIds.length,
          total: bookingIds.length,
        });
      } else if (departureAwaiting > 0) {
        gaps.push({
          ...base,
          reason: "departure_uncounted",
          diveNumber: 0,
          uncounted: departureAwaiting,
          total: bookingIds.length,
        });
      }
    }
  }
  return gaps;
}

/**
 * The after-dive subset, for the schedule board's per-trip badge — it links
 * straight at `after_dive_${diveNumber}`, so a departure-count or
 * no-roll-call gap has no checkpoint for it to point at. Residue rows are
 * Today's job too: the board is the forward schedule, not the audit trail.
 */
export async function openAfterDiveRollCalls(
  db: AppDb,
  shopId: string,
  now: Date = nowDate(),
): Promise<OpenRollCall[]> {
  const gaps = await listRollCallGaps(db, shopId, now);
  return gaps.filter((gap) => gap.diveNumber >= 1 && !gap.stale);
}

/**
 * Divers on an upcoming departure whose rental fit can't be packed from yet.
 * The prep list is derived entirely from fit, so a gap in one is a hole in
 * tomorrow's packing that nobody sees until the diver is standing at the
 * counter.
 *
 * "Gap" means what `rentalFitCompleteness` means (src/lib/rentals.ts): any
 * piece the diver takes from the shop with no size recorded against it. This
 * used to ask only whether a fit *row* existed, which let the commoner failure
 * through — a diver who ticked BCD, wetsuit and weights and gave one shoe size
 * had a row, so Today said nothing and the packer found out at the rack.
 *
 * Scoped to the shop's own catalog, so a fit written before the shop stopped
 * renting an item never nags about a size nobody can be handed. The catalog is
 * one bounded read on a row this function already has the id for; it is not
 * worth threading through every `getTodayWork` caller to save.
 */
async function missingFitByTrip(
  db: AppDb,
  shopId: string,
  bookingIdsByTrip: Map<string, string[]>,
) {
  const bookingIds = [...bookingIdsByTrip.values()].flat();
  const missing = new Map<string, number>();
  if (bookingIds.length === 0) return missing;
  const [rows, [shop]] = await Promise.all([
    db
      .select({ bookingId: bookings.id, fit: rentalFitProfiles })
      .from(bookings)
      .leftJoin(
        rentalFitProfiles,
        and(
          eq(rentalFitProfiles.personId, bookings.personId),
          eq(rentalFitProfiles.shopId, bookings.shopId),
        ),
      )
      .where(and(eq(bookings.shopId, shopId), inArray(bookings.id, bookingIds))),
    db.select({ rentalItems: shops.rentalItems }).from(shops).where(eq(shops.id, shopId)).limit(1),
  ]);
  const withoutFit = new Set(
    rows
      .filter((row) => rentalFitCompleteness(row.fit, shop?.rentalItems).state !== "complete")
      .map((row) => row.bookingId),
  );
  for (const [tripId, ids] of bookingIdsByTrip) {
    const count = ids.filter((id) => withoutFit.has(id)).length;
    if (count > 0) missing.set(tripId, count);
  }
  return missing;
}

/**
 * Divers who asked for Nitrox but hold no verified nitrox card right
 * now. A diver may request nitrox before their card is verified (it's flagged,
 * not blocked), and a card can be pulled after a request was accepted — either
 * way the tank has to go back to air unless someone verifies a card before the
 * boat leaves. Reads the card live and fails closed: an archived card counts
 * as no card.
 */
async function ungatedNitroxByTrip(
  db: AppDb,
  shopId: string,
  bookingIdsByTrip: Map<string, string[]>,
) {
  const bookingIds = [...bookingIdsByTrip.values()].flat();
  const ungated = new Map<string, number>();
  if (bookingIds.length === 0) return ungated;
  const rows = await db
    .select({ bookingId: bookings.id, cardId: nitroxCertifications.id })
    .from(bookings)
    .leftJoin(
      nitroxCertifications,
      and(
        eq(nitroxCertifications.personId, bookings.personId),
        eq(nitroxCertifications.shopId, bookings.shopId),
        // Shared fill-gate predicate: an imported-but-unconfirmed card does not
        // authorize a fill (ADR 20260724-import-verified-cards).
        authorizesNitroxFill,
      ),
    )
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.wantsNitrox, true),
        inArray(bookings.id, bookingIds),
      ),
    );
  const blocked = new Set(rows.filter((row) => !row.cardId).map((row) => row.bookingId));
  for (const [tripId, ids] of bookingIdsByTrip) {
    const count = ids.filter((id) => blocked.has(id)).length;
    if (count > 0) ungated.set(tripId, count);
  }
  return ungated;
}

/**
 * Booked divers with no emergency contact name on file, per trip. This is never
 * a boarding blocker — it is a low-priority, dock-settleable nudge — so it is
 * derived here rather than through the readiness engine, and the caller only
 * surfaces it for boats close enough to matter.
 */
async function missingEmergencyContactByTrip(
  db: AppDb,
  shopId: string,
  bookingIdsByTrip: Map<string, string[]>,
) {
  const bookingIds = [...bookingIdsByTrip.values()].flat();
  // Divers, not a bare count: a queue row about one person leads with their
  // name (design/principles.md #10 — the answer, not a door), so the reader
  // carries who is missing a contact, and the caller counts from it.
  const missing = new Map<string, { fullName: string }[]>();
  if (bookingIds.length === 0) return missing;
  const rows = await db
    .select({
      bookingId: bookings.id,
      fullName: people.fullName,
      contactName: people.emergencyContactName,
      contactPhone: people.emergencyContactPhone,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(and(eq(bookings.shopId, shopId), inArray(bookings.id, bookingIds)));
  // A contact is only usable if the crew can dial it: both a name and a phone.
  // A name with no number reads as "on file" but is unreachable in an incident.
  const without = new Map(
    rows
      .filter((row) => !row.contactName || !row.contactPhone)
      .map((row) => [row.bookingId, row.fullName]),
  );
  for (const [tripId, ids] of bookingIdsByTrip) {
    const divers = ids
      .filter((id) => without.has(id))
      .map((id) => ({ fullName: without.get(id) ?? "" }));
    if (divers.length > 0) missing.set(tripId, divers);
  }
  return missing;
}

/**
 * Wait-list depth *and* one suggested entry per trip, so a freed seat can be
 * offered to a real person without leaving Today. The suggestion is the
 * longest-waiting diver — a sensible default, not an entitlement: nothing tells
 * the diver they are in a line, and staff may invite anyone on the list
 * (ADR 20260813-wait-list-is-a-lead-list). Its name, email, and last-invited
 * stamp ride along so the Today row can one-tap invite and fall back to a
 * prewritten composer exactly like the trip page's wait-list section.
 */
export type WaitlistFront = {
  count: number;
  entryId: string;
  personName: string;
  personEmail: string | null;
  invitedAt: Date | null;
};

async function waitlistFrontByTrip(db: AppDb, shopId: string, tripIds: string[]) {
  const fronts = new Map<string, WaitlistFront>();
  if (tripIds.length === 0) return fronts;
  const rows = await db
    .select({
      tripId: tripWaitlistEntries.tripId,
      entryId: tripWaitlistEntries.id,
      invitedAt: tripWaitlistEntries.invitedAt,
      personName: people.fullName,
      personEmail: people.email,
    })
    .from(tripWaitlistEntries)
    .innerJoin(people, eq(people.id, tripWaitlistEntries.personId))
    .where(
      and(eq(tripWaitlistEntries.shopId, shopId), inArray(tripWaitlistEntries.tripId, tripIds)),
    )
    .orderBy(asc(tripWaitlistEntries.createdAt));
  for (const row of rows) {
    const existing = fronts.get(row.tripId);
    // Rows arrive oldest-first, so the first seen per trip is the true front of
    // the line; later ones only bump the depth count.
    if (existing) {
      existing.count += 1;
      continue;
    }
    fronts.set(row.tripId, {
      count: 1,
      entryId: row.entryId,
      personName: row.personName,
      personEmail: row.personEmail,
      invitedAt: row.invitedAt,
    });
  }
  return fronts;
}

/**
 * How many instructors and certified assistants (divemasters) each course
 * trip's crew has, counted by the one definition every ratio gate shares
 * (`countInWaterCrew`, src/lib/crew-roles.ts).
 *
 * Exported because the shift roster's crew-gap summary composes *this* reader
 * — the one Today's own `instructor_missing` detection runs on — rather than
 * re-deriving crew counts of its own (ADR 20260806-staffing-is-the-shift-roster).
 */
export async function courseCrewCountsByTrip(
  db: AppDb,
  shopId: string,
  tripIds: string[],
): Promise<Map<string, { instructorCount: number; assistantCount: number }>> {
  const counts = new Map<string, { instructorCount: number; assistantCount: number }>();
  if (tripIds.length === 0) return counts;
  const rows = await db
    .select({
      tripId: tripAssignments.tripId,
      personId: tripAssignments.personId,
      tripRole: tripAssignments.tripRole,
      role: personRoles.role,
    })
    .from(tripAssignments)
    // `trip_assignments` carries no shop_id of its own; proving the trip
    // itself belongs to shopId (not just the assigned person) is what closes
    // the cross-tenant read this table's shape allows (CR-007 review
    // finding — mirrors getTripCrewIds's already-fixed join, src/db/trips.ts).
    // Every current caller already pre-filters tripIds to this shop, but the
    // helper itself shouldn't depend on that discipline.
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .innerJoin(people, eq(people.id, tripAssignments.personId))
    // A `left join`, and no role filter: the per-trip role lives on the
    // assignment row, so a rostered captain has to reach the rule that decides
    // they count for nothing rather than being filtered out of the query.
    .leftJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(people.shopId, shopId),
        inArray(tripAssignments.tripId, tripIds),
      ),
    );
  const rowsByTrip = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = rowsByTrip.get(row.tripId) ?? [];
    list.push(row);
    rowsByTrip.set(row.tripId, list);
  }
  for (const tripId of tripIds) {
    counts.set(tripId, countInWaterCrew(groupCrewAssignments(rowsByTrip.get(tripId) ?? [])));
  }
  return counts;
}

/**
 * Everything the Today queue needs, in one pass. Every signal is derived from a
 * source-of-truth model, so this never becomes a second place where operational
 * state is decided.
 */
export async function getTodayWork(
  db: AppDb,
  shopId: string,
  shopSlug: string,
  timeZone: string,
  now: Date = nowDate(),
  /** When set, the result carries which in-window trips this person crews. */
  personId?: string,
  /**
   * Resolves the blocked-diver rows' `detail`/`actionLabel` text
   * (`collapseDiverActions`, `src/lib/today.ts`). Defaults to English so every
   * pre-existing caller (tests included) keeps working unchanged; the page
   * passes its own request-locale translator.
   */
  t: StaffTranslator = staffTranslator("en-US"),
  /** Formats every departure time (`at()`); defaults alongside `t` for the same reason. */
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
   * (`src/db/closeout.ts`) accepts that default rather than threading the
   * shop row the rest of the way down its call chain for a queue it only
   * reads as leftovers.
   */
  diversPerDivemaster = DEFAULT_DIVERS_PER_DIVEMASTER,
  /**
   * The viewer's roles, for filtering the action queue to the relevant audience
   * (issue #715). Multi-role viewers see the union; owners and managers see all.
   * Omitted, all actions are returned (withheldCount = 0).
   */
  roles?: readonly Role[],
): Promise<TodayWork> {
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
  } = evidence ?? (await inHorizonReadiness(db, shopId, now));
  const today = shopDay(now, timeZone);
  const todayTrips = inWindow.filter((trip) => shopDay(trip.startsAt, timeZone) === today);
  const bookingIdsByTrip = new Map(
    inWindow.map((trip) => [
      trip.id,
      (readinessByTrip.get(trip.id) ?? []).map((row) => row.booking.id),
    ]),
  );

  const [
    departureRollCall,
    departureCrewRollCall,
    missingFit,
    ungatedNitrox,
    missingContact,
    waitlisted,
    courseCrewCounts,
    deliveryIssues,
    neverSentLastMinuteDeal,
    lastMinuteWindows,
    rollCallGaps,
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
    missingFitByTrip(db, shopId, bookingIdsByTrip),
    ungatedNitroxByTrip(db, shopId, bookingIdsByTrip),
    missingEmergencyContactByTrip(db, shopId, bookingIdsByTrip),
    waitlistFrontByTrip(
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
    tripIdsNeverSentLastMinuteDeal(
      db,
      shopId,
      inWindow.map((trip) => trip.id),
    ),
    // Who is even reachable by a blast. Not scoped to a trip: an entry is a
    // standing "I'm around these dates" preference, and which departures it
    // covers is arithmetic (`lastMinuteEntryMatchesTripDate`), done per trip
    // below against the same predicate the trip's own Guests tab uses.
    listActiveLastMinuteWindows(db, shopId),
    // Deliberately not derived from `inWindow`/`todayTrips`: those look only
    // forward, and a boat that is out or already came back is exactly what this
    // chases.
    listRollCallGaps(db, shopId, now),
  ]);

  const rawStaff = await listStaff(db, shopId);
  const availableStaff = rawStaff.map((s) => ({
    id: s.person.id,
    fullName: s.person.fullName,
    roles: s.roles,
  }));
  const credentialRows = await listStaffCredentials(db, shopId);

  const tripIds = todayTrips.map((t) => t.id);
  const assignments =
    tripIds.length > 0
      ? await db
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
      : [];

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

  const actions: TodayAction[] = [];

  // Somebody on a boat's list is not accounted for (DOM-H3). The after-dive
  // rows are the only ones on this queue that can mean a diver is still in the
  // water, so they lead: top `KIND_SEVERITY`, pinned to the top urgency band,
  // and dated at the moment the trip tied up — always in the past for a boat
  // that is home, so they also sort ahead of every still-upcoming row inside
  // that band. Urgency is set rather than derived because there is no "before
  // it sails" left to derive from; the departure it would hang off has already
  // happened.
  //
  // The dock-count rows (`departure_uncounted`, `no_roll_call`) ride the same
  // path with their own kind, tone, urgency and words — never the after-dive
  // wording. One string for both would say "a person may be in the water" on
  // every trip where two walk-aways were never tapped, and a warning that fires
  // on most trips is a warning nobody reads.
  for (const gap of rollCallGaps) {
    const checkpoint = gap.diveNumber >= 1 ? `after_dive_${gap.diveNumber}` : "departure";
    actions.push({
      id: `roll-call:${gap.tripId}:${gap.reason}:${checkpoint}`,
      kind: ROLL_CALL_GAP_KINDS[gap.reason],
      urgency: rollCallGapUrgency(gap.reason, gap.stale),
      subject: gap.title,
      // The safety-event timestamp format, with its timezone spelled out: a
      // bare time would read as "this morning" for a boat that returned last
      // night, which is the case this row exists for.
      context: formatDateTimeTz(gap.endsAt, locale, timeZone),
      // Its own header even when the same boat has morning work queued: the
      // return moment is a different moment than the departure.
      departure: {
        tripId: gap.tripId,
        label: `${gap.title} · ${formatDateTimeTz(gap.endsAt, locale, timeZone)}`,
      },
      aboutDeparture: true,
      detail: rollCallGapDetailText(t, gap),
      actionLabel: openRollCallActionText(t),
      // Straight to the checkpoint that is open, not the manifest's default
      // departure tab — one tap from the queue to the count that closes it.
      href: `/shop/${shopSlug}/trips/${gap.tripId}/manifest?checkpoint=${checkpoint}`,
      dueAt: gap.endsAt,
    });
  }

  for (const trip of inWindow) {
    const tripHref = `/shop/${shopSlug}/trips/${trip.id}`;
    const when = at(trip.startsAt, timeZone, locale);
    // Every row this trip contributes shares one departure header in the
    // queue; the rows themselves then never repeat the boat's name.
    const departure = { tripId: trip.id, label: `${trip.title} · ${when}` };

    const blockedDivers = (readinessByTrip.get(trip.id) ?? [])
      .filter((row) => row.readiness.status === "blocked")
      .map((row) => ({
        bookingId: row.booking.id,
        personId: row.person.id,
        fullName: row.person.fullName,
        tripId: trip.id,
        tripTitle: `${trip.title} · ${when}`,
        startsAt: trip.startsAt,
        blockers: row.readiness.blockers,
      }));
    actions.push(...collapseDiverActions(blockedDivers, shopSlug, now, t));

    const withoutFit = missingFit.get(trip.id) ?? 0;
    if (withoutFit > 0) {
      actions.push({
        id: `prep:${trip.id}`,
        kind: "dive_prep",
        urgency: urgencyFor(trip.startsAt, now),
        subject: trip.title,
        context: when,
        departure,
        aboutDeparture: true,
        detail: missingFitDetailText(t, withoutFit),
        actionLabel: openPrepListActionText(t),
        href: `${tripHref}/prep`,
        dueAt: trip.startsAt,
      });
    }

    const ungatedCount = ungatedNitrox.get(trip.id) ?? 0;
    if (ungatedCount > 0) {
      actions.push({
        id: `nitrox:${trip.id}`,
        kind: "nitrox_gate",
        urgency: urgencyFor(trip.startsAt, now),
        subject: trip.title,
        context: when,
        departure,
        aboutDeparture: true,
        detail: ungatedNitroxDetailText(t, ungatedCount),
        actionLabel: openPrepListActionText(t),
        href: `${tripHref}/prep`,
        dueAt: trip.startsAt,
      });
    }

    // The one "course crew gap" computation (Lens 17 task 151) — also
    // consumed by the trip page and the staffing coverage list, and all three
    // report its two codes separately, so a session Today flags as over its
    // ratio can neither read as "Covered" on staffing nor be filed there under
    // "needs an instructor" when it already has one.
    const counts = courseCrewCounts.get(trip.id) ?? { instructorCount: 0, assistantCount: 0 };
    const crewGap = courseCrewGap({
      course: trip.course,
      instructorCount: counts.instructorCount,
      assistantCount: counts.assistantCount,
      booked: trip.booked,
    });
    if (crewGap.code !== "none") {
      actions.push({
        id: `instructor:${trip.id}`,
        kind: "instructor_missing",
        urgency: urgencyFor(trip.startsAt, now),
        subject: trip.title,
        context: when,
        departure,
        aboutDeparture: true,
        detail:
          crewGap.code === "over_ratio"
            ? // An intro session's cap is PADI's Discover Scuba open-water
              // figure (2 per instructor, HD-6) and an assistant does not raise
              // it, so the entry-level wording — which cites the Open Water
              // 8-plus-2 and tells staff to add an assistant — would both
              // misquote a standard and prescribe a fix that changes nothing.
              // Each rule gets its own sentence.
              crewGap.ratio === "intro"
              ? overRatioIntroDetailText(t, crewGap.booked, crewGap.capacity)
              : overRatioDetailText(t, crewGap.booked, crewGap.capacity)
            : instructorMissingDetailText(t),
        actionLabel: openTripActionText(t),
        // The trip's crew editor, not the bare Overview it used to land on
        // (Lens 17 task 139) — the fix for either gap lives right there.
        href: `${tripHref}#crew`,
        dueAt: trip.startsAt,
      });
    }

    // The shop's own divemaster target (`divemasterRatioGap`,
    // src/lib/divemaster-ratio.ts) — applies to every dive the shop runs,
    // course session or fun dive alike, unlike `courseCrewGap` above, which
    // is an agency-published training ratio and only ever fires for a course
    // (issue #732). Reuses `counts`: the same crew count `courseCrewGap` just
    // read, never a second query or a second definition of who is in the
    // water (`countInWaterCrew`, src/lib/crew-roles.ts). Binds nothing —
    // this only informs, exactly as it does on the trip page.
    //
    // Skipped entirely when `courseCrewGap` already fired: a course session
    // missing its instructor is already flagged above, more precisely (its
    // sentence cites the actual agency ratio a seat is refused against), and
    // firing both would put two rows under one departure header naming the
    // same underlying gap in two vocabularies — the wallpaper failure this
    // codebase designs hard against elsewhere (DOM-H3). `courseCrewGap`
    // returns `"none"` for every fun dive by construction, so this never
    // suppresses the signal this ticket exists to add.
    const ratioGap =
      crewGap.code === "none"
        ? divemasterRatioGap({
            divers: trip.booked,
            divemasterCount: inWaterDivemasterCount(counts),
            diversPerDivemaster,
            // A departure the shop has marked self-guided raises neither of the
            // two rows below. Read here rather than branched on afterwards, so
            // this queue and the trip page cannot disagree (issue #973).
            selfGuided: trip.selfGuided,
          })
        : { code: "none" as const };
    if (ratioGap.code === "under_target") {
      // Two different sentences for two different problems, not one branching
      // on count: "nobody is rostered at all" and "one short of your target"
      // read as different severities because they are. The zero-crew case
      // gets its own kind and rank, above `nitrox_gate`; the below-target
      // case gets a quieter one, ranked with the other purely-advisory rows
      // (`KIND_SEVERITY`, src/lib/today.ts).
      if (ratioGap.divemasterCount === 0) {
        actions.push({
          id: `uncrewed:${trip.id}`,
          kind: "uncrewed_departure",
          urgency: urgencyFor(trip.startsAt, now),
          subject: trip.title,
          context: when,
          departure,
          aboutDeparture: true,
          detail: uncrewedDepartureDetailText(t, ratioGap.divers),
          actionLabel: openTripActionText(t),
          href: `${tripHref}#crew`,
          dueAt: trip.startsAt,
        });
      } else {
        actions.push({
          id: `crew-target:${trip.id}`,
          kind: "crew_below_target",
          urgency: urgencyFor(trip.startsAt, now),
          subject: trip.title,
          context: when,
          departure,
          aboutDeparture: true,
          detail: crewBelowTargetDetailText(
            t,
            ratioGap.divers,
            ratioGap.divemasterCount,
            diversPerDivemaster,
          ),
          actionLabel: openTripActionText(t),
          href: `${tripHref}#crew`,
          dueAt: trip.startsAt,
        });
      }
    }

    const forecastPoint =
      trip.diveSite &&
      trip.diveSite.forecastLatitude !== null &&
      trip.diveSite.forecastLongitude !== null
        ? { latitude: trip.diveSite.forecastLatitude, longitude: trip.diveSite.forecastLongitude }
        : null;
    if (forecastPoint && trip.booked > 0 && shouldShowAutomatedForecast(trip.startsAt, now)) {
      const forecast = await fetchAutomatedMarineForecast(forecastPoint, trip.startsAt);
      if (forecast && isHighWind(forecast.wind) && forecast.wind) {
        actions.push({
          id: `high-wind:${trip.id}`,
          kind: "high_wind_alert",
          urgency: "now",
          subject: trip.title,
          context: when,
          departure,
          aboutDeparture: true,
          detail: highWindAlertDetailText(
            t,
            forecast.wind.speedKnots,
            forecast.wind.gustsKnots,
            forecast.wind.direction ? forecast.wind.direction.toUpperCase() : null,
          ),
          actionLabel: openTripActionText(t),
          href: tripHref,
          dueAt: trip.startsAt,
        });
      }
    }

    // Emergency contact is a dock-settleable nudge, not a blocker, and only
    // worth surfacing once a boat is close (within three days). Beyond that it
    // is queue noise a diver still has time to fill in themselves.
    const withoutContact =
      urgencyFor(trip.startsAt, now) !== "later" ? (missingContact.get(trip.id) ?? []) : [];
    if (withoutContact.length > 0) {
      // One diver is a row about that person — named, like every other
      // single-diver row. Several stay one row about the boat.
      const lone = withoutContact.length === 1 ? withoutContact[0] : undefined;
      actions.push({
        id: `contact:${trip.id}`,
        kind: "emergency_contact",
        urgency: urgencyFor(trip.startsAt, now),
        subject: lone ? lone.fullName : trip.title,
        context: when,
        departure,
        ...(lone ? {} : { aboutDeparture: true }),
        detail: lone
          ? missingContactNamedDetailText(t)
          : missingContactDetailText(t, withoutContact.length),
        actionLabel: openGuestsActionText(t),
        href: `${tripHref}/guests`,
        dueAt: trip.startsAt,
      });
    }

    // A trip within 3 days that's under capacity and has never had a
    // last-minute deal sent is lost revenue staff can still act on. One-shot
    // per trip: once any blast has gone out, Today stops nudging even if
    // seats are still open — a shop that's already tried isn't nagged, but
    // can always resend from the trip page itself (docs ADR
    // 20260727-last-minute-fill-promos).
    const openSeats = Math.max(0, trip.capacity - trip.booked);
    // The reach test goes last on purpose: it is the only clause that scans a
    // list, and the three before it rule out most departures for free.
    //
    // Why it is there at all — a shop with an empty last-minute list, or one
    // whose members all stated dates that miss this departure, was being told
    // to "fill these seats" and handed a panel whose only content was an empty
    // state. The trip's Guests tab now hides that panel outright when nobody
    // matches, so this row's own `#last-minute-deal` anchor would land on
    // nothing. A queue row must be work someone can actually do
    // (design/principles.md #10).
    if (
      openSeats > 0 &&
      urgencyFor(trip.startsAt, now) !== "later" &&
      neverSentLastMinuteDeal.has(trip.id) &&
      lastMinuteWindows.some((entry) =>
        lastMinuteEntryMatchesTripDate(entry, shopDay(trip.startsAt, timeZone)),
      )
    ) {
      actions.push({
        id: `last-minute-fill:${trip.id}`,
        kind: "last_minute_fill",
        urgency: urgencyFor(trip.startsAt, now),
        subject: trip.title,
        context: when,
        departure,
        aboutDeparture: true,
        detail: lastMinuteFillDetailText(t, openSeats),
        actionLabel: openTripActionText(t),
        href: `${tripHref}/guests#last-minute-deal`,
        dueAt: trip.startsAt,
      });
    }

    const front = waitlisted.get(trip.id);
    const waiting = front?.count ?? 0;
    if (front && waiting > 0 && openSeats > 0) {
      actions.push({
        id: `waitlist:${trip.id}`,
        kind: "waitlist_seat",
        urgency: urgencyFor(trip.startsAt, now),
        subject: trip.title,
        context: when,
        departure,
        aboutDeparture: true,
        detail: waitlistSeatDetailText(t, openSeats, waiting),
        // One tap invites the longest-waiting diver without leaving Today; the href
        // stays the row's real destination — a pre-hydration tap, a middle-click
        // or an open-in-new-tab lands on the trip's wait-list section.
        actionLabel: inviteFromWaitlistActionText(t),
        href: `${tripHref}/guests#waitlist`,
        invite: {
          tripId: trip.id,
          entryId: front.entryId,
          personName: front.personName,
          personEmail: front.personEmail,
          invitedAt: front.invitedAt,
          bookingPath: publicTripPath(shopSlug, trip.id),
          tripTitle: trip.title,
          tripWhen: when,
        },
        dueAt: trip.startsAt,
      });
    }
  }

  for (const issue of deliveryIssues) {
    const isWaiver = issue.delivery.kind !== "booking_confirmation";
    const roster = `/shop/${shopSlug}/trips/${issue.trip.id}/guests#booking-${issue.booking.id}`;
    actions.push({
      id: `email:${issue.delivery.id}`,
      kind: "email_delivery",
      urgency: urgencyFor(issue.trip.startsAt, now),
      subject: issue.person.fullName,
      context: `${issue.trip.title} · ${at(issue.trip.startsAt, timeZone, locale)}`,
      departure: {
        tripId: issue.trip.id,
        label: `${issue.trip.title} · ${at(issue.trip.startsAt, timeZone, locale)}`,
      },
      detail: emailDeliveryDetailText(t, isWaiver, issue.delivery.status, issue.attempts),
      // One tap resends in place. A waiver reuses the WP-1 issue-and-deliver path
      // (a fresh link, since the token is never stored); a confirmation retries
      // from the stored booking. `href` stays the row's real destination, the
      // roster row — for a pre-hydration tap, a middle-click, or a new tab.
      actionLabel: emailResendActionText(t, isWaiver),
      ...(isWaiver
        ? { waiver: { bookingIds: [issue.booking.id] } }
        : { resend: { bookingId: issue.booking.id } }),
      href: roster,
      dueAt: issue.trip.startsAt,
    });
  }

  // A payment row only gets the inline "copy link"/"resend invoice" control
  // once we know the booking was actually invoiced through Stripe: a diver
  // who owes at the counter has no invoice to act on, and a shop with no
  // connected Stripe account has nothing to resend either. Both cases keep
  // the row's `href` fallback to the roster instead of a dead button.
  const paymentBookingIds = actions
    .map((action) => action.payment?.bookingId)
    .filter((id): id is string => Boolean(id));
  if (paymentBookingIds.length > 0) {
    const account = await getShopStripeAccount(db, shopId);
    const openOrders = canAcceptPayments(account)
      ? await openOrdersForBookings(db, shopId, paymentBookingIds)
      : new Map<string, { id: string; hostedInvoiceUrl: string | null }>();
    for (const action of actions) {
      if (!action.payment) continue;
      const order = openOrders.get(action.payment.bookingId);
      action.payment = order
        ? {
            bookingId: action.payment.bookingId,
            orderId: order.id,
            hostedInvoiceUrl: order.hostedInvoiceUrl,
          }
        : undefined;
    }
  }

  // Platform-health chores (task 157, UX persona lens 17): stuck Stripe
  // operations and photo deletions that never finished used to surface only
  // on the owner-only monthly Reports page — urgent work buried behind a
  // report nobody opens daily. Forced `urgency: "now"` (not derived from a
  // departure — there isn't one) so they land in today's queue the same day
  // they go stale; `dueAt: null` still sorts them after every dated row
  // within that band, matching the "undated work never jumps the line"
  // invariant every other action kind already follows. The full panels these
  // rows mirror moved off Reports with the surface consolidation — payments to
  // Orders, deletions to Settings' Data group — and each row's `href` points at
  // wherever its panel now is.
  if (includeOpsAlerts) {
    const [stuckOperations, pendingDeletions, owedRefunds] = await Promise.all([
      listStuckPaymentOperations(db, shopId, new Date(now.getTime() - STALE_AFTER_MS)),
      listPendingMediaDeletions(db, shopId, new Date(now.getTime() - STALE_PENDING_AFTER_MS)),
      listOwedShopCancellationRefunds(db, shopId, {
        olderThan: new Date(now.getTime() - OWED_REFUND_STALE_AFTER_MS),
      }),
    ]);

    for (const op of stuckOperations) {
      const when = formatShortDate(op.intent.startedAt, locale, timeZone);
      actions.push({
        id: `stuck-payment-op:${op.intent.id}`,
        kind: "stuck_payment_operation",
        urgency: "now",
        subject: op.personName ?? op.tripTitle ?? stuckOperationKindText(t, op.intent.kind),
        context: op.personName && op.tripTitle ? op.tripTitle : null,
        detail: stuckPaymentOperationDetailText(t, op.intent.kind, when, op.intent.stripeObjectId),
        // Points at the trip roster when there's one to point at; otherwise
        // Orders, which carries the reconciliation detail (Stripe id, exact
        // timestamp) to act from. That panel used to live on Reports.
        actionLabel: op.tripId ? openTripActionText(t) : openOrdersActionText(t),
        href: op.tripId
          ? `/shop/${shopSlug}/trips/${op.tripId}/guests`
          : `/shop/${shopSlug}/orders`,
        dueAt: null,
      });
    }

    for (const attempt of pendingDeletions) {
      actions.push({
        id: `media-deletion:${attempt.id}`,
        kind: "failed_photo_deletion",
        urgency: "now",
        subject: mediaDeletionKindText(t, attempt.kind),
        context: null,
        detail: failedPhotoDeletionDetailText(
          t,
          attempt.kind,
          formatShortDate(attempt.createdAt, locale, timeZone),
        ),
        // Settings' "Data & integrations" group — the retry button for a stuck
        // deletion lives there now, at the group anchor this href lands on.
        actionLabel: openDataSettingsActionText(t),
        href: `/shop/${shopSlug}/settings#data-integrations`,
        dueAt: null,
      });
    }

    // Money the shop owes a diver for a departure it cancelled and could not
    // put back on the card. Mirrored here, not owned here: the panel on the
    // Orders index is where these live and where staff act on them, the same
    // arrangement the two queues above use.
    //
    // This is the one platform-health row with a person waiting on the other
    // end of it — every one of these divers has already had an email saying the
    // shop will be in touch.
    for (const owed of owedRefunds) {
      actions.push({
        id: `owed-refund:${owed.bookingId}`,
        kind: "owed_refund",
        urgency: "now",
        subject: owed.diverName,
        context: owed.tripTitle,
        detail: owedRefundDetailText(t, {
          amount:
            owed.amountCents === null
              ? null
              : formatMoneyCents(owed.amountCents, owed.currency, locale),
          tripTitle: owed.tripTitle,
          when: formatShortDate(owed.tripStartsAt, locale, timeZone),
        }),
        // The departure's Guests tab, which is both where the seat is and where
        // the payment gets marked refunded once the cash is back in a hand.
        actionLabel: openGuestsActionText(t),
        href: `/shop/${shopSlug}/trips/${owed.tripId}/guests`,
        dueAt: null,
      });
    }
  }

  // Reviews waiting on moderation. This used to be a count badge on a nav row;
  // when Reviews left the header, the signal moved here — the queue is the one
  // page that ranks pending work, and a badge on a menu was the only signal in
  // the app that never said what to do about itself. One row for the whole
  // queue (never one per review), `later` urgency and `dueAt: null` because
  // nothing sails or refunds on a review — it informs, it never nags.
  // At a count of exactly 1 the row lands on that review's own anchor rather
  // than the top of the index, since there is a single "the" review to open;
  // at 2 or more there is not, and the destination stays the bare list. The
  // anchor id is the reviews list's own `review-<id>`, the same fragment a
  // refused hide already redirects back to.
  const reviewsAwaiting = await readReviewsAwaitingModeration(db, shopId);
  if (reviewsAwaiting.count > 0) {
    const reviewsHref = `/shop/${shopSlug}/reviews`;
    actions.push({
      id: "reviews:pending",
      kind: "reviews_pending",
      urgency: "later",
      subject: reviewsPendingSubjectText(t, reviewsAwaiting.count),
      context: null,
      detail: reviewsPendingDetailText(t),
      actionLabel: openReviewsActionText(t),
      href: reviewsAwaiting.onlyId
        ? `${reviewsHref}#review-${reviewsAwaiting.onlyId}`
        : reviewsHref,
      dueAt: null,
    });
  }

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
  const [shopUnits] = await db
    .select({ unitsConfirmedAt: shops.unitsConfirmedAt, currency: shops.currency })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (shopUnits && !shopUnits.unitsConfirmedAt && (await countShopTrips(db, shopId)) > 0) {
    actions.push({
      id: "units:unconfirmed",
      kind: "units_unconfirmed",
      urgency: "later",
      subject: unitsUnconfirmedSubjectText(t),
      context: null,
      detail: unitsUnconfirmedDetailText(t, shopUnits.currency.toUpperCase()),
      actionLabel: openUnitsActionText(t),
      href: `/shop/${shopSlug}/settings#units`,
      dueAt: null,
    });
  }

  // The gear register's chase list (ADR 20260815-minimal-gear-register): what
  // never came home, what is due back before tonight, and which bench clock
  // runs out this week. Mirrored here, not owned here — the register readers
  // are the owning surface's own, so the queue and the register can never
  // disagree — and self-gating: a shop with no fleet produces no rows.
  const todayLocal = calendarDateInTimezone(now, timeZone);
  const [overdueGear, dueBackGear, gearServiceDueRows] = await Promise.all([
    listOverdueGearReservations(db, shopId, todayLocal),
    listGearDueBack(db, shopId, todayLocal),
    // Six days, not seven: dueAt below is the *shop-local* midnight of the due
    // date, and the queue's one-week-horizon invariant is measured in flat UTC
    // hours — a seventh local day can poke past it by a DST hour.
    listGearServiceDue(db, shopId, todayLocal, 6),
  ]);
  // A calendar date's instant on the shop's own clock — midnight opening the
  // day (a service deadline), or midnight closing it (a return due by tonight).
  const localMidnight = (day: string, plusDays = 0) => {
    const [year, month, dayOfMonth] = day.split("-").map(Number);
    return wallTimeToUtc(
      { year: year ?? 0, month: month ?? 1, day: (dayOfMonth ?? 1) + plusDays, hour: 0, minute: 0 },
      timeZone,
    );
  };
  for (const row of overdueGear) {
    actions.push({
      id: `gear-overdue:${row.reservationId}`,
      kind: "gear_overdue",
      // Forced: the window already closed, so there is no future instant to
      // derive urgency from — this is today's work however old the date is.
      urgency: "now",
      subject: row.personName,
      context: row.tripTitle,
      // Two different chases wearing one kind: a checked-out unit is out
      // with a diver (a phone call), a never-collected one hangs on the
      // wall and wants its stale claim released — saying "out with" about
      // the second would teach staff to skim the rows that matter.
      detail: row.checkedOutAt
        ? gearOverdueDetailText(t, {
            unitLabel: row.label,
            dueOn: formatCalendarDate(row.reservedUntil, locale),
          })
        : gearNeverPickedUpDetailText(t, {
            unitLabel: row.label,
            dueOn: formatCalendarDate(row.reservedUntil, locale),
          }),
      actionLabel: openGearRegisterActionText(t),
      href: `/shop/${shopSlug}/gear`,
      // The closed window's end, in the past — the longest-out unit leads.
      dueAt: localMidnight(row.reservedUntil, 1),
    });
  }
  for (const row of dueBackGear) {
    // Due by the end of the shop's own day: "now" all day, sharpening to
    // "imminent" as the evening runs out.
    const dueAt = localMidnight(row.reservedUntil, 1);
    actions.push({
      id: `gear-due-back:${row.reservationId}`,
      kind: "gear_due_back",
      urgency: urgencyFor(dueAt, now),
      subject: row.personName,
      context: row.tripTitle,
      detail: gearDueBackDetailText(t, { unitLabel: row.label }),
      actionLabel: openGearRegisterActionText(t),
      href: `/shop/${shopSlug}/gear`,
      dueAt,
    });
  }
  for (const row of gearServiceDueRows) {
    if (row.state.state !== "overdue" && row.state.state !== "due_soon") continue;
    const dueAt = localMidnight(row.state.nextDueOn);
    actions.push({
      id: `gear-service:${row.gearItemId}`,
      kind: "gear_service_due",
      // An expired clock has no future instant to derive urgency from; it is
      // counter work today, never "imminent" — that band means boats and people.
      urgency: row.state.state === "overdue" ? "now" : urgencyFor(dueAt, now),
      subject: row.label,
      context: null,
      detail: gearServiceDueDetailText(t, {
        clockLabel: gearServiceKindLabel(t, row.state.kind),
        overdue: row.state.state === "overdue",
        dueOn: formatCalendarDate(row.state.nextDueOn, locale),
      }),
      actionLabel: openGearUnitActionText(t),
      href: `/shop/${shopSlug}/gear/${row.gearItemId}`,
      dueAt,
    });
  }

  const credentialHorizon = now.getTime() + 30 * 24 * HOUR_MS;
  for (const row of credentialRows) {
    const renewsAt = row.credential.renewsAt;
    if (!renewsAt || !isValidCalendarDate(renewsAt)) continue;
    const dueAt = calendarDateToUtcMidnight(renewsAt);
    if (dueAt.getTime() > credentialHorizon) continue;
    // A renewal date is a calendar date, not an instant. Comparing its UTC
    // midnight against `now` marked a credential overdue for the whole of the
    // day it actually renews in every shop west of Greenwich -- in Cancun, from
    // 19:00 the evening before. CR-009: a date-only expiry is good through the
    // end of its own local day.
    const overdue = isCalendarDateExpired(renewsAt, todayLocal);
    actions.push({
      id: `staff-credential:${row.credential.id}`,
      kind: "staff_credential_due",
      urgency: overdue ? "now" : urgencyFor(dueAt, now),
      subject: row.person.fullName,
      context: null,
      detail: staffCredentialDueDetailText(t, {
        credential: row.credential.name,
        dueOn: formatCalendarDate(renewsAt, locale),
        overdue,
      }),
      actionLabel: openStaffingActionText(t),
      href: `/shop/${shopSlug}/staffing#credentials`,
      dueAt,
    });
  }

  const departures: DepartureSummary[] = todayTrips.map((trip) => {
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
      return trip.startsAt.getTime() + DEPARTURE_BUFFER_MS > now.getTime();
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
      ready: rows.filter((row) => row.readiness.status === "ready").length,
      blocked: blockedRows.length,
      boarded: aboardCount,
      blockedAboard: aboardBlocked.length,
      blockedAboardGroups: groupAboardBlockers(
        aboardBlocked.map((row) => ({
          blockers: row.readiness.blockers,
          value: row.person.fullName,
        })),
      ).map((group) => ({ kind: group.kind, names: group.members })),
      blockedAshore: ashoreBlocked.length,
      blockedAshoreNames: ashoreBlocked.map((row) => row.person.fullName),
      courseTitle: trip.course?.title ?? null,
      crew: tripCrew,
      crewAccountedFor: completeness.crewAccountedFor,
      crewReason: completeness.crewReason,
    };
  });

  const next = todayTrips.length === 0 ? upcoming[0] : null;

  let crewedTripIds: string[] = [];
  let crewedSessions: CrewedSessionSummary[] = [];
  if (personId && inWindow.length > 0) {
    const assignments = await db
      .select({ tripId: tripAssignments.tripId })
      .from(tripAssignments)
      .where(
        and(
          eq(tripAssignments.personId, personId),
          inArray(
            tripAssignments.tripId,
            inWindow.map((trip) => trip.id),
          ),
        ),
      );
    const crewed = new Set(assignments.map((row) => row.tripId));
    crewedTripIds = inWindow.filter((trip) => crewed.has(trip.id)).map((trip) => trip.id);
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
        };
      });
  }

  const { visibleActions, withheldCount } = filterActionsForRoles(actions, roles);

  return {
    departures,
    actions: visibleActions,
    withheldCount,
    nextDeparture: next ? { title: next.title, startsAt: next.startsAt, tripId: next.id } : null,
    crewedTripIds,
    crewedSessions,
    availableStaff,
  };
}
