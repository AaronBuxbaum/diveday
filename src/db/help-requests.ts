import { and, asc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import type { AppDb, AppTransaction } from "./client";
import { recordDeskEvent } from "./desk-events";
import { lockHelpRequestDeparture } from "./help-request-lock";
import { bookings, people, personRoles, tripAssignments, tripHelpRequests, trips } from "./schema";
import { livePerson, liveTrip } from "./trips-live";

export type HelpRequestKind = (typeof tripHelpRequests.kind.enumValues)[number];
export type HelpRequestStatus = (typeof tripHelpRequests.status.enumValues)[number];
const activeStatuses = ["requested", "acknowledged"] as const;
const helperPerson = alias(people, "help_request_helper");

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
    .leftJoin(
      helperPerson,
      and(
        eq(helperPerson.id, tripHelpRequests.helperPersonId),
        eq(helperPerson.shopId, shopId),
        isNull(helperPerson.deletedAt),
      ),
    )
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
    .leftJoin(
      helperPerson,
      and(
        eq(helperPerson.id, tripHelpRequests.helperPersonId),
        eq(helperPerson.shopId, shopId),
        isNull(helperPerson.deletedAt),
      ),
    )
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
      .select({ tripId: bookings.tripId, personId: bookings.personId })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
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

/** The actor must still be an active staff member in this shop at write time. */
async function isActiveStaff(
  tx: AppTransaction,
  shopId: string,
  personId: string,
): Promise<boolean> {
  const [staff] = await tx
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.id, personId),
        eq(people.shopId, shopId),
        livePerson(),
        inArray(personRoles.role, [...STAFF_ROLES]),
      ),
    )
    .limit(1);
  return Boolean(staff);
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
    const [eligibleHelper] = await tx
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .innerJoin(
        tripAssignments,
        and(
          eq(tripAssignments.personId, people.id),
          eq(tripAssignments.tripId, existing.request.tripId),
        ),
      )
      .where(
        and(
          eq(people.id, input.helperPersonId),
          eq(people.shopId, input.shopId),
          livePerson(),
          inArray(personRoles.role, [...STAFF_ROLES]),
        ),
      )
      .limit(1)
      .for("share", { of: tripAssignments });
    if (!eligibleHelper) return { ok: false, reason: "invalid_helper" };
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

/** Restore the assigned state only while the same helper is still recorded. */
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
      .select({ id: tripHelpRequests.id })
      .from(tripHelpRequests)
      .where(
        and(
          eq(tripHelpRequests.id, input.requestId),
          eq(tripHelpRequests.revision, input.expectedRevision),
          eq(tripHelpRequests.shopId, input.shopId),
          eq(tripHelpRequests.status, "handled"),
          eq(tripHelpRequests.helperPersonId, input.expectedHelperPersonId),
        ),
      )
      .limit(1)
      .for("update", { of: tripHelpRequests });
    if (!existing) return { ok: false, reason: "invalid_transition" };
    if (!(await isActiveStaff(tx, input.shopId, input.actorPersonId))) {
      return { ok: false, reason: "unavailable" };
    }
    const [request] = await tx
      .update(tripHelpRequests)
      .set({
        revision: sql`${tripHelpRequests.revision} + 1`,
        status: "acknowledged",
        handledAt: null,
        updatedAt: now,
        resolvedByPersonId: input.actorPersonId,
      })
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
