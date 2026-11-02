import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { inTrainingBefore } from "@/lib/in-training";
import { INVITE_SUGGESTIONS_SHOWN, inviteCooldownStart } from "@/lib/invite-suggestions";
import { requirementDemandsNothing, unionRequirements } from "@/lib/requirement";
import { decideTripAdmission, type TripAdmissionEvidence } from "@/lib/trip-admission";
import { DEPARTURE_BUFFER_MS } from "@/lib/trips";
import { readCertificationEvidenceFor } from "./certification-evidence";
import { listCourseSeatsInTraining } from "./certifications-in-training";
import type { AppDb, DbExecutor } from "./client";
import { departureOpenToDiver } from "./interest-offers";
import { ensureDepartureInterest } from "./interests";
import { queryAll } from "./query-helpers";
import { getTripRequirements, getTripSiteRequirement } from "./readiness";
import {
  bookings,
  courses,
  diveSites,
  interests,
  people,
  personRoles,
  trips,
  waiverRecords,
} from "./schema";
import { tripPrimarySiteId, tripVisitsSite } from "./trip-primary-site";
import { livePerson, liveTrip, notRehearsal } from "./trips-live";

/**
 * **Past divers worth inviting to a departure** (fifth-loop ideas, item 44;
 * H-20261014-one-to-one-invite): people who dived this departure's site with the shop before.
 *
 * The sameness is the one similar departures already apply to a site
 * (`src/lib/similar-departures.ts`); a course is not suggested here, since a
 * diver who took the course has no reason to take it again (the course ladder
 * on the Courses page is that list, item 45). Left out: anyone holding a seat
 * on this departure, anyone already invited to it, anyone contacted with an
 * invite inside the cooldown (`INVITE_COOLDOWN_DAYS`), anyone erased, deleted
 * or merged, anyone with no email, and anyone who turned off courtesy email.
 * Rehearsal departures count for nothing.
 *
 * "Dived" means a diver's seat (`participant_type = 'diver'`) on a departure
 * that was not an intro session such as Discover Scuba: a snorkeler, a rider
 * or a try-dive participant did not dive the site. And everyone listed passes
 * the departure's own admission gate (`tripAdmissionFor`): a diver whose card
 * is below the boat's level, or who lacks a specialty it demands, is left out
 * rather than invited to a boat that would refuse them (dive-domain review F1),
 * and so is anyone whose release waits on a physician's referral (second pass,
 * X3; the ladder's own predicate, {@link physicianReferrals}).
 * A course session lists nobody: its site's past divers are certified divers,
 * the least likely to want the course (review F2; the course ladder is that
 * list).
 */
export type InviteSuggestion = { personId: string; fullName: string; lastDivedAt: Date };

export type InviteSuggestions = {
  siteName: string;
  shown: InviteSuggestion[];
  /** Everyone who qualifies, `shown` included. */
  total: number;
};

/**
 * An invite counts from the moment it is recorded, not only once it is sent:
 * the locked check in {@link createInvitationUnderCooldown} must see the row a
 * moment-earlier invite just wrote, before its mail has gone (security N2).
 */
function invitedSince(since: Date) {
  return and(
    eq(interests.scope, "departure"),
    // The shop's own outreach: a diver who asked and was offered a seat was
    // not "invited" in the sense the cooldown spaces out.
    eq(interests.askedBy, "shop"),
    or(
      gte(interests.askedAt, since),
      gte(interests.offeredAt, since),
      gte(interests.emailedAt, since),
    ),
  );
}

/** People contacted with an invite (any departure) since the cooldown began. */
export async function recentlyInvitedPeople(
  db: DbExecutor,
  shopId: string,
  now: Date,
): Promise<Set<string>> {
  const since = inviteCooldownStart(now);
  const rows = await db
    .selectDistinct({ personId: interests.personId })
    .from(interests)
    .where(and(eq(interests.shopId, shopId), isNotNull(interests.personId), invitedSince(since)));
  return new Set(rows.flatMap((row) => (row.personId ? [row.personId] : [])));
}

/** Latest recent shop invitation for each person shown in the manual picker. */
export async function recentInviteDates(
  db: DbExecutor,
  shopId: string,
  personIds: readonly string[],
  now: Date,
): Promise<Map<string, Date>> {
  if (personIds.length === 0) return new Map();
  const latest =
    sql<Date>`max(greatest(${interests.askedAt}, ${interests.offeredAt}, ${interests.emailedAt}))`.mapWith(
      interests.askedAt,
    );
  const rows = await db
    .select({ personId: interests.personId, invitedAt: latest })
    .from(interests)
    .where(
      and(
        eq(interests.shopId, shopId),
        inArray(interests.personId, [...personIds]),
        invitedSince(inviteCooldownStart(now)),
      ),
    )
    .groupBy(interests.personId);
  return new Map(
    rows.flatMap((row) => (row.personId ? [[row.personId, row.invitedAt] as const] : [])),
  );
}

/** Whether `personId` was contacted with an invite since the cooldown began. */
export async function invitedWithinCooldown(
  db: DbExecutor,
  shopId: string,
  personId: string,
  now: Date,
): Promise<boolean> {
  const since = inviteCooldownStart(now);
  const [row] = await db
    .select({ id: interests.id })
    .from(interests)
    .where(and(eq(interests.shopId, shopId), eq(interests.personId, personId), invitedSince(since)))
    .limit(1);
  return Boolean(row);
}

/**
 * Past divers of `diveSiteId` who could be asked, most recent first, with the
 * people `exclude` names left out. The shared core of the departure's
 * suggestions and the quiet day's rows.
 */
export async function pastDiversOfSite(
  db: DbExecutor,
  input: { shopId: string; diveSiteId: string; now: Date; exclude: Iterable<string> },
): Promise<InviteSuggestion[]> {
  const sailedBefore = new Date(input.now.getTime() - DEPARTURE_BUFFER_MS);
  const rows = await db
    .select({
      personId: people.id,
      fullName: people.fullName,
      lastDivedAt: max(trips.startsAt),
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .leftJoin(courses, and(eq(courses.id, trips.courseId), eq(courses.shopId, input.shopId)))
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(personRoles, and(eq(personRoles.personId, people.id), eq(personRoles.role, "diver")))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(trips.shopId, input.shopId),
        // A diver's seat, on anything but an intro session (review F1).
        eq(bookings.participantType, "diver"),
        or(isNull(trips.courseId), eq(courses.isIntroCourse, false)),
        tripVisitsSite(input.diveSiteId),
        lt(trips.startsAt, sailedBefore),
        liveTrip(),
        notRehearsal(),
        notInArray(bookings.status, ["cancelled", "no_show"]),
        eq(people.shopId, input.shopId),
        livePerson(),
        isNull(people.anonymizedAt),
        isNull(people.mergedIntoPersonId),
        isNull(people.courtesyEmailOptOutAt),
        isNotNull(people.email),
        ne(people.email, ""),
      ),
    )
    .groupBy(people.id, people.fullName)
    .orderBy(desc(max(trips.startsAt)), people.fullName);
  const excluded = new Set(input.exclude);
  return rows.flatMap((row) =>
    row.lastDivedAt && !excluded.has(row.personId)
      ? [{ personId: row.personId, fullName: row.fullName, lastDivedAt: row.lastDivedAt }]
      : [],
  );
}

/** The suggestions for one departure, or `null` when it has no site or no one qualifies. */
export async function listInviteSuggestions(
  db: DbExecutor,
  input: { shopId: string; tripId: string; now: Date },
): Promise<InviteSuggestions | null> {
  // One wave for everything that needs only the departure's id: the trip page
  // waits on this list (staff render-cost tripwire), so the departure row, who
  // is already aboard or asked, and the boat's gate all go out together.
  const [[trip], aboard, invitedHere, recent, requirement, siteRequirement] = await queryAll(db, [
    () =>
      db
        .select({
          id: trips.id,
          startsAt: trips.startsAt,
          diveSiteId: tripPrimarySiteId,
          courseId: trips.courseId,
          siteName: diveSites.name,
        })
        .from(trips)
        .innerJoin(diveSites, eq(diveSites.id, tripPrimarySiteId))
        .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
        .limit(1),
    () =>
      db
        .select({ personId: bookings.personId })
        .from(bookings)
        .where(
          and(
            eq(bookings.shopId, input.shopId),
            eq(bookings.tripId, input.tripId),
            ne(bookings.status, "cancelled"),
          ),
        ),
    () =>
      db
        .select({ personId: interests.personId })
        .from(interests)
        .where(
          and(
            eq(interests.scope, "departure"),
            eq(interests.shopId, input.shopId),
            eq(interests.tripId, input.tripId),
          ),
        ),
    () => recentlyInvitedPeople(db, input.shopId, input.now),
    () => getTripRequirements(db, input.shopId, input.tripId),
    () => getTripSiteRequirement(db, input.shopId, input.tripId),
  ]);
  // A course session suggests nobody from its site (review F2).
  if (!trip?.diveSiteId || trip.courseId) return null;
  const exclude = new Set<string>(recent);
  for (const row of [...aboard, ...invitedHere]) if (row.personId) exclude.add(row.personId);

  const pastDivers = await pastDiversOfSite(db, {
    shopId: input.shopId,
    diveSiteId: trip.diveSiteId,
    now: input.now,
    exclude,
  });
  const everyone = await admittedUnderGate(db, input.shopId, trip, pastDivers, {
    requirement,
    siteRequirement,
  });
  if (everyone.length === 0) return null;
  return {
    siteName: trip.siteName,
    shown: everyone.slice(0, INVITE_SUGGESTIONS_SHOWN),
    total: everyone.length,
  };
}

/**
 * The people of `candidates` the departure's admission gate would sell a seat
 * to (`tripAdmissionFor`, the booking's own gate), in order, less anyone
 * awaiting a physician's referral (X3). A departure that demands no card
 * admits every diver, so the per-person card reads are skipped.
 */
export async function admittedToTrip<T extends { personId: string }>(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  candidates: readonly T[],
): Promise<T[]> {
  if (candidates.length === 0) return [];
  const [[trip], requirement, siteRequirement] = await queryAll(db, [
    () =>
      db
        .select({ id: trips.id, startsAt: trips.startsAt })
        .from(trips)
        .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
        .limit(1),
    () => getTripRequirements(db, shopId, tripId),
    () => getTripSiteRequirement(db, shopId, tripId),
  ]);
  if (!trip) return [];
  return admittedUnderGate(db, shopId, trip, candidates, { requirement, siteRequirement });
}

/**
 * People whose release is parked on a physician's referral that nobody has
 * cleared: a live `medical_review` release with no `medical_cleared_at`. The
 * one predicate both invite paths share (dive-domain second pass, X3): the
 * course ladder flags them for a call instead of an Invite, the site's past
 * divers leave them out, and the send under the cooldown lock refuses them.
 * Readiness blocks them at the dock either way; this keeps the shop from
 * inviting someone a doctor has not yet cleared to dive.
 */
export async function physicianReferrals(
  db: DbExecutor,
  shopId: string,
  personIds: string[],
): Promise<Set<string>> {
  if (personIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ personId: waiverRecords.personId })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        inArray(waiverRecords.personId, personIds),
        eq(waiverRecords.status, "medical_review"),
        isNull(waiverRecords.medicalClearedAt),
        isNull(waiverRecords.supersededAt),
      ),
    );
  return new Set(rows.map((row) => row.personId));
}

/**
 * {@link admittedToTrip} with the departure's gate already in hand. The same
 * evidence `tripAdmissionFor` reads for one diver (their live cards and the
 * levels their booked courses certify before this departure), read once for
 * every candidate rather than one diver after another. Anyone whose release
 * waits on a physician's referral ({@link physicianReferrals}) is left out
 * too: the booking gate would sell them a seat (readiness stops them at the
 * dock), but an invite from the shop must not reach them (dive-domain second
 * pass, X3).
 */
async function admittedUnderGate<T extends { personId: string }>(
  db: DbExecutor,
  shopId: string,
  trip: { id: string; startsAt: Date },
  candidates: readonly T[],
  gate: {
    requirement: Awaited<ReturnType<typeof getTripRequirements>>;
    siteRequirement: Awaited<ReturnType<typeof getTripSiteRequirement>>;
  },
): Promise<T[]> {
  if (candidates.length === 0) return [];
  const { requirement, siteRequirement } = gate;
  const demandsSomething = !requirementDemandsNothing(
    unionRequirements(requirement, siteRequirement),
  );
  const personIds = candidates.map((candidate) => candidate.personId);
  // The referral read goes out with the cards, in the same wave: a boat that
  // demands no card still never invites someone awaiting a doctor (X3).
  const [referred, evidenceByPerson, seatsInTraining] = await queryAll(db, [
    () => physicianReferrals(db, shopId, personIds),
    () =>
      demandsSomething
        ? readCertificationEvidenceFor(db, shopId, personIds)
        : Promise.resolve(undefined),
    () =>
      demandsSomething ? listCourseSeatsInTraining(db, shopId, personIds) : Promise.resolve([]),
  ]);
  const open = candidates.filter((candidate) => !referred.has(candidate.personId));
  if (!evidenceByPerson) return open;
  const now = nowDate();
  return open.filter((candidate) => {
    const cards = evidenceByPerson.get(candidate.personId) ?? NO_CARDS;
    const seats = seatsInTraining.filter((seat) => seat.personId === candidate.personId);
    const evidence: TripAdmissionEvidence = {
      ...cards,
      levelsInTraining: inTrainingBefore(seats, trip, now).map((course) => course.level),
    };
    return decideTripAdmission({
      requirement,
      siteRequirement,
      evidence,
      identityUnconfirmed: false,
      declared: undefined,
    }).admitted;
  });
}

const NO_CARDS: TripAdmissionEvidence = {
  certifications: [],
  specialtyCertifications: [],
  nitroxCertifications: [],
};

export type CooledInvitation =
  | { status: "created"; interestId: string }
  | { status: "cooldown" | "unavailable" | "refused" };

/**
 * **One invite under the 30-day cooldown** (H-20261014-one-to-one-invite; the suggestions and the
 * course ladder, never the manual invite). The cooldown check and the insert
 * run in one transaction under an advisory lock on (shop, person), so two
 * near-simultaneous invites to two departures cannot both pass the check
 * (security review N2). Inside the same lock the departure is re-checked
 * for this diver (`departureOpenToDiver`: public, scheduled, a seat left,
 * the admission gate and, on a course session, the course's own), so a page
 * left open cannot invite someone the boat would now refuse (review F1, N3).
 */
export async function createInvitationUnderCooldown(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    personId: string;
    createdByPersonId: string;
    now: Date;
  },
): Promise<CooledInvitation> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('invite_cooldown'), hashtext(${`${input.shopId}:${input.personId}`}))`,
    );
    if (await invitedWithinCooldown(tx, input.shopId, input.personId, input.now)) {
      return { status: "cooldown" };
    }
    if (!(await departureOpenToDiver(tx, { ...input }))) return { status: "unavailable" };
    // A release parked on a physician's referral since the page was drawn (X3).
    if ((await physicianReferrals(tx, input.shopId, [input.personId])).size > 0) {
      return { status: "unavailable" };
    }
    const interest = await ensureDepartureInterest(tx, input);
    return interest
      ? { status: "created", interestId: interest.interestId }
      : { status: "refused" };
  });
}
