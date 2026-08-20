import { and, asc, eq, gt, inArray, lt, ne, or, sql } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import { countInWaterCrew, type TripCrewRole } from "@/lib/crew-roles";
import { reviewManifestChange } from "@/lib/manifest-change-review";
import type { AppDb, DbExecutor } from "./client";
import { publishManifestEvent } from "./manifest-events";
import {
  people,
  personRoles,
  rollCallCrewEvents,
  tripAssignments,
  tripScheduleDays,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";

/**
 * Who is working a departure.
 *
 * Two write doors with the same guards: `setTripCrew` replaces the whole crew,
 * `changeTripCrew` applies one assignment change without disturbing concurrent
 * edits. Both prove the trip belongs to the shop inside the transaction —
 * `trip_assignments` carries no `shop_id` of its own (CR-007) — both refuse to
 * drop anybody carrying per-person roll-call history (ADR
 * 20260803-per-person-crew-roll-call), both require a course session to keep an
 * instructor, and both read who is doing what through `countInWaterCrew`
 * (`src/lib/crew-roles.ts`) rather than re-deriving it from `person_roles`.
 *
 * Neither refuses an over-ratio crew: the manifest is a safety document and
 * must say who is actually aboard. The gap surfaces as `over_ratio`, and new
 * bookings are still refused at the tightened cap in `createBookingRecord`.
 */

/** All people holding at least one staff role in the shop, with their roles. */
export async function listStaff(db: AppDb, shopId: string) {
  const rows = await db
    .select({ person: people, role: personRoles.role })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), inArray(personRoles.role, [...STAFF_ROLES])))
    .orderBy(asc(people.fullName));
  const byId = new Map<string, { person: typeof people.$inferSelect; roles: string[] }>();
  for (const { person, role } of rows) {
    const entry = byId.get(person.id) ?? { person, roles: [] };
    entry.roles.push(role);
    byId.set(person.id, entry);
  }
  return [...byId.values()];
}

/**
 * `trip_assignments` has no `shop_id` of its own (CR-007) — every read here
 * proves membership by joining through the trip that owns it, the same
 * pattern `setTripCrew` uses for its write, rather than trusting a bare
 * trip UUID the caller might supply for any shop.
 */
export async function getTripCrewIds(db: AppDb, shopId: string, tripId: string): Promise<string[]> {
  const rows = await db
    .select({ personId: tripAssignments.personId })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .where(and(eq(tripAssignments.tripId, tripId), eq(trips.shopId, shopId), liveTrip()));
  return rows.map((r) => r.personId);
}

/**
 * A trip's crew with the job each is rostered to do on it (null = not
 * specified, ADR 20260803-per-trip-crew-role). Same tenancy proof as
 * `getTripCrewIds` — through `trips`, because `trip_assignments` carries no
 * `shop_id` of its own (CR-007).
 */
export async function getTripCrewAssignments(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<{ personId: string; tripRole: TripCrewRole | null }[]> {
  return db
    .select({ personId: tripAssignments.personId, tripRole: tripAssignments.tripRole })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .where(and(eq(tripAssignments.tripId, tripId), eq(trips.shopId, shopId), liveTrip()));
}

/**
 * One entry in a crew replacement. A bare id means "this person, leave their
 * per-trip role alone"; the object form sets it, and an explicit `null` clears
 * it back to unspecified.
 */
export type TripCrewMemberInput = string | { personId: string; tripRole?: TripCrewRole | null };

function crewInputPersonId(entry: TripCrewMemberInput): string {
  return typeof entry === "string" ? entry : entry.personId;
}

/**
 * Which of these people already have a **per-person crew roll-call result** on
 * this trip — somebody stood on the deck and said, by name, whether they were
 * aboard (ADR 20260803-per-person-crew-roll-call).
 *
 * That statement is safety history, and taking the person off the crew is what
 * makes it disappear: `listTripCrew` drops them, the assigned count falls, and
 * a checkpoint that was open *because a named crew member did not come back*
 * flips to complete with their event rows still sitting in the table, read by
 * nothing. One tap, and a stated "did not come back" is gone (review 20260803,
 * D3). Divers have had the analogous guard from the start.
 *
 * `cleared` rows count. A clear is an undo of a *result*, not of the fact that
 * this person was part of the count — the audit trail is the thing being
 * protected, and it is append-only.
 */
async function crewWithRollCallHistory(
  tx: DbExecutor,
  tripId: string,
  personIds: readonly string[],
): Promise<Set<string>> {
  if (personIds.length === 0) return new Set();
  const rows = await tx
    .selectDistinct({ personId: rollCallCrewEvents.personId })
    .from(rollCallCrewEvents)
    .where(
      and(
        eq(rollCallCrewEvents.tripId, tripId),
        inArray(rollCallCrewEvents.personId, [...personIds]),
      ),
    );
  return new Set(rows.map((row) => row.personId));
}

/**
 * Replace a trip's crew. Only people with a staff role in the shop stick.
 * Proves the trip itself belongs to the shop in the same transaction as the
 * write — `trip_assignments` carries no `shop_id` of its own to lean on, so
 * without this a tripId for any shop plus a validated personId list would
 * silently rewrite another shop's crew (CR-007). Returns false, doing
 * nothing, for a tripId that isn't this shop's.
 *
 * The write is still delete-all-then-insert, which is why per-trip roles are
 * **read back inside the transaction and carried forward** for anyone who
 * stays on the crew (ADR 20260803-per-trip-crew-role). Without that, every
 * full crew edit — a surface that has nothing to do with roles — would
 * silently blank "Ana is captain of this sailing" and hand her back to the
 * supervision ratio as an in-water assistant. A caller only overwrites a role
 * by passing one.
 */
export async function setTripCrew(
  db: AppDb,
  shopId: string,
  tripId: string,
  personIds: readonly TripCrewMemberInput[],
): Promise<boolean> {
  const staff = await listStaff(db, shopId);
  const requested = personIds.filter((entry) =>
    staff.some((s) => s.person.id === crewInputPersonId(entry)),
  );
  const valid = requested.map(crewInputPersonId);
  const changed = await db.transaction(async (tx) => {
    const [trip] = await tx
      .select({
        id: trips.id,
        startsAt: trips.startsAt,
        endsAt: trips.endsAt,
        courseId: trips.courseId,
      })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
      .limit(1)
      .for("update");
    if (!trip) return false;
    // The per-trip roles already on this trip, read before anything else needs
    // them: the course check below has to know which job each person would be
    // doing, and the delete-all-then-insert write further down has to carry
    // them forward for anyone who stays.
    const existingRoles = new Map(
      (
        await tx
          .select({ personId: tripAssignments.personId, tripRole: tripAssignments.tripRole })
          .from(tripAssignments)
          .where(eq(tripAssignments.tripId, tripId))
      ).map((row) => [row.personId, row.tripRole] as const),
    );
    const roleAfterChange = (entry: TripCrewMemberInput) => {
      const personId = crewInputPersonId(entry);
      const specified = typeof entry === "string" ? undefined : entry.tripRole;
      // `undefined` means the caller did not mention the role; an explicit
      // `null` clears it.
      return specified === undefined ? (existingRoles.get(personId) ?? null) : specified;
    };
    // Nobody with roll-call history on this trip can be dropped from it. The
    // divers' analogue has always been there (`deleteTrip` refuses
    // `already_sailed` when roll-call events exist); crew had none, so one
    // whole-crew edit that omitted a person who had been recorded as *not back
    // aboard* deleted their assignment, dropped them off the manifest, and
    // flipped the checkpoint to complete while their event rows sat unread
    // (review 20260803, D3). They stay on the crew list, and their count stays
    // open, until a human resolves it.
    const dropped = [...existingRoles.keys()].filter((personId) => !valid.includes(personId));
    if (dropped.length > 0 && (await crewWithRollCallHistory(tx, tripId, dropped)).size > 0) {
      return false;
    }
    if (trip.courseId) {
      const assignedIds = new Set(valid);
      // Who is doing what on *this* sailing, with the roles this very edit
      // would leave in place — never the shop-wide list alone (`countInWaterCrew`,
      // src/lib/crew-roles.ts, ADR 20260803-per-trip-crew-role). Reading
      // `person_roles` here was the sixth copy of a rule that already has one
      // home, and it let the session's only instructor be rostered onto the
      // deck as its captain while this check happily read "1 instructor"
      // (review 20260803, D8).
      const proposedCrew = requested
        .filter((entry) => assignedIds.has(crewInputPersonId(entry)))
        .map((entry) => ({
          tripRole: roleAfterChange(entry),
          shopRoles:
            staff.find((member) => member.person.id === crewInputPersonId(entry))?.roles ?? [],
        }));
      const review = reviewManifestChange({
        courseRequiresInstructor: true,
        proposedCrew,
      });
      if (review.blocking) return false;
      const { instructorCount } = countInWaterCrew(proposedCrew);
      if (instructorCount === 0) return false;
      // Deliberately no ratio check here. A crew change that leaves the session
      // over its ratio is **recorded**, not refused: the manifest is a safety
      // document and must say who is actually aboard. Refusing meant an
      // instructor who called in sick stayed on the printed crew list — and at
      // the 2:1 intro ratio that is the ordinary case, not an edge one. The
      // resulting gap surfaces loudly as `over_ratio` (courseCrewGap, consumed
      // by the trip page, the staffing coverage list, and Today), and new
      // bookings are still refused at the tightened cap in `createBookingRecord`.
    }
    const days = await tx
      .select({ startsAt: tripScheduleDays.startsAt, endsAt: tripScheduleDays.endsAt })
      .from(tripScheduleDays)
      .where(eq(tripScheduleDays.tripId, tripId));
    const proposedDays =
      days.length > 0 ? days : [{ startsAt: trip.startsAt, endsAt: trip.endsAt }];
    if (valid.length > 0) {
      const conflict = await tx
        .select({ personId: tripAssignments.personId })
        .from(tripAssignments)
        .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
        .leftJoin(tripScheduleDays, eq(tripScheduleDays.tripId, trips.id))
        .where(
          and(
            liveTrip(),
            eq(trips.shopId, shopId),
            ne(trips.id, tripId),
            inArray(tripAssignments.personId, valid),
            or(
              ...proposedDays.map((day) =>
                and(
                  lt(sql`coalesce(${tripScheduleDays.startsAt}, ${trips.startsAt})`, day.endsAt),
                  gt(sql`coalesce(${tripScheduleDays.endsAt}, ${trips.endsAt})`, day.startsAt),
                ),
              ),
            ),
          ),
        )
        .limit(1);
      if (conflict.length > 0) return false;
    }
    // The roles were read before the delete (`existingRoles` above), so a crew
    // edit that says nothing about roles preserves them instead of blanking
    // them.
    await tx.delete(tripAssignments).where(eq(tripAssignments.tripId, tripId));
    if (requested.length > 0) {
      await tx.insert(tripAssignments).values(
        requested.map((entry) => ({
          tripId,
          personId: crewInputPersonId(entry),
          tripRole: roleAfterChange(entry),
        })),
      );
    }
    return true;
  });
  // Who is crewing is on the manifest, so a swap is a manifest change (ADR
  // 20260804-manifest-web-push). Outside the transaction above, and only on a
  // real change: this fans out to a push service, and a refused assignment
  // (unknown staff, a scheduling conflict) changed nothing worth waking a
  // phone for.
  if (changed) await publishManifestEvent(db, shopId, tripId);
  return changed;
}

export type TripCrewChange = {
  personId: string;
  operation: "assign" | "unassign";
  /**
   * The job this person is doing on this trip (ADR
   * 20260803-per-trip-crew-role). Omit to leave an existing assignment's role
   * untouched; pass `null` to clear it back to unspecified. Ignored on
   * `unassign`, which removes the row and its role with it.
   */
  tripRole?: TripCrewRole | null;
};

/**
 * Apply one crew assignment change without replacing concurrent assignments.
 * The trip and person are both tenant-checked inside the transaction.
 *
 * **Unassign is refused for anybody who has a per-person crew roll-call result
 * on this trip** (`crewWithRollCallHistory`). Removing them would delete the
 * assignment their result hangs off, drop them from the manifest, and let a
 * checkpoint that is open *because a named crew member did not come back* read
 * complete.
 *
 * Unassign-then-reassign does **not** preserve `trip_role` — the row and its
 * role go together, and the re-assign lands whatever role the caller names (so
 * `undefined` lands `null`, "unspecified"). That is why the trip's crew section
 * ships a role picker: the fix for a mis-tap is to set the role again, in the
 * UI, rather than a value nobody can reach without SQL (review 20260803, D4/D5).
 */
export async function changeTripCrew(
  db: AppDb,
  shopId: string,
  tripId: string,
  change: TripCrewChange,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [eligible] = await tx
      .select({ personId: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .innerJoin(trips, eq(trips.id, tripId))
      .where(
        and(
          eq(trips.shopId, shopId),
          eq(people.shopId, shopId),
          eq(people.id, change.personId),
          inArray(personRoles.role, [...STAFF_ROLES]),
        ),
      )
      .limit(1);
    if (!eligible) return false;

    const [targetTrip] = await tx
      .select({ courseId: trips.courseId })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
      .limit(1)
      .for("update");
    if (!targetTrip) return false;
    // Nobody with per-person roll-call history on this trip is removable — the
    // same guard `setTripCrew` applies, checked before the course rules so the
    // refusal reason cannot depend on whether the trip happens to be a course
    // (review 20260803, D3).
    if (
      change.operation === "unassign" &&
      (await crewWithRollCallHistory(tx, tripId, [change.personId])).size > 0
    ) {
      return false;
    }

    if (targetTrip.courseId) {
      const current = await tx
        .select({
          personId: tripAssignments.personId,
          tripRole: tripAssignments.tripRole,
        })
        .from(tripAssignments)
        .where(eq(tripAssignments.tripId, tripId));
      const proposedRoles = new Map(current.map((row) => [row.personId, row.tripRole] as const));
      if (change.operation === "assign") {
        proposedRoles.set(
          change.personId,
          // Omitting the role on an assign means "leave it as it is", which for
          // a person who is not on the crew yet is "unspecified".
          change.tripRole === undefined
            ? (proposedRoles.get(change.personId) ?? null)
            : change.tripRole,
        );
      } else {
        proposedRoles.delete(change.personId);
      }
      const roles = proposedRoles.size
        ? await tx
            .select({ personId: personRoles.personId, role: personRoles.role })
            .from(personRoles)
            .where(inArray(personRoles.personId, [...proposedRoles.keys()]))
        : [];
      const roleSets = new Map<string, string[]>();
      for (const role of roles) {
        const personRolesForMember = roleSets.get(role.personId) ?? [];
        personRolesForMember.push(role.role);
        roleSets.set(role.personId, personRolesForMember);
      }
      // One definition of who counts as this session's instructor
      // (`countInWaterCrew`, src/lib/crew-roles.ts) — with the per-trip roles
      // this change would leave in place, not `person_roles` alone. Reading the
      // shop-wide list here let a course session keep its "has an instructor"
      // pass while that instructor was rostered as the captain (review
      // 20260803, D8).
      const proposedCrew = [...proposedRoles].map(([personId, tripRole]) => ({
        tripRole,
        shopRoles: roleSets.get(personId) ?? [],
      }));
      const review = reviewManifestChange({
        courseRequiresInstructor: true,
        proposedCrew,
      });
      if (review.blocking) return false;
      const { instructorCount } = countInWaterCrew(proposedCrew);
      if (instructorCount === 0) return false;
      // No ratio check — same reason as `setTripCrew` above: pulling a crew
      // member who is not on the boat must always be recordable, even when it
      // leaves the session over ratio. The `over_ratio` advisory is the nudge;
      // the booking gate still holds the line on new seats.
    }

    if (change.operation === "assign") {
      const proposedDays = await tx
        .select({ startsAt: tripScheduleDays.startsAt, endsAt: tripScheduleDays.endsAt })
        .from(tripScheduleDays)
        .where(eq(tripScheduleDays.tripId, tripId))
        .orderBy(asc(tripScheduleDays.dayNumber));
      const effectiveDays =
        proposedDays.length > 0
          ? proposedDays
          : await tx
              .select({ startsAt: trips.startsAt, endsAt: trips.endsAt })
              .from(trips)
              .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
              .limit(1);
      const conflict = await tx
        .select({ personId: tripAssignments.personId })
        .from(tripAssignments)
        .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
        .leftJoin(tripScheduleDays, eq(tripScheduleDays.tripId, trips.id))
        .where(
          and(
            liveTrip(),
            eq(trips.shopId, shopId),
            ne(trips.id, tripId),
            eq(tripAssignments.personId, change.personId),
            or(
              ...effectiveDays.map((day) =>
                and(
                  lt(sql`coalesce(${tripScheduleDays.startsAt}, ${trips.startsAt})`, day.endsAt),
                  gt(sql`coalesce(${tripScheduleDays.endsAt}, ${trips.endsAt})`, day.startsAt),
                ),
              ),
            ),
          ),
        )
        .limit(1);
      if (conflict.length > 0) return false;
      const insert = tx
        .insert(tripAssignments)
        .values({ tripId, personId: change.personId, tripRole: change.tripRole ?? null });
      // Assign is idempotent, so an already-assigned person hits the conflict
      // path — which is exactly where a *role change* on an existing
      // assignment arrives. `onConflictDoNothing` alone would accept the call,
      // return true, and silently keep the old role (ADR
      // 20260803-per-trip-crew-role). Only a caller that actually named a role
      // writes one; omitting it still means "leave it as it is".
      await (change.tripRole === undefined
        ? insert.onConflictDoNothing()
        : insert.onConflictDoUpdate({
            target: [tripAssignments.tripId, tripAssignments.personId],
            set: { tripRole: change.tripRole },
          }));
    } else {
      await tx
        .delete(tripAssignments)
        .where(
          and(eq(tripAssignments.tripId, tripId), eq(tripAssignments.personId, change.personId)),
        );
    }
    return true;
  });
}

/** The crew assigned to each of these trips, in one query, grouped by trip. */
export async function tripCrewByTrip(
  db: DbExecutor,
  shopId: string,
  tripIds: string[],
): Promise<Map<string, Array<{ id: string; name: string }>>> {
  if (tripIds.length === 0) return new Map();
  const rows = await db
    .select({ tripId: tripAssignments.tripId, personId: people.id, name: people.fullName })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .innerJoin(people, eq(people.id, tripAssignments.personId))
    .where(and(eq(trips.shopId, shopId), inArray(tripAssignments.tripId, tripIds), liveTrip()))
    .orderBy(asc(people.fullName));
  const byTrip = new Map<string, Array<{ id: string; name: string }>>();
  for (const row of rows) {
    const list = byTrip.get(row.tripId) ?? [];
    list.push({ id: row.personId, name: row.name });
    byTrip.set(row.tripId, list);
  }
  return byTrip;
}
