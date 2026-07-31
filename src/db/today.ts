import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import {
  emailDeliveryDetailText,
  emailResendActionText,
  instructorMissingDetailText,
  inviteFromWaitlistActionText,
  lastMinuteFillDetailText,
  missingContactDetailText,
  missingFitDetailText,
  openGuestsActionText,
  openPrepListActionText,
  openTripActionText,
  overRatioDetailText,
  ungatedNitroxDetailText,
  waitlistSeatDetailText,
} from "@/i18n/today-labels";
import { nowDate } from "@/lib/clock";
import { courseCrewGap } from "@/lib/course-ratios";
import { formatTime } from "@/lib/format";
import { collapseDiverActions, TODAY_HORIZON_MS, type TodayAction, urgencyFor } from "@/lib/today";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import type { AppDb } from "./client";
import { authorizesNitroxFill } from "./nitrox";
import { listNotificationDeliveryIssues } from "./notifications";
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
