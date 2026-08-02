import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import {
  emailDeliveryDetailText,
  emailResendActionText,
  failedPhotoDeletionDetailText,
  instructorMissingDetailText,
  inviteFromWaitlistActionText,
  lastMinuteFillDetailText,
  mediaDeletionKindText,
  missingContactDetailText,
  missingFitDetailText,
  openGuestsActionText,
  openPrepListActionText,
  openReportsActionText,
  openRollCallActionText,
  openRollCallDetailText,
  openTripActionText,
  overRatioDetailText,
  stuckOperationKindText,
  stuckPaymentOperationDetailText,
  ungatedNitroxDetailText,
  waitlistSeatDetailText,
} from "@/i18n/today-labels";
import { nowDate } from "@/lib/clock";
import { courseCrewGap } from "@/lib/course-ratios";
import { formatDateTimeTz, formatShortDate, formatTime } from "@/lib/format";
import { carryForwardNotBoarded, type RollCallRecord, rollCallCheckpoints } from "@/lib/manifests";
import { collapseDiverActions, TODAY_HORIZON_MS, type TodayAction, urgencyFor } from "@/lib/today";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import type { AppDb } from "./client";
import { listPendingMediaDeletions, STALE_PENDING_AFTER_MS } from "./media-deletions";
import { authorizesNitroxFill } from "./nitrox";
import { listNotificationDeliveryIssues } from "./notifications";
import { openOrdersForBookings } from "./orders";
import { listStuckPaymentOperations, STALE_AFTER_MS } from "./payment-operations";
import { listTripsReadiness } from "./readiness";
import {
  bookings,
  nitroxCertifications,
  people,
  personRoles,
  rentalFitProfiles,
  rollCallEvents,
  tripAssignments,
  trips,
  tripWaitlistEntries,
} from "./schema";
import { canAcceptPayments, getShopStripeAccount } from "./stripe-accounts";
import { tripIdsNeverSentLastMinuteDeal } from "./trip-promos";
import { listStaff, pagedUpcomingTripsWithCounts } from "./trips";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Today's boat: the trip id staff would check in for right now, or null on a
 * day the shop has no departure. The command palette uses it to offer a
 * "Boarding — today's boat" jump straight to the manifest. Deliberately
 * lightweight — a bounded scan of scheduled trips around now, filtered to the
 * shop's calendar day, preferring a boat that hasn't finished over one that
 * already sailed.
 */
export async function todayNextDepartureTripId(
  db: AppDb,
  shopId: string,
  timeZone: string,
  now: Date = nowDate(),
): Promise<string | null> {
  const today = shopDay(now, timeZone);
  const rows = await db
    .select({ id: trips.id, startsAt: trips.startsAt, endsAt: trips.endsAt })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, new Date(now.getTime() - 18 * HOUR_MS)),
        lte(trips.startsAt, new Date(now.getTime() + 30 * HOUR_MS)),
      ),
    )
    .orderBy(asc(trips.startsAt));
  const todays = rows.filter((row) => shopDay(row.startsAt, timeZone) === today);
  const active = todays.find((row) => row.endsAt >= now) ?? todays[0];
  return active?.id ?? null;
}

/**
 * How many upcoming departures the queue will inspect. Readiness is a per-trip
 * roll-up, so this bounds the work; a shop with more than this many departures
 * inside a week is served better by Schedule than by a triage list.
 */
const MAX_TRIPS = 20;

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
  boarded: number;
  courseTitle: string | null;
  crew: { id: string; fullName: string; roles: string[] }[];
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
 * Latest departure-checkpoint roll call per booking, for every trip sailing
 * today. One query rather than a manifest build per trip: the board needs a
 * head count, not the safety document.
 */
async function boardedCountsByTrip(db: AppDb, shopId: string, tripIds: string[]) {
  const counts = new Map<string, number>();
  if (tripIds.length === 0) return counts;
  const rows = await db
    .select({
      tripId: rollCallEvents.tripId,
      bookingId: rollCallEvents.bookingId,
      status: rollCallEvents.status,
    })
    .from(rollCallEvents)
    // A booking cancelled after boarding (a no-show pulled, a refund) keeps its
    // roll-call event row — without this join, its stale "boarded" would still
    // count here even though `booked` (upcomingTripsWithCounts) already excludes
    // it, letting the two totals coincidentally match with someone still
    // unboarded. Same guard the write path (recordRollCall) and the manifest's
    // own roster already apply.
    .innerJoin(
      bookings,
      and(eq(bookings.id, rollCallEvents.bookingId), ne(bookings.status, "cancelled")),
    )
    .where(
      and(
        eq(rollCallEvents.shopId, shopId),
        eq(rollCallEvents.checkpoint, "departure"),
        inArray(rollCallEvents.tripId, tripIds),
      ),
    )
    .orderBy(asc(rollCallEvents.occurredAt), asc(rollCallEvents.createdAt));
  // Ordered oldest-first, so the last write per booking wins. A latest `cleared`
  // event is an undo, so it simply never counts as boarded below.
  const latest = new Map<
    string,
    { tripId: string; status: "boarded" | "not_boarded" | "cleared" }
  >();
  for (const row of rows) latest.set(row.bookingId, { tripId: row.tripId, status: row.status });
  for (const { tripId, status } of latest.values()) {
    if (status === "boarded") counts.set(tripId, (counts.get(tripId) ?? 0) + 1);
  }
  return counts;
}

/**
 * How far back Today chases an after-dive head count that never closed
 * (DOM-H3). Two days: long enough that a boat which tied up late last night is
 * still chased through the next morning's shift — the case that matters — and
 * short enough that the queue stays a list of work someone can still do, not
 * an audit log. Older than this and the answer is not on the dock any more; it
 * is an incident, and the trip's own manifest is where it gets reconstructed.
 */
export const RETURNED_ROLL_CALL_LOOKBACK_MS = 48 * HOUR_MS;

/** Bounds the backwards pass the same way MAX_TRIPS bounds the forward one. */
const MAX_RETURNED_TRIPS = 20;

/**
 * A departure that is back at the dock with an after-dive roll call still
 * open. Codes and numbers only — `src/i18n/today-labels.ts` picks the words.
 */
export type OpenRollCall = {
  tripId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  priceCents: number | null;
  /** 1-based dive number of the *earliest* after-dive checkpoint still open. */
  diveNumber: number;
  /** Divers with no roll-call result recorded at that checkpoint. */
  uncounted: number;
  /** Everyone the manifest lists for that checkpoint (cancelled bookings aside). */
  totalDivers: number;
};

/**
 * Departures that already came back with a head count still open — the number
 * that says whether anybody is still in the water (DOM-H3).
 *
 * **This is the one reader here that looks backwards, on purpose.** Every other
 * signal on this page hangs off `pagedUpcomingTripsWithCounts`, which only ever
 * returns trips whose `startsAt` is still ahead of `now`; a boat that sailed at
 * 07:00 has already fallen out of it by 07:01, and one that tied up late last
 * night was never in it at all. Filtering the forward window harder could not
 * reach either. So this runs its own bounded query over `endsAt` instead.
 *
 * "Unfinished" is defined exactly as the manifest defines it, so Today can
 * never call a boat closed that the manifest still shows open:
 *
 * - the roster is the manifest's roster — every booking that is not cancelled,
 *   `no_show` included (it is on the manifest, so it is in this count);
 * - a diver's result at a checkpoint is their *latest* event there, and a
 *   latest `cleared` is an undo that returns them to awaiting
 *   (`listLatestRollCallByBooking`, src/db/manifests.ts);
 * - an explicit `not_boarded` carries forward to later checkpoints
 *   (`carryForwardNotBoarded`, src/lib/manifests.ts) — someone deliberately
 *   left ashore is accounted for, and carry-forward never fabricates a
 *   `boarded`, so "awaiting" still means nobody counted this person;
 * - a checkpoint with no events at all is therefore entirely uncounted, which
 *   is the loudest case and must alarm rather than read as "nothing to do".
 *
 * Only the after-dive checkpoints raise it. Departure boarding is already
 * chased by every readiness row on the queue; this is the count on the way
 * back. Reported per trip at the *earliest* open dive — where the chain broke.
 */
export async function openAfterDiveRollCalls(
  db: AppDb,
  shopId: string,
  now: Date = nowDate(),
): Promise<OpenRollCall[]> {
  const returned = await db
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
        eq(trips.shopId, shopId),
        // A cancelled trip never sailed, so it has nobody to count back.
        eq(trips.status, "scheduled"),
        lte(trips.endsAt, now),
        gte(trips.endsAt, new Date(now.getTime() - RETURNED_ROLL_CALL_LOOKBACK_MS)),
      ),
    )
    .orderBy(asc(trips.endsAt))
    .limit(MAX_RETURNED_TRIPS);
  if (returned.length === 0) return [];
  const tripIds = returned.map((trip) => trip.id);

  const [roster, events] = await Promise.all([
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
      .orderBy(asc(rollCallEvents.occurredAt), asc(rollCallEvents.createdAt)),
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

  const open: OpenRollCall[] = [];
  for (const trip of returned) {
    const bookingIds = rosterByTrip.get(trip.id) ?? [];
    // An empty boat has nobody to count, exactly as the manifest's own
    // "complete" rule requires a `totalDivers > 0` before it says so.
    if (bookingIds.length === 0) continue;
    const checkpoints = rollCallCheckpoints(trip.plannedDives);
    const uncounted = checkpoints.map(() => 0);
    for (const bookingId of bookingIds) {
      const effective = carryForwardNotBoarded(
        checkpoints.map((checkpoint) => {
          const event = latestByBookingCheckpoint.get(`${bookingId}\0${checkpoint}`);
          // A latest `cleared` is staff undoing a mistake: the diver reads as
          // awaiting again, so it must re-alarm rather than stay resolved.
          if (!event || event.status === "cleared") return undefined;
          // Only `state` decides a head count. The recorder's name and note are
          // the manifest's display fields, so they are deliberately not queried.
          return {
            state: event.status,
            occurredAt: event.occurredAt,
            recordedByName: "",
            note: null,
          } satisfies RollCallRecord;
        }),
      );
      effective.forEach((record, index) => {
        if (!record) uncounted[index] = (uncounted[index] ?? 0) + 1;
      });
    }
    // Index 0 is `departure`; the after-dive checkpoints start at 1 and their
    // index *is* their dive number.
    for (let dive = 1; dive < checkpoints.length; dive++) {
      const count = uncounted[dive] ?? 0;
      if (count === 0) continue;
      open.push({
        tripId: trip.id,
        title: trip.title,
        startsAt: trip.startsAt,
        endsAt: trip.endsAt,
        capacity: trip.capacity,
        priceCents: trip.priceCents,
        diveNumber: dive,
        uncounted: count,
        totalDivers: bookingIds.length,
      });
      // One row per boat, at the earliest dive still open — that is where the
      // count broke, and closing it is what the crew does next.
      break;
    }
  }
  return open;
}

/**
 * Divers on an upcoming departure with no rental fit on file. The prep list is
 * derived entirely from fit, so a missing fit is a hole in tomorrow's packing
 * that nobody sees until the diver is standing at the counter.
 */
async function missingFitByTrip(
  db: AppDb,
  shopId: string,
  bookingIdsByTrip: Map<string, string[]>,
) {
  const bookingIds = [...bookingIdsByTrip.values()].flat();
  const missing = new Map<string, number>();
  if (bookingIds.length === 0) return missing;
  const rows = await db
    .select({ bookingId: bookings.id, fitId: rentalFitProfiles.id })
    .from(bookings)
    .leftJoin(
      rentalFitProfiles,
      and(
        eq(rentalFitProfiles.personId, bookings.personId),
        eq(rentalFitProfiles.shopId, bookings.shopId),
      ),
    )
    .where(and(eq(bookings.shopId, shopId), inArray(bookings.id, bookingIds)));
  const withoutFit = new Set(rows.filter((row) => !row.fitId).map((row) => row.bookingId));
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
  const missing = new Map<string, number>();
  if (bookingIds.length === 0) return missing;
  const rows = await db
    .select({
      bookingId: bookings.id,
      contactName: people.emergencyContactName,
      contactPhone: people.emergencyContactPhone,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(and(eq(bookings.shopId, shopId), inArray(bookings.id, bookingIds)));
  // A contact is only usable if the crew can dial it: both a name and a phone.
  // A name with no number reads as "on file" but is unreachable in an incident.
  const without = new Set(
    rows.filter((row) => !row.contactName || !row.contactPhone).map((row) => row.bookingId),
  );
  for (const [tripId, ids] of bookingIdsByTrip) {
    const count = ids.filter((id) => without.has(id)).length;
    if (count > 0) missing.set(tripId, count);
  }
  return missing;
}

/**
 * Wait-list depth *and* the front-of-line entry per trip, so a freed seat can be
 * offered to a real person straight from the queue. The front is the earliest
 * join (the person actually next in line); its name, email, and last-invited
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

/** How many instructors and certified assistants (divemasters) each course trip's crew has. */
async function courseCrewCountsByTrip(
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
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(people.shopId, shopId),
        inArray(personRoles.role, ["instructor", "divemaster"]),
        inArray(tripAssignments.tripId, tripIds),
      ),
    );
  const rolesByTrip = new Map<string, Map<string, Set<string>>>();
  for (const row of rows) {
    const rolesByPerson = rolesByTrip.get(row.tripId) ?? new Map<string, Set<string>>();
    const roles = rolesByPerson.get(row.personId) ?? new Set<string>();
    roles.add(row.role);
    rolesByPerson.set(row.personId, roles);
    rolesByTrip.set(row.tripId, rolesByPerson);
  }
  for (const tripId of tripIds) {
    const rolesByPerson = rolesByTrip.get(tripId) ?? new Map<string, Set<string>>();
    let instructorCount = 0;
    let assistantCount = 0;
    for (const roles of rolesByPerson.values()) {
      if (roles.has("instructor")) instructorCount += 1;
      // A person holding both roles is the instructor, not their own assistant.
      else if (roles.has("divemaster")) assistantCount += 1;
    }
    counts.set(tripId, { instructorCount, assistantCount });
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
): Promise<TodayWork> {
  const horizon = new Date(now.getTime() + TODAY_HORIZON_MS);
  // The board only ever shows the soonest MAX_TRIPS departures, so bound the
  // query itself with the already-existing keyset page (`pagedUpcomingTripsWithCounts`)
  // rather than fetching every scheduled trip in the shop's future and slicing after.
  const { trips: upcoming } = await pagedUpcomingTripsWithCounts(db, shopId, {
    now,
    limit: MAX_TRIPS,
  });
  const inWindow = upcoming.filter((trip) => trip.startsAt <= horizon);
  const today = shopDay(now, timeZone);
  const todayTrips = inWindow.filter((trip) => shopDay(trip.startsAt, timeZone) === today);

  // One batched readiness pass for the whole window, not one per trip. The
  // per-trip call issues about ten queries of its own, so a six-departure
  // morning was sixty round trips to render the shop's most-visited page;
  // `listTripsReadiness` answers the same question for every trip at once.
  const readinessByTrip = new Map<string, Awaited<ReturnType<typeof listTripsReadiness>>>();
  for (const trip of inWindow) readinessByTrip.set(trip.id, []);
  for (const row of await listTripsReadiness(
    db,
    shopId,
    inWindow.map((trip) => trip.id),
    now,
  )) {
    readinessByTrip.get(row.booking.tripId)?.push(row);
  }
  const bookingIdsByTrip = new Map(
    inWindow.map((trip) => [
      trip.id,
      (readinessByTrip.get(trip.id) ?? []).map((row) => row.booking.id),
    ]),
  );

  const [
    boarded,
    missingFit,
    ungatedNitrox,
    missingContact,
    waitlisted,
    courseCrewCounts,
    deliveryIssues,
    neverSentLastMinuteDeal,
    openRollCalls,
  ] = await Promise.all([
    boardedCountsByTrip(
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
    courseCrewCountsByTrip(
      db,
      shopId,
      inWindow.filter((trip) => trip.course).map((trip) => trip.id),
    ),
    listNotificationDeliveryIssues(db, shopId, { from: now, until: horizon }),
    tripIdsNeverSentLastMinuteDeal(
      db,
      shopId,
      inWindow.map((trip) => trip.id),
    ),
    // Deliberately not derived from `inWindow`/`todayTrips`: those look only
    // forward, and a boat that already came back is exactly what this chases.
    openAfterDiveRollCalls(db, shopId, now),
  ]);

  const rawStaff = await listStaff(db, shopId);
  const availableStaff = rawStaff.map((s) => ({
    id: s.person.id,
    fullName: s.person.fullName,
    roles: s.roles,
  }));

  const tripIds = todayTrips.map((t) => t.id);
  const assignments =
    tripIds.length > 0
      ? await db
          .select({
            tripId: tripAssignments.tripId,
            personId: people.id,
            fullName: people.fullName,
            role: personRoles.role,
          })
          .from(tripAssignments)
          .innerJoin(people, eq(people.id, tripAssignments.personId))
          .innerJoin(personRoles, eq(personRoles.personId, people.id))
          .where(inArray(tripAssignments.tripId, tripIds))
      : [];

  const crewByTrip = new Map<string, { id: string; fullName: string; roles: string[] }[]>();
  for (const row of assignments) {
    const list = crewByTrip.get(row.tripId) ?? [];
    let entry = list.find((c) => c.id === row.personId);
    if (!entry) {
      entry = { id: row.personId, fullName: row.fullName, roles: [] };
      list.push(entry);
    }
    if (!entry.roles.includes(row.role)) {
      entry.roles.push(row.role);
    }
    crewByTrip.set(row.tripId, list);
  }

  const actions: TodayAction[] = [];

  // The boat is already at the dock and somebody on its list was never counted
  // back (DOM-H3). Nothing else on this queue can mean a diver is still in the
  // water, so it leads: top `KIND_SEVERITY`, pinned to the top urgency band,
  // and dated at the moment the trip tied up — always in the past, so it also
  // sorts ahead of every still-upcoming row inside that band. Urgency is set
  // rather than derived because there is no "before it sails" left to derive
  // from; the departure it would hang off has already happened.
  for (const open of openRollCalls) {
    const checkpoint = `after_dive_${open.diveNumber}`;
    actions.push({
      id: `roll-call:${open.tripId}:${checkpoint}`,
      kind: "roll_call_unfinished",
      urgency: "imminent",
      subject: open.title,
      // The safety-event timestamp format, with its timezone spelled out: a
      // bare time would read as "this morning" for a boat that returned last
      // night, which is the case this row exists for.
      context: formatDateTimeTz(open.endsAt, locale, timeZone),
      detail: openRollCallDetailText(t, open.diveNumber, open.uncounted, open.totalDivers),
      actionLabel: openRollCallActionText(t),
      // Straight to the checkpoint that is open, not the manifest's default
      // departure tab — one tap from the queue to the count that closes it.
      href: `/shop/${shopSlug}/trips/${open.tripId}/manifest?checkpoint=${checkpoint}`,
      dueAt: open.endsAt,
    });
  }

  for (const trip of inWindow) {
    const tripHref = `/shop/${shopSlug}/trips/${trip.id}`;
    const when = at(trip.startsAt, timeZone, locale);

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
        detail: ungatedNitroxDetailText(t, ungatedCount),
        actionLabel: openPrepListActionText(t),
        href: `${tripHref}/prep`,
        dueAt: trip.startsAt,
      });
    }

    // The one "course crew gap" computation (Lens 17 task 151) — also
    // consumed by the trip page and the staffing coverage list, so a course
    // Today calls fully crewed can't secretly still be over its ratio there.
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
        detail:
          crewGap.code === "over_ratio"
            ? overRatioDetailText(t, crewGap.booked, crewGap.capacity)
            : instructorMissingDetailText(t),
        actionLabel: openTripActionText(t),
        // The trip's crew editor, not the bare Overview it used to land on
        // (Lens 17 task 139) — the fix for either gap lives right there.
        href: `${tripHref}#crew`,
        dueAt: trip.startsAt,
      });
    }

    // Emergency contact is a dock-settleable nudge, not a blocker, and only
    // worth surfacing once a boat is close (within three days). Beyond that it
    // is queue noise a diver still has time to fill in themselves.
    const withoutContact =
      urgencyFor(trip.startsAt, now) !== "later" ? (missingContact.get(trip.id) ?? 0) : 0;
    if (withoutContact > 0) {
      actions.push({
        id: `contact:${trip.id}`,
        kind: "emergency_contact",
        urgency: urgencyFor(trip.startsAt, now),
        subject: trip.title,
        context: when,
        detail: missingContactDetailText(t, withoutContact),
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
    if (
      openSeats > 0 &&
      urgencyFor(trip.startsAt, now) !== "later" &&
      neverSentLastMinuteDeal.has(trip.id)
    ) {
      actions.push({
        id: `last-minute-fill:${trip.id}`,
        kind: "last_minute_fill",
        urgency: urgencyFor(trip.startsAt, now),
        subject: trip.title,
        context: when,
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
        detail: waitlistSeatDetailText(t, openSeats, waiting),
        // One tap invites the next in line straight from the queue; the href is
        // the no-JS fallback to the trip's wait-list section.
        actionLabel: inviteFromWaitlistActionText(t),
        href: `${tripHref}/guests#waitlist`,
        invite: {
          tripId: trip.id,
          entryId: front.entryId,
          personName: front.personName,
          personEmail: front.personEmail,
          invitedAt: front.invitedAt,
          bookingPath: `/shop/${shopSlug}/schedule/${trip.id}`,
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
      detail: emailDeliveryDetailText(t, isWaiver, issue.delivery.status, issue.attempts),
      // One tap resends in place. A waiver reuses the WP-1 issue-and-deliver path
      // (a fresh link, since the token is never stored); a confirmation retries
      // from the stored booking. `href` is the no-JS fallback to the roster row.
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
  // invariant every other action kind already follows. Reports keeps its own
  // panel — this is "also surface on Today", not "move".
  if (includeOpsAlerts) {
    const [stuckOperations, pendingDeletions] = await Promise.all([
      listStuckPaymentOperations(db, shopId, new Date(now.getTime() - STALE_AFTER_MS)),
      listPendingMediaDeletions(db, shopId, new Date(now.getTime() - STALE_PENDING_AFTER_MS)),
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
        // Reports is the only surface with the reconciliation detail
        // (Stripe id, exact timestamp) to act from.
        actionLabel: op.tripId ? openTripActionText(t) : openReportsActionText(t),
        href: op.tripId
          ? `/shop/${shopSlug}/trips/${op.tripId}/guests`
          : `/shop/${shopSlug}/reports`,
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
        actionLabel: openReportsActionText(t),
        href: `/shop/${shopSlug}/reports`,
        dueAt: null,
      });
    }
  }

  const departures: DepartureSummary[] = todayTrips.map((trip) => {
    const rows = readinessByTrip.get(trip.id) ?? [];
    return {
      tripId: trip.id,
      title: trip.title,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      booked: trip.booked,
      capacity: trip.capacity,
      ready: rows.filter((row) => row.readiness.status === "ready").length,
      blocked: rows.filter((row) => row.readiness.status === "blocked").length,
      boarded: boarded.get(trip.id) ?? 0,
      courseTitle: trip.course?.title ?? null,
      crew: crewByTrip.get(trip.id) ?? [],
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

  return {
    departures,
    actions,
    nextDeparture: next ? { title: next.title, startsAt: next.startsAt, tripId: next.id } : null,
    crewedTripIds,
    crewedSessions,
    availableStaff,
  };
}
