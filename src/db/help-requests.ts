import { and, asc, eq, gt, inArray, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb } from "./client";
import { recordDeskEvent } from "./desk-events";
import { bookings, people, tripHelpRequests, trips } from "./schema";

export type HelpRequestKind = (typeof tripHelpRequests.kind.enumValues)[number];
export type HelpRequestStatus = (typeof tripHelpRequests.status.enumValues)[number];
const activeStatuses = ["requested", "acknowledged"] as const;

export type HelpRequest = {
  id: string;
  shopId: string;
  tripId: string;
  bookingId: string;
  kind: HelpRequestKind;
  status: HelpRequestStatus;
  createdAt: Date;
  acknowledgedAt: Date | null;
  handledAt: Date | null;
};

export type TodayHelpRequest = Omit<HelpRequest, "status"> & {
  status: (typeof activeStatuses)[number];
  personName: string;
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
    .select({ request: tripHelpRequests })
    .from(tripHelpRequests)
    .innerJoin(bookings, eq(bookings.id, tripHelpRequests.bookingId))
    .innerJoin(trips, eq(trips.id, tripHelpRequests.tripId))
    .where(
      and(
        eq(tripHelpRequests.shopId, shopId),
        eq(tripHelpRequests.bookingId, bookingId),
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripHelpRequests.tripId),
        eq(trips.shopId, shopId),
        ne(tripHelpRequests.status, "withdrawn"),
        ne(bookings.status, "cancelled"),
        eq(trips.status, "scheduled"),
        gt(trips.endsAt, now),
      ),
    )
    .limit(1);
  return row?.request ?? null;
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
    .select({ request: tripHelpRequests, personName: people.fullName, trip: trips })
    .from(tripHelpRequests)
    .innerJoin(bookings, eq(bookings.id, tripHelpRequests.bookingId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, tripHelpRequests.tripId))
    .where(
      and(
        eq(tripHelpRequests.shopId, shopId),
        inArray(tripHelpRequests.tripId, tripIds),
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripHelpRequests.tripId),
        eq(people.shopId, shopId),
        eq(trips.shopId, shopId),
        inArray(tripHelpRequests.status, [...activeStatuses]),
        ne(bookings.status, "cancelled"),
        eq(trips.status, "scheduled"),
        gt(trips.endsAt, now),
      ),
    )
    .orderBy(asc(trips.startsAt), asc(tripHelpRequests.createdAt), asc(tripHelpRequests.id));
  return rows.map(({ request, personName, trip }) => ({
    ...request,
    // The query is explicitly restricted to `activeStatuses`; keep that
    // invariant in the returned type so Today cannot expose a handled or
    // withdrawn request as an actionable row.
    status: request.status as TodayHelpRequest["status"],
    personName,
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
          eq(bookings.tripId, trips.id),
          ne(bookings.status, "cancelled"),
          eq(trips.status, "scheduled"),
          gt(trips.endsAt, now),
        ),
      )
      .limit(1);
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
      .for("update");
    if (existing?.status === "handled") return { ok: false, reason: "handled" };

    if (input.kind === "none") {
      if (!existing) return { ok: true, request: null };
      const [updated] = await tx
        .update(tripHelpRequests)
        .set({
          status: "withdrawn",
          updatedAt: now,
          acknowledgedAt: null,
          handledAt: null,
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
            kind: input.kind,
            status: "requested",
            updatedAt: now,
            acknowledgedAt: null,
            handledAt: null,
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

export type UpdateHelpRequestResult =
  | { ok: true; request: HelpRequest }
  | { ok: false; reason: "unavailable" | "invalid_transition" };

/** Staff's visible acknowledgement/handled transition, scoped to one shop. */
export async function updateHelpRequestStatus(
  db: AppDb,
  input: {
    shopId: string;
    requestId: string;
    status: "acknowledged" | "handled";
    actorPersonId: string;
    now?: Date;
  },
): Promise<UpdateHelpRequestResult> {
  const now = input.now ?? nowDate();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ request: tripHelpRequests })
      .from(tripHelpRequests)
      .innerJoin(bookings, eq(bookings.id, tripHelpRequests.bookingId))
      .innerJoin(people, eq(people.id, bookings.personId))
      .innerJoin(trips, eq(trips.id, tripHelpRequests.tripId))
      .where(
        and(
          eq(tripHelpRequests.id, input.requestId),
          eq(tripHelpRequests.shopId, input.shopId),
          eq(bookings.shopId, input.shopId),
          eq(bookings.tripId, tripHelpRequests.tripId),
          eq(trips.shopId, input.shopId),
          eq(people.shopId, input.shopId),
          inArray(tripHelpRequests.status, [...activeStatuses]),
          ne(bookings.status, "cancelled"),
          eq(trips.status, "scheduled"),
          gt(trips.endsAt, now),
        ),
      )
      .limit(1)
      .for("update");
    if (!existing) return { ok: false, reason: "unavailable" };
    if (
      (input.status === "acknowledged" && existing.request.status !== "requested") ||
      (input.status === "handled" && existing.request.status !== "acknowledged")
    ) {
      return { ok: false, reason: "invalid_transition" };
    }
    const [actor] = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, input.actorPersonId), eq(people.shopId, input.shopId)))
      .limit(1);
    if (!actor) return { ok: false, reason: "unavailable" };
    const [request] = await tx
      .update(tripHelpRequests)
      .set({
        status: input.status,
        updatedAt: now,
        acknowledgedAt:
          input.status === "acknowledged" ? now : (existing.request.acknowledgedAt ?? now),
        handledAt: input.status === "handled" ? now : null,
        resolvedByPersonId: input.actorPersonId,
      })
      .where(eq(tripHelpRequests.id, input.requestId))
      .returning();
    return request ? { ok: true, request } : { ok: false, reason: "unavailable" };
  });
}
