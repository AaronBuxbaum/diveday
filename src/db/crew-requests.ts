import { and, asc, count, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";

import { STAFF_ROLES } from "@/lib/authz";
import type { CalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { courseCrewGap } from "@/lib/course-ratios";
import type {
  AvailabilityBlock,
  CrewAssignmentRequest,
  CrewRequestState,
} from "@/lib/crew-requests";
import { inWaterCrewRole, lapsedRungs, lastDayOfDeparture } from "@/lib/crew-roles";
import type { AppDb, DbExecutor } from "./client";
import { recordCrewNotices } from "./crew-notices";
import {
  bookings,
  courses,
  crewAssignmentRequests,
  crewAvailabilityBlocks,
  people,
  personRoles,
  shops,
  trips,
} from "./schema";
import { ratingCredentialsByPerson } from "./staff-credentials";
import { courseCrewCountsByTrip } from "./today";
import { liveTrip } from "./trips-live";

/**
 * **The crew's own writes on the staffing week** (issue #1235).
 *
 * Staffing shipped as the owner's shift roster (ADR
 * 20260806-staffing-is-the-shift-roster) and every write on it was the owner's.
 * This is the second actor. Everything here holds to one rule, stated in
 * `src/lib/crew-requests.ts` and enforced here: **a crew member writes only
 * their own rows**, and an approved request goes onto a boat through the
 * ordinary `changeTripCrew` mutation rather than around it — so the agency
 * training ratio, the course rules and the roll-call guard all still apply.
 *
 * There is no second path onto a departure. A request is a request.
 */

/** Why a write was refused. Codes, never sentences — the surface picks the words. */
export type CrewWriteRefusal =
  /** Not this shop's live staff, or not the person whose row this is. */
  "not_allowed" | "person_not_found" | "trip_not_found" | "request_not_found" | "invalid_range";

export type CrewWriteOutcome = { ok: true; id: string } | { ok: false; reason: CrewWriteRefusal };

/**
 * Whether `actorPersonId` may write rows belonging to `subjectPersonId`.
 *
 * Two answers, and only two: **yourself**, always, provided you are this shop's
 * live staff; and **anyone**, if you can manage the roster. Everything else is
 * refused. The check is a live database read rather than a session claim, the
 * same discipline `activeStaffAttestorId` applies to a paper waiver — a person
 * removed from the shop this morning must not be able to book themselves onto
 * Saturday's boat this afternoon.
 */
async function mayWriteFor(
  tx: DbExecutor,
  shopId: string,
  actorPersonId: string,
  subjectPersonId: string,
  canManageRoster: boolean,
): Promise<boolean> {
  // Every role, not the first one the join happens to return: a divemaster who
  // also holds `diver` must not be refused because the rows came back in the
  // other order.
  const roles = await tx
    .select({ role: personRoles.role })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.id, actorPersonId), eq(people.shopId, shopId), isNull(people.deletedAt)));
  if (!roles.some((row) => STAFF_ROLES.includes(row.role as (typeof STAFF_ROLES)[number]))) {
    return false;
  }
  return canManageRoster || actorPersonId === subjectPersonId;
}

/** Every live blackout that touches `[from, to]`, for the whole shop. */
export async function listCrewAvailabilityBlocks(
  db: DbExecutor,
  shopId: string,
  range: { from: string; to: string },
): Promise<AvailabilityBlock[]> {
  const rows = await db
    .select()
    .from(crewAvailabilityBlocks)
    .where(
      and(
        eq(crewAvailabilityBlocks.shopId, shopId),
        isNull(crewAvailabilityBlocks.deletedAt),
        // Two inclusive ranges overlap unless one ends before the other starts.
        lte(crewAvailabilityBlocks.startsOn, range.to),
        gte(crewAvailabilityBlocks.endsOn, range.from),
      ),
    )
    .orderBy(asc(crewAvailabilityBlocks.startsOn));
  return rows.map((row) => ({
    id: row.id,
    personId: row.personId,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    note: row.note,
  }));
}

/** A crew member says they are away for a range of days. */
export async function saveCrewAvailabilityBlock(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    actorPersonId: string;
    canManageRoster: boolean;
    startsOn: string;
    endsOn: string;
    note?: string | null;
  },
): Promise<CrewWriteOutcome> {
  if (input.endsOn < input.startsOn) return { ok: false, reason: "invalid_range" };
  return db.transaction(async (tx): Promise<CrewWriteOutcome> => {
    if (
      !(await mayWriteFor(
        tx,
        input.shopId,
        input.actorPersonId,
        input.personId,
        input.canManageRoster,
      ))
    ) {
      return { ok: false, reason: "not_allowed" };
    }
    // The subject must be this shop's own live person too — a valid actor with
    // roster rights must not be able to write a row against a stranger's id.
    const [subject] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.id, input.personId),
          eq(people.shopId, input.shopId),
          isNull(people.deletedAt),
        ),
      )
      .limit(1);
    if (!subject) return { ok: false, reason: "person_not_found" };

    const [row] = await tx
      .insert(crewAvailabilityBlocks)
      .values({
        shopId: input.shopId,
        personId: input.personId,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        note: input.note?.trim() || null,
        createdByPersonId: input.actorPersonId,
      })
      .returning({ id: crewAvailabilityBlocks.id });
    if (!row) throw new Error("saveCrewAvailabilityBlock: insert returned no row");
    return { ok: true, id: row.id };
  });
}

/** Soft, like every delete (ADR 20260820-every-delete-is-soft). */
export async function deleteCrewAvailabilityBlock(
  db: AppDb,
  input: {
    shopId: string;
    blockId: string;
    actorPersonId: string;
    canManageRoster: boolean;
    now?: Date;
  },
): Promise<CrewWriteOutcome> {
  const now = input.now ?? nowDate();
  return db.transaction(async (tx): Promise<CrewWriteOutcome> => {
    const [block] = await tx
      .select({ id: crewAvailabilityBlocks.id, personId: crewAvailabilityBlocks.personId })
      .from(crewAvailabilityBlocks)
      .where(
        and(
          eq(crewAvailabilityBlocks.id, input.blockId),
          eq(crewAvailabilityBlocks.shopId, input.shopId),
          isNull(crewAvailabilityBlocks.deletedAt),
        ),
      )
      .limit(1);
    if (!block) return { ok: false, reason: "request_not_found" };
    if (
      !(await mayWriteFor(
        tx,
        input.shopId,
        input.actorPersonId,
        block.personId,
        input.canManageRoster,
      ))
    ) {
      return { ok: false, reason: "not_allowed" };
    }
    await tx
      .update(crewAvailabilityBlocks)
      .set({ deletedAt: now })
      .where(eq(crewAvailabilityBlocks.id, block.id));
    return { ok: true, id: block.id };
  });
}

/** Live requests against a set of departures, newest ask first within a trip. */
export async function listCrewAssignmentRequests(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
): Promise<CrewAssignmentRequest[]> {
  if (tripIds.length === 0) return [];
  const rows = await db
    .select({ request: crewAssignmentRequests, person: people })
    .from(crewAssignmentRequests)
    .innerJoin(people, eq(people.id, crewAssignmentRequests.personId))
    .where(and(eq(crewAssignmentRequests.shopId, shopId), isNull(crewAssignmentRequests.deletedAt)))
    .orderBy(asc(crewAssignmentRequests.requestedAt));
  const wanted = new Set(tripIds);
  const live = rows.filter((row) => wanted.has(row.request.tripId));
  // What each requester would be worth in the water, for the person answering
  // (issue #1339). A second query rather than a join on the select above: one
  // row per `(person, role)` would fan the requests out and silently duplicate
  // every ask made by somebody holding two roles.
  const requesterIds = live.map((row) => row.request.personId);
  const rolesByPerson = await shopRolesByPerson(db, requesterIds);
  // The hint states the supervision claim ("this ask will not close the
  // gap"), so it reads the requester's recorded ratings against the
  // departure's last shop-local day, as Today, the staffing week and the trip
  // page do (issue #2173, after #1853). Otherwise a lapsed instructor's ask
  // was hinted as closing a gap the Today row on the same session says it
  // will not. The crew editor's refusals still count the roster's claim
  // (H-59), so approving the ask is never refused for a lapse.
  const credentials = await ratingCredentialsByPerson(db, shopId, requesterIds);
  const divesOnByTrip = await lastDayByTrip(db, shopId, [
    ...new Set(live.map((row) => row.request.tripId)),
  ]);
  return live.map(({ request, person }) => {
    const divesOn = divesOnByTrip.get(request.tripId);
    return {
      id: request.id,
      tripId: request.tripId,
      personId: request.personId,
      personName: person.fullName,
      // No per-trip role: the ask names a departure, never a job on it, so this
      // is the shop-wide inference `inWaterCrewRole` makes for an unspecified
      // row, narrowed by any rung the requester's ratings have lapsed off by
      // the day the departure is last in the water.
      inWaterRole: inWaterCrewRole({
        tripRole: null,
        shopRoles: rolesByPerson.get(request.personId) ?? [],
        lapsedRungs:
          divesOn === undefined
            ? []
            : lapsedRungs(credentials.get(request.personId) ?? [], divesOn),
      }),
      state: (request.decision ?? "pending") as CrewRequestState,
      requestedAt: request.requestedAt,
    };
  });
}

/**
 * The shop-local day each of these live departures is last in the water on
 * (`lastDayOfDeparture`), the day a requester's ratings are read against.
 */
async function lastDayByTrip(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
): Promise<Map<string, CalendarDate>> {
  const byTrip = new Map<string, CalendarDate>();
  if (tripIds.length === 0) return byTrip;
  const rows = await db
    .select({ id: trips.id, endsAt: trips.endsAt, timeZone: shops.timezone })
    .from(trips)
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .where(and(liveTrip(), eq(trips.shopId, shopId), inArray(trips.id, [...tripIds])));
  for (const row of rows) byTrip.set(row.id, lastDayOfDeparture(row.endsAt, row.timeZone));
  return byTrip;
}

/** Every standing role each of these people holds, folded one entry per person. */
async function shopRolesByPerson(
  db: DbExecutor,
  personIds: readonly string[],
): Promise<Map<string, string[]>> {
  const byPerson = new Map<string, string[]>();
  const wanted = [...new Set(personIds)];
  if (wanted.length === 0) return byPerson;
  const rows = await db
    .select({ personId: personRoles.personId, role: personRoles.role })
    .from(personRoles)
    .where(inArray(personRoles.personId, wanted));
  for (const row of rows) {
    byPerson.set(row.personId, [...(byPerson.get(row.personId) ?? []), row.role]);
  }
  return byPerson;
}

/**
 * Whether this departure is **still over a ratio only an instructor closes**
 * right now — asked after an approval has already run through
 * `changeTripCrew`, so the answer describes the boat as it stands rather than
 * predicting it.
 *
 * Issue #1339's second half: `INTRO_COURSE_RATIO` credits an assistant zero
 * students, so approving a divemaster onto an over-ratio DSD session moves
 * capacity by nothing and the plain "Approved, and they're on the crew" reads
 * as a gap closed. The entry-level cap past its per-instructor ceiling is the
 * same case (dive-domain review of #1677): no number of assistants buys a
 * seat there either, so the gap's own `remedy` answers, not its ratio kind. Measured rather than inferred from the requester's roles,
 * because the honest sentence is about the session, and a second instructor
 * approved in the same minute must not leave this saying the wrong thing.
 *
 * Composed from `courseCrewGap` (src/lib/course-ratios.ts) and Today's own crew
 * counter — never a second ratio detector.
 */
export async function tripRatioGapNeedsInstructor(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ course: courses, booked: count(bookings.id) })
    .from(trips)
    .leftJoin(courses, eq(courses.id, trips.courseId))
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .groupBy(trips.id, courses.id)
    .limit(1);
  if (!row?.course) return false;
  const counts = (await courseCrewCountsByTrip(db, shopId, [tripId])).get(tripId) ?? {
    instructorCount: 0,
    assistantCount: 0,
  };
  const gap = courseCrewGap({
    course: row.course,
    instructorCount: counts.instructorCount,
    assistantCount: counts.assistantCount,
    booked: row.booked,
  });
  return gap.code === "over_ratio" && gap.remedy === "instructor";
}

/**
 * A crew member asks to work one departure.
 *
 * The blackout check lives in `src/lib/crew-requests.ts` and runs at the
 * surface, so the affordance and the write agree; this refuses the shapes only
 * the database can see — a departure that is not this shop's or not live, and a
 * second ask, which the partial unique index makes a race-safe fact rather than
 * a pre-check.
 */
export async function requestCrewAssignment(
  db: AppDb,
  input: { shopId: string; tripId: string; personId: string; actorPersonId: string; now?: Date },
): Promise<CrewWriteOutcome> {
  const now = input.now ?? nowDate();
  return db.transaction(async (tx): Promise<CrewWriteOutcome> => {
    // Nobody asks on somebody else's behalf: a request is a statement about
    // what *you* want to work, so `canManageRoster` buys nothing here.
    if (!(await mayWriteFor(tx, input.shopId, input.actorPersonId, input.personId, false))) {
      return { ok: false, reason: "not_allowed" };
    }
    const [trip] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
      .limit(1);
    if (!trip) return { ok: false, reason: "trip_not_found" };

    const [existing] = await tx
      .select({ id: crewAssignmentRequests.id })
      .from(crewAssignmentRequests)
      .where(
        and(
          eq(crewAssignmentRequests.tripId, input.tripId),
          eq(crewAssignmentRequests.personId, input.personId),
          isNull(crewAssignmentRequests.deletedAt),
        ),
      )
      .limit(1);
    // A second tap is the same ask, not a second one.
    if (existing) return { ok: true, id: existing.id };

    const [row] = await tx
      .insert(crewAssignmentRequests)
      .values({
        shopId: input.shopId,
        tripId: input.tripId,
        personId: input.personId,
        requestedAt: now,
      })
      .returning({ id: crewAssignmentRequests.id });
    if (!row) throw new Error("requestCrewAssignment: insert returned no row");
    return { ok: true, id: row.id };
  });
}

/** Withdrawing an ask. Soft, and only ever your own. */
export async function withdrawCrewAssignmentRequest(
  db: AppDb,
  input: { shopId: string; requestId: string; actorPersonId: string; now?: Date },
): Promise<CrewWriteOutcome> {
  const now = input.now ?? nowDate();
  return db.transaction(async (tx): Promise<CrewWriteOutcome> => {
    const [request] = await tx
      .select({ id: crewAssignmentRequests.id, personId: crewAssignmentRequests.personId })
      .from(crewAssignmentRequests)
      .where(
        and(
          eq(crewAssignmentRequests.id, input.requestId),
          eq(crewAssignmentRequests.shopId, input.shopId),
          isNull(crewAssignmentRequests.deletedAt),
        ),
      )
      .limit(1);
    if (!request) return { ok: false, reason: "request_not_found" };
    if (!(await mayWriteFor(tx, input.shopId, input.actorPersonId, request.personId, false))) {
      return { ok: false, reason: "not_allowed" };
    }
    await tx
      .update(crewAssignmentRequests)
      .set({ deletedAt: now })
      .where(eq(crewAssignmentRequests.id, request.id));
    return { ok: true, id: request.id };
  });
}

/**
 * The owner answers a request.
 *
 * **Approving does not assign anybody here.** It stamps the decision and hands
 * the caller the trip and person to run through `changeTripCrew`, which is
 * where the ratio, the course rules and the roll-call guard live. Splitting it
 * that way is the whole point of the model: if this wrote a `trip_assignments`
 * row directly it would be a second, weaker path onto a boat.
 */
export async function decideCrewAssignmentRequest(
  db: AppDb,
  input: {
    shopId: string;
    requestId: string;
    decision: "approved" | "declined";
    decidedByPersonId: string;
    /**
     * Whether this person may manage the roster (`canPersonManageStaffAccounts`).
     * Passed rather than re-derived, so the surface's gate and this one are the
     * same fact — and required, because a crew member approving their own ask
     * is exactly the shape this table exists to prevent.
     */
    canManageRoster: boolean;
    now?: Date;
  },
): Promise<
  | { ok: true; id: string; tripId: string; personId: string }
  | { ok: false; reason: CrewWriteRefusal }
> {
  const now = input.now ?? nowDate();
  return db.transaction(async (tx) => {
    // Only somebody who can manage the roster answers a request — never the
    // person who made it, which `mayWriteFor`'s "yourself, always" branch would
    // otherwise allow. Both halves are checked: the caller's gate, and this
    // shop's own live-staff read.
    if (!input.canManageRoster) return { ok: false as const, reason: "not_allowed" as const };
    if (
      !(await mayWriteFor(tx, input.shopId, input.decidedByPersonId, input.decidedByPersonId, true))
    ) {
      return { ok: false as const, reason: "not_allowed" as const };
    }

    const [request] = await tx
      .select()
      .from(crewAssignmentRequests)
      .where(
        and(
          eq(crewAssignmentRequests.id, input.requestId),
          eq(crewAssignmentRequests.shopId, input.shopId),
          isNull(crewAssignmentRequests.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!request) return { ok: false as const, reason: "request_not_found" as const };
    // Already answered: the answer stands rather than being rewritten, so a
    // double tap cannot turn a decline into an approval.
    if (request.decision) {
      return {
        ok: true as const,
        id: request.id,
        tripId: request.tripId,
        personId: request.personId,
      };
    }

    await tx
      .update(crewAssignmentRequests)
      .set({
        decision: input.decision,
        decidedAt: now,
        decidedByPersonId: input.decidedByPersonId,
      })
      .where(eq(crewAssignmentRequests.id, request.id));
    // The asker hears the answer (ADR 20261009-crew-hear-about-their-boats).
    // An approval's own assignment, made next by the caller, nets into it.
    await recordCrewNotices(
      tx,
      [
        {
          shopId: input.shopId,
          tripId: request.tripId,
          personId: request.personId,
          change: input.decision === "approved" ? "request_approved" : "request_declined",
          actorPersonId: input.decidedByPersonId,
        },
      ],
      now,
    );
    return {
      ok: true as const,
      id: request.id,
      tripId: request.tripId,
      personId: request.personId,
    };
  });
}
