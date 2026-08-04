import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { type AppDb, type DbExecutor, isUniqueConstraintViolation } from "./client";
import { publishManifestEvent } from "./manifest-events";
import {
  bookings,
  buddyPairMembers,
  buddyTeamEvents,
  people,
  personRoles,
  tripAssignments,
  trips,
} from "./schema";

/**
 * Buddy teams on a departure (ADR 20260804-buddy-teams). Staff group the
 * roster the way it will dive, so roll call can read "at least one member is
 * back aboard and at least one is not" as a first-class state instead of a
 * flat list.
 *
 * A team has **two or more members**, and a member is either a seated diver (a
 * booking) or a crew person — the divemaster leading the group holds no
 * booking, and before this model a diver deliberately placed with a DM printed
 * on the incident export identically to a diver nobody paired.
 *
 * The writes stay deliberately boring:
 *
 * - one writer per act, each inserting every row it needs in one transaction;
 * - the unique index on `booking_id` is the authority that a **diver** is in at
 *   most one team per departure (it holds under concurrency, where a pre-check
 *   alone would not) — crew carry no such constraint, because one DM commonly
 *   leads several groups on one boat;
 * - membership changes are explicit acts, never silent re-writes: adding an
 *   already-teamed diver is refused, and staff dissolve before re-forming;
 * - every act appends to `buddy_team_events`, whose whole job is to outlive the
 *   membership rows a dissolve deletes.
 *
 * This module is named after its table (`buddy_pair_members`), which keeps its
 * applied name; every word a human reads says "team".
 */

/** A member as a caller names one: a seated diver, or a crew person. */
export type BuddyTeamMemberInput =
  | { kind: "diver"; bookingId: string }
  | { kind: "crew"; personId: string };

/** Every way a team write can be refused. Codes, never sentences. */
export type BuddyTeamRefusal =
  | "staff_not_found"
  | "trip_unavailable"
  | "booking_unavailable"
  | "crew_unavailable"
  | "duplicate_member"
  | "too_few_members"
  | "already_teamed"
  | "team_not_found"
  | "not_a_member";

export type FormBuddyTeamOutcome =
  | { ok: true; teamId: string }
  | { ok: false; reason: BuddyTeamRefusal };

export type BuddyTeamMutationOutcome = { ok: true } | { ok: false; reason: BuddyTeamRefusal };

type Tx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

/** A member resolved against the roster, with the name the trail records. */
type ResolvedMember = BuddyTeamMemberInput & { fullName: string };

/**
 * The smallest team the model allows. A team of one is refused — a team needs
 * someone to be a team with — and no surface ever offers one.
 */
export const MIN_BUDDY_TEAM_SIZE = 2;

/** Stable display order inside a team, and the order the trail records names in. */
function sortMembers<T extends { fullName: string }>(members: T[], key: (m: T) => string): T[] {
  return [...members].sort((a, b) =>
    a.fullName === b.fullName ? key(a).localeCompare(key(b)) : a.fullName.localeCompare(b.fullName),
  );
}

function memberKey(member: BuddyTeamMemberInput): string {
  return member.kind === "diver" ? `booking:${member.bookingId}` : `crew:${member.personId}`;
}

/**
 * The staff gate every roll-call write applies: a pairing is a named staff
 * member's call, and the recorder must be staff in *this* shop.
 */
async function requireStaff(tx: Tx, shopId: string, personId: string): Promise<string | null> {
  const [staff] = await tx
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.id, personId),
        eq(people.shopId, shopId),
        inArray(personRoles.role, [...STAFF_ROLES]),
      ),
    )
    .limit(1);
  return staff?.id ?? null;
}

/** Same tenancy and trip-status gate `recordRollCall` applies. */
async function requireScheduledTrip(tx: Tx, shopId: string, tripId: string): Promise<boolean> {
  const [trip] = await tx
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), eq(trips.status, "scheduled")))
    .limit(1);
  return Boolean(trip);
}

/**
 * Prove every named member is actually on this boat, and read the name the
 * trail will record.
 *
 * Divers go through the identical `ne(status, "cancelled")` rule `getTripRoster`
 * reads the manifest through, so exactly the divers a manifest shows are the
 * divers a team can name. Crew go through the identical assignment gate
 * `recordCrewRollCall` applies, so the two halves of the crew story can never
 * answer differently about who is aboard.
 */
async function resolveMembers(
  tx: Tx,
  shopId: string,
  tripId: string,
  members: readonly BuddyTeamMemberInput[],
): Promise<{ ok: true; members: ResolvedMember[] } | { ok: false; reason: BuddyTeamRefusal }> {
  const bookingIds = members.flatMap((m) => (m.kind === "diver" ? [m.bookingId] : []));
  const crewIds = members.flatMap((m) => (m.kind === "crew" ? [m.personId] : []));

  const seatRows =
    bookingIds.length > 0
      ? await tx
          .select({ id: bookings.id, fullName: people.fullName })
          .from(bookings)
          .innerJoin(people, eq(people.id, bookings.personId))
          .where(
            and(
              inArray(bookings.id, bookingIds),
              eq(bookings.shopId, shopId),
              eq(bookings.tripId, tripId),
              ne(bookings.status, "cancelled"),
            ),
          )
      : [];
  const seatNames = new Map(seatRows.map((row) => [row.id, row.fullName]));
  if (seatNames.size !== bookingIds.length) return { ok: false, reason: "booking_unavailable" };

  const crewRows =
    crewIds.length > 0
      ? await tx
          .select({ id: people.id, fullName: people.fullName })
          .from(tripAssignments)
          .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
          .innerJoin(people, eq(people.id, tripAssignments.personId))
          .where(
            and(
              inArray(tripAssignments.personId, crewIds),
              eq(tripAssignments.tripId, tripId),
              eq(trips.shopId, shopId),
              eq(people.shopId, shopId),
            ),
          )
      : [];
  const crewNames = new Map(crewRows.map((row) => [row.id, row.fullName]));
  if (crewNames.size !== crewIds.length) return { ok: false, reason: "crew_unavailable" };

  return {
    ok: true,
    members: members.map((member) =>
      member.kind === "diver"
        ? { ...member, fullName: seatNames.get(member.bookingId) as string }
        : { ...member, fullName: crewNames.get(member.personId) as string },
    ),
  };
}

/**
 * The team's current membership, with names — read inside the same transaction
 * as the act it is about, so the trail records what actually stood.
 *
 * Crew names resolve directly; a diver's name comes through their booking, and
 * a **cancelled** seat is still read here. The membership row outlives a
 * cancellation (the manifest drops it, the panel keeps it dissolvable), so the
 * trail must be able to name that person too.
 */
async function readTeamMembers(
  tx: Tx,
  shopId: string,
  tripId: string,
  teamId: string,
): Promise<ResolvedMember[]> {
  const crewPeople = alias(people, "crew_people");
  const rows = await tx
    .select({
      bookingId: buddyPairMembers.bookingId,
      crewPersonId: buddyPairMembers.crewPersonId,
      diverName: people.fullName,
      crewName: crewPeople.fullName,
    })
    .from(buddyPairMembers)
    .leftJoin(bookings, eq(bookings.id, buddyPairMembers.bookingId))
    .leftJoin(people, eq(people.id, bookings.personId))
    .leftJoin(crewPeople, eq(crewPeople.id, buddyPairMembers.crewPersonId))
    .where(
      and(
        eq(buddyPairMembers.pairId, teamId),
        eq(buddyPairMembers.shopId, shopId),
        eq(buddyPairMembers.tripId, tripId),
      ),
    );
  const members: ResolvedMember[] = rows.map((row) =>
    row.bookingId
      ? { kind: "diver", bookingId: row.bookingId, fullName: row.diverName ?? "" }
      : { kind: "crew", personId: row.crewPersonId as string, fullName: row.crewName ?? "" },
  );
  return sortMembers(members, memberKey);
}

/**
 * Append one act to the trail. Names are denormalised on purpose: the trail's
 * whole job is to outlive the membership rows, which a dissolve deletes, so it
 * cannot resolve them by id afterwards.
 *
 * `memberNames` is the team's membership **as it stood at that moment**, taking
 * the fuller side of the change — after a formation or an addition, before a
 * removal or a dissolution — so no name a team ever held is lost from the trail
 * and consecutive entries diff to who joined or left.
 */
async function recordTeamEvent(
  tx: Tx,
  input: {
    shopId: string;
    tripId: string;
    teamId: string;
    action: "formed" | "dissolved" | "member_added" | "member_removed";
    members: readonly ResolvedMember[];
    recordedByPersonId: string;
    occurredAt: Date;
  },
): Promise<void> {
  await tx.insert(buddyTeamEvents).values({
    shopId: input.shopId,
    tripId: input.tripId,
    pairId: input.teamId,
    action: input.action,
    memberNames: input.members.map((member) => member.fullName),
    recordedByPersonId: input.recordedByPersonId,
    occurredAt: input.occurredAt,
  });
}

/**
 * Form a buddy team from two or more members.
 *
 * Every refusal is checked before anything is written, and the unique index on
 * `booking_id` backs the "a diver is in at most one team" rule against a
 * concurrent write that beats the pre-check.
 */
export async function formBuddyTeam(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    members: readonly BuddyTeamMemberInput[];
    recordedByPersonId: string;
    now?: Date;
  },
): Promise<FormBuddyTeamOutcome> {
  let outcome: FormBuddyTeamOutcome;
  try {
    outcome = await db.transaction((tx) => formBuddyTeamInTx(tx, input));
  } catch (error) {
    // The pre-check races a concurrent write; the unique index is the
    // authority, and losing to it is the same refusal.
    if (isUniqueConstraintViolation(error)) return { ok: false, reason: "already_teamed" };
    throw error;
  }
  // Teams render on the manifest, so a change here is exactly what the push
  // signal exists for (ADR 20260726-manifest-push-refresh).
  if (outcome.ok) await publishManifestEvent(db, input.shopId, input.tripId);
  return outcome;
}

async function formBuddyTeamInTx(
  tx: Tx,
  input: {
    shopId: string;
    tripId: string;
    members: readonly BuddyTeamMemberInput[];
    recordedByPersonId: string;
    now?: Date;
  },
): Promise<FormBuddyTeamOutcome> {
  // Nobody is their own buddy, and nobody is on a team twice. Checked before
  // anything touches the database so the refusal cannot depend on what else is
  // true of the rows.
  const keys = new Set(input.members.map(memberKey));
  if (keys.size !== input.members.length) return { ok: false, reason: "duplicate_member" };
  // A team of one is not a team. Nothing above two is refused, and a team of
  // crew alone is allowed on purpose: two divemasters buddying each other is
  // an ordinary boat, and crew carry per-person roll call, so the split-team
  // read works on them exactly as it does on divers.
  if (input.members.length < MIN_BUDDY_TEAM_SIZE) return { ok: false, reason: "too_few_members" };

  const staffId = await requireStaff(tx, input.shopId, input.recordedByPersonId);
  if (!staffId) return { ok: false, reason: "staff_not_found" };
  if (!(await requireScheduledTrip(tx, input.shopId, input.tripId))) {
    return { ok: false, reason: "trip_unavailable" };
  }

  const resolved = await resolveMembers(tx, input.shopId, input.tripId, input.members);
  if (!resolved.ok) return resolved;

  // Already on a team is a refusal, never a silent re-team: staff dissolve
  // first, so forming is only ever an explicit act about currently-unteamed
  // divers. Crew are deliberately exempt — one DM leads several groups.
  const bookingIds = input.members.flatMap((m) => (m.kind === "diver" ? [m.bookingId] : []));
  if (bookingIds.length > 0) {
    const existing = await tx
      .select({ bookingId: buddyPairMembers.bookingId })
      .from(buddyPairMembers)
      .where(inArray(buddyPairMembers.bookingId, bookingIds))
      .limit(1);
    if (existing.length > 0) return { ok: false, reason: "already_teamed" };
  }

  const teamId = crypto.randomUUID();
  const occurredAt = input.now ?? nowDate();
  await tx.insert(buddyPairMembers).values(
    resolved.members.map((member) => ({
      shopId: input.shopId,
      tripId: input.tripId,
      pairId: teamId,
      bookingId: member.kind === "diver" ? member.bookingId : null,
      crewPersonId: member.kind === "crew" ? member.personId : null,
      pairedByPersonId: staffId,
      createdAt: occurredAt,
    })),
  );
  await recordTeamEvent(tx, {
    shopId: input.shopId,
    tripId: input.tripId,
    teamId,
    action: "formed",
    members: sortMembers(resolved.members, memberKey),
    recordedByPersonId: staffId,
    occurredAt,
  });
  return { ok: true, teamId };
}

/** Add one member to a team that already stands. */
export async function addBuddyTeamMember(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    teamId: string;
    member: BuddyTeamMemberInput;
    recordedByPersonId: string;
    now?: Date;
  },
): Promise<BuddyTeamMutationOutcome> {
  let outcome: BuddyTeamMutationOutcome;
  try {
    outcome = await db.transaction(async (tx): Promise<BuddyTeamMutationOutcome> => {
      const staffId = await requireStaff(tx, input.shopId, input.recordedByPersonId);
      if (!staffId) return { ok: false, reason: "staff_not_found" };
      if (!(await requireScheduledTrip(tx, input.shopId, input.tripId))) {
        return { ok: false, reason: "trip_unavailable" };
      }
      const standing = await readTeamMembers(tx, input.shopId, input.tripId, input.teamId);
      if (standing.length === 0) return { ok: false, reason: "team_not_found" };
      if (standing.some((member) => memberKey(member) === memberKey(input.member))) {
        return { ok: false, reason: "duplicate_member" };
      }
      const resolved = await resolveMembers(tx, input.shopId, input.tripId, [input.member]);
      if (!resolved.ok) return resolved;
      const [member] = resolved.members;
      if (!member) return { ok: false, reason: "booking_unavailable" };
      if (member.kind === "diver") {
        const existing = await tx
          .select({ bookingId: buddyPairMembers.bookingId })
          .from(buddyPairMembers)
          .where(eq(buddyPairMembers.bookingId, member.bookingId))
          .limit(1);
        if (existing.length > 0) return { ok: false, reason: "already_teamed" };
      }
      const occurredAt = input.now ?? nowDate();
      await tx.insert(buddyPairMembers).values({
        shopId: input.shopId,
        tripId: input.tripId,
        pairId: input.teamId,
        bookingId: member.kind === "diver" ? member.bookingId : null,
        crewPersonId: member.kind === "crew" ? member.personId : null,
        pairedByPersonId: staffId,
        createdAt: occurredAt,
      });
      await recordTeamEvent(tx, {
        shopId: input.shopId,
        tripId: input.tripId,
        teamId: input.teamId,
        action: "member_added",
        members: sortMembers([...standing, member], memberKey),
        recordedByPersonId: staffId,
        occurredAt,
      });
      return { ok: true };
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return { ok: false, reason: "already_teamed" };
    throw error;
  }
  if (outcome.ok) await publishManifestEvent(db, input.shopId, input.tripId);
  return outcome;
}

/**
 * Remove one member from a team that keeps standing afterwards.
 *
 * A removal that would leave fewer than two members is refused rather than
 * quietly dissolving the team: dissolving is its own act with its own trail
 * entry, and a surface that means to dissolve must say so.
 */
export async function removeBuddyTeamMember(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    teamId: string;
    member: BuddyTeamMemberInput;
    recordedByPersonId: string;
    now?: Date;
  },
): Promise<BuddyTeamMutationOutcome> {
  // No trip-status gate, like `dissolveBuddyTeam` and unlike the two writers
  // that *add* membership: a team recorded on a departure that has since been
  // cancelled must still be correctable, or its members could never be
  // regrouped. Tenancy still holds — every read and the delete below carry
  // `shopId` and `tripId`.
  const outcome = await db.transaction(async (tx): Promise<BuddyTeamMutationOutcome> => {
    const staffId = await requireStaff(tx, input.shopId, input.recordedByPersonId);
    if (!staffId) return { ok: false, reason: "staff_not_found" };
    const standing = await readTeamMembers(tx, input.shopId, input.tripId, input.teamId);
    if (standing.length === 0) return { ok: false, reason: "team_not_found" };
    if (!standing.some((member) => memberKey(member) === memberKey(input.member))) {
      return { ok: false, reason: "not_a_member" };
    }
    if (standing.length - 1 < MIN_BUDDY_TEAM_SIZE) return { ok: false, reason: "too_few_members" };
    const occurredAt = input.now ?? nowDate();
    await tx
      .delete(buddyPairMembers)
      .where(
        and(
          eq(buddyPairMembers.pairId, input.teamId),
          eq(buddyPairMembers.shopId, input.shopId),
          eq(buddyPairMembers.tripId, input.tripId),
          input.member.kind === "diver"
            ? eq(buddyPairMembers.bookingId, input.member.bookingId)
            : eq(buddyPairMembers.crewPersonId, input.member.personId),
        ),
      );
    // The fuller side of the change: the membership *before* the removal, so
    // the person who left is never lost from the trail.
    await recordTeamEvent(tx, {
      shopId: input.shopId,
      tripId: input.tripId,
      teamId: input.teamId,
      action: "member_removed",
      members: standing,
      recordedByPersonId: staffId,
      occurredAt,
    });
    return { ok: true };
  });
  if (outcome.ok) await publishManifestEvent(db, input.shopId, input.tripId);
  return outcome;
}

/**
 * Dissolve a team — every member row goes together, so a half-team can never
 * linger. Scoped by shop and trip, so a bare uuid from another tenant dissolves
 * nothing. Works whatever the members' booking statuses are: a team whose seat
 * has since been cancelled must still be dissolvable, or the survivors could
 * never be re-teamed.
 *
 * The membership rows go; the trail entry stays. That is the whole point.
 */
export async function dissolveBuddyTeam(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    teamId: string;
    recordedByPersonId: string;
    now?: Date;
  },
): Promise<BuddyTeamMutationOutcome> {
  const outcome = await db.transaction(async (tx): Promise<BuddyTeamMutationOutcome> => {
    const staffId = await requireStaff(tx, input.shopId, input.recordedByPersonId);
    if (!staffId) return { ok: false, reason: "staff_not_found" };
    const standing = await readTeamMembers(tx, input.shopId, input.tripId, input.teamId);
    if (standing.length === 0) return { ok: false, reason: "team_not_found" };
    await tx
      .delete(buddyPairMembers)
      .where(
        and(
          eq(buddyPairMembers.pairId, input.teamId),
          eq(buddyPairMembers.shopId, input.shopId),
          eq(buddyPairMembers.tripId, input.tripId),
        ),
      );
    await recordTeamEvent(tx, {
      shopId: input.shopId,
      tripId: input.tripId,
      teamId: input.teamId,
      action: "dissolved",
      members: standing,
      recordedByPersonId: staffId,
      occurredAt: input.now ?? nowDate(),
    });
    return { ok: true };
  });
  if (outcome.ok) await publishManifestEvent(db, input.shopId, input.tripId);
  return outcome;
}

/** One member of a team as every reader carries it. */
export type TripBuddyTeamMember =
  | {
      kind: "diver";
      bookingId: string;
      fullName: string;
      /** The seat has since been cancelled; the team shows it and can be dissolved. */
      cancelled: boolean;
    }
  | { kind: "crew"; personId: string; fullName: string };

export type TripBuddyTeam = {
  teamId: string;
  createdAt: Date;
  recordedByName: string;
  members: TripBuddyTeamMember[];
};

/**
 * Every team on one trip, cancelled diver members included and marked. The
 * teams panel lists these so a team whose seat was cancelled stays visible and
 * dissolvable rather than becoming an invisible row that still refuses a
 * re-team; the manifest derivation keeps only the members who are actually
 * aboard (see `getTripManifests`).
 */
export async function listTripBuddyTeams(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<TripBuddyTeam[]> {
  // `people` appears three times — the seated diver, the crew member, and the
  // staff member who made the call — so two of the reads need their own alias.
  const crewPeople = alias(people, "crew_people");
  const recordedBy = alias(people, "recorded_by_people");
  const rows = await db
    .select({
      teamId: buddyPairMembers.pairId,
      createdAt: buddyPairMembers.createdAt,
      bookingId: buddyPairMembers.bookingId,
      bookingStatus: bookings.status,
      diverName: people.fullName,
      crewPersonId: buddyPairMembers.crewPersonId,
      crewName: crewPeople.fullName,
      recordedByName: recordedBy.fullName,
    })
    .from(buddyPairMembers)
    .leftJoin(bookings, eq(bookings.id, buddyPairMembers.bookingId))
    .leftJoin(people, eq(people.id, bookings.personId))
    .leftJoin(crewPeople, eq(crewPeople.id, buddyPairMembers.crewPersonId))
    .innerJoin(recordedBy, eq(recordedBy.id, buddyPairMembers.pairedByPersonId))
    .where(and(eq(buddyPairMembers.shopId, shopId), eq(buddyPairMembers.tripId, tripId)))
    .orderBy(asc(buddyPairMembers.createdAt), asc(buddyPairMembers.pairId));
  const byTeam = new Map<string, TripBuddyTeam>();
  for (const row of rows) {
    const team = byTeam.get(row.teamId) ?? {
      teamId: row.teamId,
      createdAt: row.createdAt,
      recordedByName: row.recordedByName,
      members: [],
    };
    if (row.bookingId) {
      team.members.push({
        kind: "diver",
        bookingId: row.bookingId,
        fullName: row.diverName ?? "",
        cancelled: row.bookingStatus === "cancelled",
      });
    } else if (row.crewPersonId) {
      team.members.push({
        kind: "crew",
        personId: row.crewPersonId,
        fullName: row.crewName ?? "",
      });
    }
    byTeam.set(row.teamId, team);
  }
  // Stable member order inside a team, whatever order the rows came back in.
  for (const team of byTeam.values()) {
    team.members = sortMembers(team.members, (member) =>
      member.kind === "diver" ? `booking:${member.bookingId}` : `crew:${member.personId}`,
    );
  }
  return [...byTeam.values()];
}

/** One entry of the append-only pairing trail, oldest first. */
export type TripBuddyTeamEvent = {
  teamId: string;
  action: "formed" | "dissolved" | "member_added" | "member_removed";
  memberNames: string[];
  recordedByName: string;
  occurredAt: Date;
  createdAt: Date;
};

/**
 * The whole pairing trail for one departure — the history, not the standing
 * teams. Read by the incident export, which renders it in the roll-call
 * timeline it already has: this is what closed the gap that buddy was the only
 * fact on an authority-facing document with no audit trail.
 */
export async function listTripBuddyTeamEvents(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<TripBuddyTeamEvent[]> {
  const rows = await db
    .select({
      teamId: buddyTeamEvents.pairId,
      action: buddyTeamEvents.action,
      memberNames: buddyTeamEvents.memberNames,
      recordedByName: people.fullName,
      occurredAt: buddyTeamEvents.occurredAt,
      createdAt: buddyTeamEvents.createdAt,
    })
    .from(buddyTeamEvents)
    .innerJoin(people, eq(people.id, buddyTeamEvents.recordedByPersonId))
    .where(and(eq(buddyTeamEvents.shopId, shopId), eq(buddyTeamEvents.tripId, tripId)))
    .orderBy(asc(buddyTeamEvents.occurredAt), asc(buddyTeamEvents.createdAt));
  return rows.map((row) => ({ ...row, memberNames: row.memberNames ?? [] }));
}
