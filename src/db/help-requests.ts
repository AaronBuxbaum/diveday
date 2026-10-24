import { and, asc, eq, exists, gt, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { isStaff, STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { loadActiveStaffRoles } from "./authz";
import type { AppDb, AppTransaction, DbExecutor } from "./client";
import { recordDeskEvent } from "./desk-events";
import { lockHelpRequestDeparture } from "./help-request-lock";
import {
  bookings,
  people,
  personRoles,
  shops,
  tripAssignments,
  tripHelpRequests,
  trips,
} from "./schema";
import { livePerson, liveTrip } from "./trips-live";

export type HelpRequestKind = (typeof tripHelpRequests.kind.enumValues)[number];
export type HelpRequestStatus = (typeof tripHelpRequests.status.enumValues)[number];
const activeStatuses = ["requested", "acknowledged"] as const;
const helperPerson = alias(people, "help_request_helper");

/**
 * The recorded helper is named only while they still serve this departure:
 * this shop's live person, a staff role, and a place on its crew. Writers
 * clear a helper who stops serving; this keeps every read honest if one is
 * missed, so no page names someone who is not there to help.
 */
function helperStillServes(db: DbExecutor) {
  return and(
    eq(helperPerson.id, tripHelpRequests.helperPersonId),
    isNull(helperPerson.deletedAt),
    exists(
      db
        .select({ one: sql`1` })
        .from(personRoles)
        .where(
          and(
            eq(personRoles.personId, helperPerson.id),
            inArray(personRoles.role, [...STAFF_ROLES]),
          ),
        ),
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(tripAssignments)
        .where(
          and(
            eq(tripAssignments.personId, helperPerson.id),
            eq(tripAssignments.tripId, tripHelpRequests.tripId),
          ),
        ),
    ),
  );
}

export type HelpRequest = {
  id: string;
  shopId: string;
  tripId: string;
  bookingId: string;
  kind: HelpRequestKind;
  status: HelpRequestStatus;
  revision: number;
  createdAt: Date;
  acknowledgedAt: Date | null;
  handledAt: Date | null;
  helperPersonId: string | null;
  helperPersonName?: string | null;
};

export type TodayHelpRequest = Omit<HelpRequest, "status"> & {
  status: (typeof activeStatuses)[number];
  personName: string;
  helperPersonName: string | null;
  crew: { personId: string; fullName: string }[];
  meetingInstructions: string | null;
  tripTitle: string;
  startsAt: Date;
};

/** A diver's own request, hidden once the trip has ended or was cancelled. */
export async function getHelpRequestForBooking(
  db: AppDb,
  shopId: string,
  bookingId: string,
  now: Date = nowDate(),
): Promise<HelpRequest | null> {
  const [row] = await db
    .select({ request: tripHelpRequests, helperPersonName: helperPerson.fullName })
    .from(tripHelpRequests)
    .innerJoin(bookings, eq(bookings.id, tripHelpRequests.bookingId))
    .innerJoin(trips, eq(trips.id, tripHelpRequests.tripId))
    .leftJoin(helperPerson, and(eq(helperPerson.shopId, shopId), helperStillServes(db)))
    .where(
      and(
        eq(tripHelpRequests.shopId, shopId),
        eq(tripHelpRequests.bookingId, bookingId),
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripHelpRequests.tripId),
        eq(trips.shopId, shopId),
        liveTrip(),
        ne(tripHelpRequests.status, "withdrawn"),
        ne(bookings.status, "cancelled"),
        eq(trips.status, "scheduled"),
        gt(trips.endsAt, now),
      ),
    )
    .limit(1);
  return row ? { ...row.request, helperPersonName: row.helperPersonName } : null;
}

/** The open requests that belong in the existing Today departure stations. */
export async function listTodayHelpRequests(
  db: AppDb,
  shopId: string,
  tripIds: readonly string[],
  now: Date = nowDate(),
): Promise<TodayHelpRequest[]> {
  if (tripIds.length === 0) return [];
  const rows = await db
    .select({
      request: tripHelpRequests,
      personName: people.fullName,
      helperPersonName: helperPerson.fullName,
      trip: trips,
    })
    .from(tripHelpRequests)
    .innerJoin(bookings, eq(bookings.id, tripHelpRequests.bookingId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, tripHelpRequests.tripId))
    .leftJoin(helperPerson, and(eq(helperPerson.shopId, shopId), helperStillServes(db)))
    .where(
      and(
        eq(tripHelpRequests.shopId, shopId),
        inArray(tripHelpRequests.tripId, tripIds),
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripHelpRequests.tripId),
        eq(people.shopId, shopId),
        eq(trips.shopId, shopId),
        liveTrip(),
        inArray(tripHelpRequests.status, [...activeStatuses]),
        ne(bookings.status, "cancelled"),
        eq(trips.status, "scheduled"),
        gt(trips.endsAt, now),
      ),
    )
    .orderBy(
      asc(trips.startsAt),
      asc(tripHelpRequests.createdAt),
      asc(people.fullName),
      asc(tripHelpRequests.id),
    );
  const crewRows = await db
    .select({ tripId: tripAssignments.tripId, personId: people.id, fullName: people.fullName })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .innerJoin(people, eq(people.id, tripAssignments.personId))
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        inArray(tripAssignments.tripId, [...tripIds]),
        eq(trips.shopId, shopId),
        liveTrip(),
        eq(people.shopId, shopId),
        livePerson(),
        inArray(personRoles.role, [...STAFF_ROLES]),
      ),
    )
    .orderBy(asc(people.fullName), asc(people.id));
  const crewByTrip = new Map<string, Map<string, { personId: string; fullName: string }>>();
  for (const crew of crewRows) {
    const byPerson = crewByTrip.get(crew.tripId) ?? new Map();
    byPerson.set(crew.personId, { personId: crew.personId, fullName: crew.fullName });
    crewByTrip.set(crew.tripId, byPerson);
  }

  return rows.map(({ request, personName, helperPersonName, trip }) => ({
    ...request,
    // The query is explicitly restricted to `activeStatuses`; keep that
    // invariant in the returned type so Today cannot expose a handled or
    // withdrawn request as an actionable row.
    status: request.status as TodayHelpRequest["status"],
    personName,
    helperPersonName,
    crew: [...(crewByTrip.get(trip.id)?.values() ?? [])],
    meetingInstructions:
      [
        trip.meetingPointLabel,
        trip.meetingPointAddress,
        trip.arrivalLandmark,
        trip.arrivalParkingNote,
      ]
        .map((value) => value?.trim())
        .filter(Boolean)
        .join(" · ") || null,
    tripTitle: trip.title,
    startsAt: trip.startsAt,
  }));
}

/** A handled request, kept on the departure so a mis-tap can be reopened after the undo toast. */
export type HandledHelpRequest = {
  id: string;
  tripId: string;
  revision: number;
  kind: HelpRequestKind;
  personName: string;
  helperPersonId: string;
  helperPersonName: string | null;
  tripTitle: string;
  startsAt: Date;
  handledAt: Date | null;
};

/**
 * The handled requests of these departures, while a reopen can still succeed: the same live,
 * scheduled, unfinished departure and uncancelled booking `undoHelpRequestCompletion` demands. A
 * request with no recorded helper is left out, since undo is keyed on the helper it recorded.
 */
export async function listHandledHelpRequests(
  db: AppDb,
  shopId: string,
  tripIds: readonly string[],
  now: Date = nowDate(),
): Promise<HandledHelpRequest[]> {
  if (tripIds.length === 0) return [];
  const rows = await db
    .select({
      request: tripHelpRequests,
      personName: people.fullName,
      helperPersonName: helperPerson.fullName,
      trip: trips,
    })
    .from(tripHelpRequests)
    .innerJoin(bookings, eq(bookings.id, tripHelpRequests.bookingId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, tripHelpRequests.tripId))
    .leftJoin(helperPerson, and(eq(helperPerson.shopId, shopId), helperStillServes(db)))
    .where(
      and(
        eq(tripHelpRequests.shopId, shopId),
        inArray(tripHelpRequests.tripId, tripIds),
        eq(tripHelpRequests.status, "handled"),
        isNotNull(tripHelpRequests.helperPersonId),
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripHelpRequests.tripId),
        eq(people.shopId, shopId),
        eq(trips.shopId, shopId),
        liveTrip(),
        ne(bookings.status, "cancelled"),
        eq(trips.status, "scheduled"),
        gt(trips.endsAt, now),
      ),
    )
    .orderBy(
      asc(trips.startsAt),
      asc(tripHelpRequests.handledAt),
      asc(people.fullName),
      asc(tripHelpRequests.id),
    );
  return rows.flatMap(({ request, personName, helperPersonName, trip }) =>
    request.helperPersonId
      ? [
          {
            id: request.id,
            tripId: trip.id,
            revision: request.revision,
            kind: request.kind,
            personName,
            helperPersonId: request.helperPersonId,
            helperPersonName,
            tripTitle: trip.title,
            startsAt: trip.startsAt,
            handledAt: request.handledAt,
          },
        ]
      : [],
  );
}

export type SaveHelpRequestResult =
  | { ok: true; request: HelpRequest | null }
  | { ok: false; reason: "unavailable" | "handled" };

/** Create, replace, or withdraw the one small request attached to a seat. */
export async function saveHelpRequest(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    kind: HelpRequestKind | "none";
    now?: Date;
  },
): Promise<SaveHelpRequestResult> {
  const now = input.now ?? nowDate();
  return db.transaction(async (tx) => {
    const [booking] = await tx
      .select({
        tripId: bookings.tripId,
        personId: bookings.personId,
        helpRequestsOn: shops.helpRequestsEnabled,
      })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .innerJoin(shops, eq(shops.id, bookings.shopId))
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          eq(trips.shopId, input.shopId),
          liveTrip(),
          eq(bookings.tripId, trips.id),
          ne(bookings.status, "cancelled"),
          eq(trips.status, "scheduled"),
          gt(trips.endsAt, now),
        ),
      )
      .limit(1)
      .for("update", { of: trips });
    if (!booking) return { ok: false, reason: "unavailable" };
    // **Help requests are a Features switch.** Off, nobody asks for a new one;
    // a request already open stays on Today until the crew handles it, and
    // the diver may still withdraw it.
    if (input.kind !== "none" && !booking.helpRequestsOn) {
      return { ok: false, reason: "unavailable" };
    }

    const [existing] = await tx
      .select()
      .from(tripHelpRequests)
      .where(
        and(
          eq(tripHelpRequests.shopId, input.shopId),
          eq(tripHelpRequests.bookingId, input.bookingId),
        ),
      )
      .limit(1)
      .for("update", { of: tripHelpRequests });
    if (existing?.status === "handled") return { ok: false, reason: "handled" };

    if (input.kind === "none") {
      if (!existing) return { ok: true, request: null };
      const [updated] = await tx
        .update(tripHelpRequests)
        .set({
          revision: sql`${tripHelpRequests.revision} + 1`,
          status: "withdrawn",
          updatedAt: now,
          acknowledgedAt: null,
          handledAt: null,
          helperPersonId: null,
          resolvedByPersonId: null,
        })
        .where(eq(tripHelpRequests.id, existing.id))
        .returning();
      return { ok: true, request: updated ?? null };
    }

    const [request] = existing
      ? await tx
          .update(tripHelpRequests)
          .set({
            revision: sql`${tripHelpRequests.revision} + 1`,
            kind: input.kind,
            status: "requested",
            updatedAt: now,
            acknowledgedAt: null,
            handledAt: null,
            helperPersonId: null,
            resolvedByPersonId: null,
          })
          .where(eq(tripHelpRequests.id, existing.id))
          .returning()
      : await tx
          .insert(tripHelpRequests)
          .values({
            shopId: input.shopId,
            tripId: booking.tripId,
            bookingId: input.bookingId,
            kind: input.kind,
            status: "requested",
            createdAt: now,
            updatedAt: now,
          })
          .returning();
    // "Ben Okafor wants a hand from the crew." — the fourth of the arrival
    // facts #1187 names, and the one that most often reaches the boat as
    // nothing at all. **Which of the three kinds it was is deliberately not in
    // the event**: the strip carries the fact that a diver asked, and the ask
    // itself is one tap away on Today. No actor either — the diver asked on
    // their own link, so this is news to every staffer including the desk.
    await recordDeskEvent(tx, {
      shopId: input.shopId,
      tripId: booking.tripId,
      kind: "help_request",
      bookingId: input.bookingId,
      subjectPersonId: booking.personId,
      occurredAt: now,
    });
    return { ok: true, request: request ?? null };
  });
}

export type HelpRequestMutationResult =
  | { ok: true; request: HelpRequest }
  | { ok: false; reason: "unavailable" | "invalid_transition" | "invalid_helper" };

/**
 * The actor must still be an active staff member in this shop at write time:
 * this shop's live person, an active sign-in account, and a staff role. The
 * same check every other write-time staff recheck uses (`manifests.ts`).
 */
async function isActiveStaff(
  tx: AppTransaction,
  shopId: string,
  personId: string,
): Promise<boolean> {
  const roles = await loadActiveStaffRoles(tx, shopId, personId);
  return roles !== null && isStaff(roles);
}

/**
 * The helper must be this shop's live staff member and on this departure's
 * crew. The share lock holds the crew row until the write commits, so a crew
 * removal cannot slip between this check and the update.
 */
async function isEligibleHelper(
  tx: AppTransaction,
  shopId: string,
  tripId: string,
  helperPersonId: string,
): Promise<boolean> {
  const [helper] = await tx
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .innerJoin(
      tripAssignments,
      and(eq(tripAssignments.personId, people.id), eq(tripAssignments.tripId, tripId)),
    )
    .where(
      and(
        eq(people.id, helperPersonId),
        eq(people.shopId, shopId),
        livePerson(),
        inArray(personRoles.role, [...STAFF_ROLES]),
      ),
    )
    .limit(1)
    .for("share", { of: tripAssignments });
  return Boolean(helper);
}

/** Record the named crew member who agreed after the desk spoke with them. */
export async function assignHelpRequestHelper(
  db: AppDb,
  input: {
    shopId: string;
    requestId: string;
    expectedRevision: number;
    helperPersonId: string;
    actorPersonId: string;
    expectedStatus: (typeof activeStatuses)[number];
    now?: Date;
  },
): Promise<HelpRequestMutationResult> {
  const now = input.now ?? nowDate();
  return db.transaction(async (tx) => {
    if (!(await lockHelpRequestDeparture(tx, input.shopId, input.requestId))) {
      return { ok: false, reason: "invalid_transition" };
    }
    const [existing] = await tx
      .select({ request: tripHelpRequests })
      .from(tripHelpRequests)
      .innerJoin(bookings, eq(bookings.id, tripHelpRequests.bookingId))
      .innerJoin(people, eq(people.id, bookings.personId))
      .innerJoin(trips, eq(trips.id, tripHelpRequests.tripId))
      .where(
        and(
          eq(tripHelpRequests.id, input.requestId),
          eq(tripHelpRequests.revision, input.expectedRevision),
          eq(tripHelpRequests.shopId, input.shopId),
          eq(tripHelpRequests.status, input.expectedStatus),
          eq(bookings.shopId, input.shopId),
          eq(bookings.tripId, tripHelpRequests.tripId),
          eq(trips.shopId, input.shopId),
          liveTrip(),
          eq(people.shopId, input.shopId),
          inArray(tripHelpRequests.status, [...activeStatuses]),
          ne(bookings.status, "cancelled"),
          eq(trips.status, "scheduled"),
          gt(trips.endsAt, now),
        ),
      )
      .limit(1)
      .for("update", { of: tripHelpRequests });
    if (!existing) return { ok: false, reason: "invalid_transition" };
    if (!(await isActiveStaff(tx, input.shopId, input.actorPersonId))) {
      return { ok: false, reason: "unavailable" };
    }
    if (
      !(await isEligibleHelper(tx, input.shopId, existing.request.tripId, input.helperPersonId))
    ) {
      return { ok: false, reason: "invalid_helper" };
    }
    const [request] = await tx
      .update(tripHelpRequests)
      .set({
        revision: sql`${tripHelpRequests.revision} + 1`,
        status: "acknowledged",
        updatedAt: now,
        acknowledgedAt: existing.request.acknowledgedAt ?? now,
        handledAt: null,
        helperPersonId: input.helperPersonId,
        resolvedByPersonId: input.actorPersonId,
      })
      .where(
        and(
          eq(tripHelpRequests.id, input.requestId),
          eq(tripHelpRequests.revision, input.expectedRevision),
          eq(tripHelpRequests.shopId, input.shopId),
          eq(tripHelpRequests.status, input.expectedStatus),
        ),
      )
      .returning();
    return request ? { ok: true, request } : { ok: false, reason: "invalid_transition" };
  });
}

/** Completion leaves the active queue and keeps the confirmed helper identity. */
export async function completeHelpRequest(
  db: AppDb,
  input: {
    shopId: string;
    requestId: string;
    expectedRevision: number;
    actorPersonId: string;
    expectedHelperPersonId: string;
    now?: Date;
  },
): Promise<HelpRequestMutationResult> {
  const now = input.now ?? nowDate();
  return db.transaction(async (tx) => {
    if (!(await lockHelpRequestDeparture(tx, input.shopId, input.requestId))) {
      return { ok: false, reason: "invalid_transition" };
    }
    const [existing] = await tx
      .select({ request: tripHelpRequests })
      .from(tripHelpRequests)
      .innerJoin(bookings, eq(bookings.id, tripHelpRequests.bookingId))
      .innerJoin(trips, eq(trips.id, tripHelpRequests.tripId))
      .where(
        and(
          eq(tripHelpRequests.id, input.requestId),
          eq(tripHelpRequests.revision, input.expectedRevision),
          eq(tripHelpRequests.shopId, input.shopId),
          eq(tripHelpRequests.status, "acknowledged"),
          eq(tripHelpRequests.helperPersonId, input.expectedHelperPersonId),
          eq(bookings.shopId, input.shopId),
          eq(bookings.tripId, tripHelpRequests.tripId),
          ne(bookings.status, "cancelled"),
          eq(trips.shopId, input.shopId),
          liveTrip(),
          eq(trips.status, "scheduled"),
          gt(trips.endsAt, now),
        ),
      )
      .limit(1)
      .for("update", { of: tripHelpRequests });
    if (!existing) return { ok: false, reason: "invalid_transition" };
    if (!(await isActiveStaff(tx, input.shopId, input.actorPersonId))) {
      return { ok: false, reason: "unavailable" };
    }
    // Only someone who still serves this departure can be recorded as having
    // helped, the same check assignment and undo make.
    if (
      !(await isEligibleHelper(
        tx,
        input.shopId,
        existing.request.tripId,
        input.expectedHelperPersonId,
      ))
    ) {
      return { ok: false, reason: "invalid_helper" };
    }
    const [request] = await tx
      .update(tripHelpRequests)
      .set({
        revision: sql`${tripHelpRequests.revision} + 1`,
        status: "handled",
        handledAt: now,
        updatedAt: now,
        resolvedByPersonId: input.actorPersonId,
      })
      .where(
        and(
          eq(tripHelpRequests.id, input.requestId),
          eq(tripHelpRequests.revision, input.expectedRevision),
          eq(tripHelpRequests.shopId, input.shopId),
          eq(tripHelpRequests.status, "acknowledged"),
          eq(tripHelpRequests.helperPersonId, input.expectedHelperPersonId),
        ),
      )
      .returning();
    return request ? { ok: true, request } : { ok: false, reason: "invalid_transition" };
  });
}

/**
 * Undo a completion while the same helper is still recorded and the request
 * can still be acted on: a scheduled, unfinished departure and a booking that
 * is not cancelled. A helper who still serves the departure gets the assigned
 * state back. A helper who no longer does (off the crew, no staff role, or
 * deleted) cannot be promised again, so the request goes back to the desk as
 * `requested` with no helper, as crew removal does to an acknowledged one. A
 * mis-tapped "Help completed" is never closed for good.
 */
export async function undoHelpRequestCompletion(
  db: AppDb,
  input: {
    shopId: string;
    requestId: string;
    expectedRevision: number;
    actorPersonId: string;
    expectedHelperPersonId: string;
    now?: Date;
  },
): Promise<HelpRequestMutationResult> {
  const now = input.now ?? nowDate();
  return db.transaction(async (tx) => {
    if (!(await lockHelpRequestDeparture(tx, input.shopId, input.requestId))) {
      return { ok: false, reason: "invalid_transition" };
    }
    const [existing] = await tx
      .select({ request: tripHelpRequests })
      .from(tripHelpRequests)
      .innerJoin(bookings, eq(bookings.id, tripHelpRequests.bookingId))
      .innerJoin(trips, eq(trips.id, tripHelpRequests.tripId))
      .where(
        and(
          eq(tripHelpRequests.id, input.requestId),
          eq(tripHelpRequests.revision, input.expectedRevision),
          eq(tripHelpRequests.shopId, input.shopId),
          eq(tripHelpRequests.status, "handled"),
          eq(tripHelpRequests.helperPersonId, input.expectedHelperPersonId),
          eq(bookings.shopId, input.shopId),
          eq(bookings.tripId, tripHelpRequests.tripId),
          ne(bookings.status, "cancelled"),
          eq(trips.shopId, input.shopId),
          liveTrip(),
          eq(trips.status, "scheduled"),
          gt(trips.endsAt, now),
        ),
      )
      .limit(1)
      .for("update", { of: tripHelpRequests });
    if (!existing) return { ok: false, reason: "invalid_transition" };
    if (!(await isActiveStaff(tx, input.shopId, input.actorPersonId))) {
      return { ok: false, reason: "unavailable" };
    }
    const helperServes = await isEligibleHelper(
      tx,
      input.shopId,
      existing.request.tripId,
      input.expectedHelperPersonId,
    );
    const [request] = await tx
      .update(tripHelpRequests)
      .set(
        helperServes
          ? {
              revision: sql`${tripHelpRequests.revision} + 1`,
              status: "acknowledged",
              handledAt: null,
              updatedAt: now,
              resolvedByPersonId: input.actorPersonId,
            }
          : {
              revision: sql`${tripHelpRequests.revision} + 1`,
              status: "requested",
              acknowledgedAt: null,
              handledAt: null,
              helperPersonId: null,
              updatedAt: now,
              resolvedByPersonId: null,
            },
      )
      .where(
        and(
          eq(tripHelpRequests.id, input.requestId),
          eq(tripHelpRequests.revision, input.expectedRevision),
          eq(tripHelpRequests.shopId, input.shopId),
          eq(tripHelpRequests.status, "handled"),
          eq(tripHelpRequests.helperPersonId, input.expectedHelperPersonId),
        ),
      )
      .returning();
    return request ? { ok: true, request } : { ok: false, reason: "invalid_transition" };
  });
}

/**
 * A person who stops being live staff (removed from the team, every staff role
 * taken away, or deleted) can no longer be the promised helper. Every
 * acknowledged request naming them on a live, unfinished departure goes back
 * to the desk as `requested`, as crew removal does (`clearHelpRequestHelpers`
 * in `trips-crew.ts`). A handled request keeps who helped: that is the record.
 *
 * Call it inside the transaction that takes the role away, before the role
 * rows change. It locks each departure the person crews or helps on, in id
 * order, the lock every help-request writer takes first. An assignment that
 * is running at the same time either commits first and is released here, or
 * waits for this transaction and then finds no staff role.
 */
export async function releaseHelpRequestsOfPerson(
  tx: AppTransaction,
  input: { shopId: string; personId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? nowDate();
  const departures = await tx
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, input.shopId),
        liveTrip(),
        gt(trips.endsAt, now),
        or(
          exists(
            tx
              .select({ one: sql`1` })
              .from(tripAssignments)
              .where(
                and(
                  eq(tripAssignments.tripId, trips.id),
                  eq(tripAssignments.personId, input.personId),
                ),
              ),
          ),
          exists(
            tx
              .select({ one: sql`1` })
              .from(tripHelpRequests)
              .where(
                and(
                  eq(tripHelpRequests.tripId, trips.id),
                  eq(tripHelpRequests.helperPersonId, input.personId),
                ),
              ),
          ),
        ),
      ),
    )
    .orderBy(asc(trips.id))
    .for("update");
  if (departures.length === 0) return;
  await tx
    .update(tripHelpRequests)
    .set({
      revision: sql`${tripHelpRequests.revision} + 1`,
      status: "requested",
      acknowledgedAt: null,
      handledAt: null,
      helperPersonId: null,
      resolvedByPersonId: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(tripHelpRequests.shopId, input.shopId),
        inArray(
          tripHelpRequests.tripId,
          departures.map((departure) => departure.id),
        ),
        eq(tripHelpRequests.helperPersonId, input.personId),
        eq(tripHelpRequests.status, "acknowledged"),
      ),
    );
}
