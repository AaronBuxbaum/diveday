import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb } from "./client";
import {
  bookings,
  courseInquiries,
  people,
  personRoles,
  shops,
  tripInvitations,
  trips,
} from "./schema";

export type CreateTripRequestInvitationsInput = {
  shopId: string;
  tripId: string;
  requestIds: string[];
  createdByPersonId: string;
};

/**
 * Adds one pending invitation per selected request. The request is only a
 * contact source: this function never creates a booking or changes capacity.
 * A unique trip/request index makes repeated submissions harmless, including
 * when a staff member retries after a redirect.
 */
export async function createTripRequestInvitations(
  db: AppDb,
  input: CreateTripRequestInvitationsInput,
): Promise<number> {
  const requestIds = [...new Set(input.requestIds)];
  if (requestIds.length === 0) return 0;

  return db.transaction(async (tx) => {
    const [trip] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId)))
      .limit(1);
    if (!trip) return 0;

    const [author] = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, input.createdByPersonId), eq(people.shopId, input.shopId)))
      .limit(1);
    if (!author) return 0;

    const requests = await tx
      .select({ id: courseInquiries.id })
      .from(courseInquiries)
      .where(
        and(eq(courseInquiries.shopId, input.shopId), inArray(courseInquiries.id, requestIds)),
      );
    if (requests.length === 0) return 0;

    const inserted = await tx
      .insert(tripInvitations)
      .values(
        requests.map((request) => ({
          shopId: input.shopId,
          tripId: input.tripId,
          source: "date_request" as const,
          courseInquiryId: request.id,
          createdByPersonId: input.createdByPersonId,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: tripInvitations.id });
    return inserted.length;
  });
}

/** Adds one existing diver as outreach without changing their booking state. */
export async function createDirectTripInvitation(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    personId: string;
    createdByPersonId: string;
  },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [trip] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId)))
      .limit(1);
    if (!trip) return false;

    const [author] = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, input.createdByPersonId), eq(people.shopId, input.shopId)))
      .limit(1);
    if (!author) return false;

    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(
        and(
          eq(people.id, input.personId),
          eq(people.shopId, input.shopId),
          eq(personRoles.role, "diver"),
          isNull(people.deletedAt),
        ),
      )
      .limit(1);
    if (!person) return false;

    const [booking] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.shopId, input.shopId),
          eq(bookings.tripId, input.tripId),
          eq(bookings.personId, input.personId),
          ne(bookings.status, "cancelled"),
        ),
      )
      .limit(1);
    if (booking) return false;

    const inserted = await tx
      .insert(tripInvitations)
      .values({
        shopId: input.shopId,
        tripId: input.tripId,
        source: "direct",
        personId: input.personId,
        createdByPersonId: input.createdByPersonId,
      })
      .onConflictDoNothing()
      .returning({ id: tripInvitations.id });
    return inserted.length > 0;
  });
}

/** The contact projection used by the trip's guests page. */
export async function listTripInvitations(db: AppDb, shopId: string, tripId: string) {
  return db
    .select({ invitation: tripInvitations, request: courseInquiries, person: people })
    .from(tripInvitations)
    .leftJoin(
      courseInquiries,
      and(
        eq(courseInquiries.id, tripInvitations.courseInquiryId),
        eq(courseInquiries.shopId, shopId),
      ),
    )
    .leftJoin(
      people,
      and(
        or(eq(people.id, tripInvitations.personId), eq(people.id, courseInquiries.personId)),
        eq(people.shopId, shopId),
      ),
    )
    .where(and(eq(tripInvitations.shopId, shopId), eq(tripInvitations.tripId, tripId)))
    .orderBy(asc(tripInvitations.createdAt));
}

/** The shop-scoped recipient and trip facts needed to send one invitation. */
export async function getTripInvitation(
  db: AppDb,
  shopId: string,
  tripId: string,
  invitationId: string,
) {
  const [row] = await db
    .select({
      invitation: tripInvitations,
      request: courseInquiries,
      person: people,
      trip: trips,
      shop: shops,
    })
    .from(tripInvitations)
    .innerJoin(trips, and(eq(trips.id, tripInvitations.tripId), eq(trips.shopId, shopId)))
    .innerJoin(shops, eq(shops.id, shopId))
    .leftJoin(
      courseInquiries,
      and(
        eq(courseInquiries.id, tripInvitations.courseInquiryId),
        eq(courseInquiries.shopId, shopId),
      ),
    )
    .leftJoin(
      people,
      and(
        or(eq(people.id, tripInvitations.personId), eq(people.id, courseInquiries.personId)),
        eq(people.shopId, shopId),
      ),
    )
    .where(
      and(
        eq(tripInvitations.id, invitationId),
        eq(tripInvitations.shopId, shopId),
        eq(tripInvitations.tripId, tripId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Records a staff outreach attempt, regardless of whether it used email or a composer. */
export async function recordTripInvitation(
  db: AppDb,
  input: { shopId: string; tripId: string; invitationId: string; now?: Date },
): Promise<boolean> {
  const [updated] = await db
    .update(tripInvitations)
    .set({ invitedAt: input.now ?? nowDate() })
    .where(
      and(
        eq(tripInvitations.id, input.invitationId),
        eq(tripInvitations.shopId, input.shopId),
        eq(tripInvitations.tripId, input.tripId),
      ),
    )
    .returning({ id: tripInvitations.id });
  return Boolean(updated);
}
