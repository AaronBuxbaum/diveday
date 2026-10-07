import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { publicAppUrl, recipientLocale } from "@/lib/notifications";
import { publicTripPath } from "@/lib/public-routes";
import type { AppDb } from "./client";
import { issuePersonCourtesyEmailUnsubscribeToken } from "./courtesy-email";
import { sendNotification } from "./notifications";
import {
  bookings,
  courseInquiries,
  people,
  personRoles,
  shops,
  tripInvitations,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";

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
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
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
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
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
async function getTripInvitation(db: AppDb, shopId: string, tripId: string, invitationId: string) {
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

/**
 * How one invitation reached (or did not reach) the diver. Anything but `sent`
 * hands staff the composer fallback rather than pretending mail went out — the
 * mirror of `WaitlistInviteDelivery`. `opted_out` is a cold invitation to a
 * diver who has turned off courtesy email: no automated send, though staff may
 * still reach them by hand.
 */
export type TripInvitationDelivery = "sent" | "fallback" | "opted_out";

/**
 * Stamp one invitation as contacted and email it — as service mail or as
 * commercial mail, by where the invitation came from (Aaron, 2026-10-06, issue
 * #1953):
 *
 * - **A reply to a diver's own date request** (`date_request`) is
 *   `trip_invitation`: the diver asked, so it reaches them whatever their
 *   courtesy-email setting, with no unsubscribe.
 * - **A cold invitation** (`direct`) is `direct_trip_invitation`: commercial,
 *   so it carries a fresh courtesy unsubscribe link (and with it the shop's
 *   postal footer) and is not sent to a person whose
 *   `people.courtesyEmailOptOutAt` is set. A direct invitation always names a
 *   person (`trip_invitations_source_reference_check`), which is what lets the
 *   unsubscribe link be required: the token is keyed to that person.
 *
 * The stamp is written first in every case, as it always was: "Contacted" is
 * the record that staff reached out, by email or by hand.
 */
export async function deliverTripInvitation(
  db: AppDb,
  input: { shopId: string; shopSlug: string; tripId: string; invitationId: string },
): Promise<TripInvitationDelivery> {
  const context = await getTripInvitation(db, input.shopId, input.tripId, input.invitationId);
  if (!context) return "fallback";
  const invitedAt = nowDate();
  const recorded = await recordTripInvitation(db, {
    shopId: input.shopId,
    tripId: input.tripId,
    invitationId: input.invitationId,
    now: invitedAt,
  });
  if (!recorded) return "fallback";
  const origin = publicAppUrl();
  const shared = {
    invitationId: context.invitation.id,
    shopId: input.shopId,
    shopName: context.shop.name,
    tripTitle: context.trip.title,
    startsAt: context.trip.startsAt,
    endsAt: context.trip.endsAt,
    timezone: context.shop.timezone,
    invitedAt,
  };

  if (context.invitation.source === "direct") {
    const person = context.person;
    // A record deleted since the invitation was made is not somebody to sell
    // a seat to (`findCourtesyEmailRecipientByAddress` is blind to them too).
    if (!person?.email || person.deletedAt) return "fallback";
    // Before anything about the send itself: a diver who opted out is
    // `opted_out` whether or not this deployment could have emailed them.
    if (person.courtesyEmailOptOutAt) return "opted_out";
    if (!origin) return "fallback";
    const unsubscribeToken = await issuePersonCourtesyEmailUnsubscribeToken(db, {
      shopId: input.shopId,
      personId: person.id,
    });
    const delivery = await sendNotification(db, {
      ...shared,
      kind: "direct_trip_invitation",
      to: person.email,
      locale: recipientLocale(person.locale, context.shop.defaultLocale),
      diverName: person.fullName,
      bookingUrl: new URL(publicTripPath(input.shopSlug, context.trip.id), `${origin}/`).toString(),
      unsubscribeUrl: new URL(`/unsubscribe/${unsubscribeToken}`, `${origin}/`).toString(),
    });
    return delivery.status === "sent" ? "sent" : "fallback";
  }

  const email = context.person?.email ?? context.request?.email ?? null;
  if (!email || !origin) return "fallback";
  const delivery = await sendNotification(db, {
    ...shared,
    kind: "trip_invitation",
    to: email,
    locale: recipientLocale(context.person?.locale, context.shop.defaultLocale),
    diverName: context.person?.fullName ?? context.request?.name ?? "Diver",
    bookingUrl: new URL(publicTripPath(input.shopSlug, context.trip.id), `${origin}/`).toString(),
  });
  return delivery.status === "sent" ? "sent" : "fallback";
}
