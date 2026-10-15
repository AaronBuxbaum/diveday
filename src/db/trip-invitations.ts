import { and, asc, eq, gt, gte, inArray, isNull, notInArray, or } from "drizzle-orm";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { courseSeatCapacity } from "@/lib/course-ratios";
import { rowCanBeReactivated } from "@/lib/no-show";
import { type NotificationProvider, publicAppUrl, recipientLocale } from "@/lib/notifications";
import { seatRefusal } from "@/lib/participant-types";
import { publicTripPath } from "@/lib/public-routes";
import { hasVerifiedCertificationAtLeast } from "@/lib/readiness";
import { tripAdmissionFor, tripCourseCrewCounts } from "./bookings";
import type { AppDb, DbExecutor } from "./client";
import { issuePersonCourtesyEmailUnsubscribeToken } from "./courtesy-email";
import { sendNotification } from "./notifications";
import { recordTripActivity } from "./operations";
import {
  activityEvents,
  bookings,
  certifications,
  courseInquiries,
  courses,
  people,
  personRoles,
  shops,
  tripInvitations,
  trips,
} from "./schema";
import { livePerson, liveTrip } from "./trips-live";
import { heldSeatCounts, sellableCapacity } from "./trips-queries";

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
      .select({ id: trips.id, startsAt: trips.startsAt })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
      .limit(1);
    if (!trip) return 0;

    const [author] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(eq(people.id, input.createdByPersonId), eq(people.shopId, input.shopId), livePerson()),
      )
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
      .select({ id: trips.id, startsAt: trips.startsAt })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
      .limit(1);
    if (!trip) return false;

    const [author] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(eq(people.id, input.createdByPersonId), eq(people.shopId, input.shopId), livePerson()),
      )
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
      .select({ status: bookings.status })
      .from(bookings)
      .where(
        and(
          eq(bookings.shopId, input.shopId),
          eq(bookings.tripId, input.tripId),
          eq(bookings.personId, input.personId),
        ),
      )
      .limit(1);
    if (booking && !rowCanBeReactivated(booking.status, trip.startsAt)) return false;

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
  input: {
    shopId: string;
    shopSlug: string;
    tripId: string;
    invitationId: string;
    /** The stamp to write; an offer passes the one its claim took. */
    invitedAt?: Date;
  },
  provider?: NotificationProvider,
): Promise<TripInvitationDelivery> {
  const context = await getTripInvitation(db, input.shopId, input.tripId, input.invitationId);
  if (!context) return "fallback";
  const invitedAt = input.invitedAt ?? nowDate();
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
    const delivery = await sendNotification(
      db,
      {
        ...shared,
        kind: "direct_trip_invitation",
        to: person.email,
        locale: recipientLocale(person.locale, context.shop.defaultLocale),
        diverName: person.fullName,
        bookingUrl: new URL(
          publicTripPath(input.shopSlug, context.trip.id),
          `${origin}/`,
        ).toString(),
        unsubscribeUrl: new URL(`/unsubscribe/${unsubscribeToken}`, `${origin}/`).toString(),
      },
      provider,
    );
    return delivery.status === "sent" ? "sent" : "fallback";
  }

  const email = context.person?.email ?? context.request?.email ?? null;
  if (!email || !origin) return "fallback";
  const delivery = await sendNotification(
    db,
    {
      ...shared,
      kind: "trip_invitation",
      to: email,
      locale: recipientLocale(context.person?.locale, context.shop.defaultLocale),
      diverName: context.person?.fullName ?? context.request?.name ?? "Diver",
      bookingUrl: new URL(publicTripPath(input.shopSlug, context.trip.id), `${origin}/`).toString(),
    },
    provider,
  );
  return delivery.status === "sent" ? "sent" : "fallback";
}

/**
 * **"Email them this date"** on the counter's no-show panel (UX review
 * 2026-10-11, item 14). The desk already knows the fix for the diver who
 * missed the boat — another departure with room — and this sends it to them
 * in one tap: a direct invitation to that departure, delivered the way every
 * direct invitation is (`deliverTripInvitation`), so the diver books the seat
 * themselves from the link and a diver who turned off shop email is not
 * emailed. Nothing is seated and nothing is charged.
 *
 * An invitation already standing for this diver and departure is sent again
 * rather than refused, so a second tap after "no email" was fixed works. Mail
 * that did go out under an hour ago answers `already_sent` and sends nothing
 * (#2480): a double tap at a busy counter is one email, not two. "Did go out"
 * is the `departure_offered` line on the departure's trail, written only on a
 * sent delivery, so a fallback never blocks the retry.
 * `unavailable` covers every reason there is nothing to offer: the departure
 * is gone or full, the diver could not book it (`departureOpenToDiver`), or
 * the person is not this shop's diver. Nothing is written or sent then.
 */
/**
 * **Could this diver book this departure from a link right now?** The
 * no-show's "another day" names a departure and promises the diver can take
 * it (dive-domain review of layer 8, F1), so both the panel that lists the
 * days and the act that sends one ask this first.
 *
 * The same refusals the booking transaction would give the diver, read
 * without its locks: a departure that is cancelled, held for conditions,
 * private or already gone; no sellable seat (`seatRefusal` over
 * `sellableCapacity`, the certificate's cap included); a course session with
 * no instructor, at its ratio cap, or asking a verified card the diver lacks;
 * and the trip's own admission gate (`tripAdmissionFor`) on the diver's
 * evidence. "Already gone" is the scheduled time, not `hasSailed`'s grace: the
 * diver books later, from an email.
 *
 * Any live booking row on it refuses too: `bookings` is unique on (trip,
 * person) and the booking form answers `already_booked` for a row it cannot
 * reactivate. A cancelled row and a no-show on a departure still ahead can be
 * booked again, so they do not refuse (#2484, `rowCanBeReactivated`).
 */
export async function departureOpenToDiver(
  db: DbExecutor,
  input: { shopId: string; tripId: string; personId: string; now?: Date },
): Promise<boolean> {
  const now = input.now ?? nowDate();
  const [trip] = await db
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.id, input.tripId),
        eq(trips.shopId, input.shopId),
        eq(trips.status, "scheduled"),
        eq(trips.isPrivate, false),
        gt(trips.startsAt, now),
        liveTrip(),
      ),
    )
    .limit(1);
  if (!trip || trip.conditionsHold) return false;

  const [row] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.tripId, trip.id),
        eq(bookings.personId, input.personId),
        // A cancelled row, or a no-show on a departure still ahead, can be
        // booked again (`rowCanBeReactivated`); the departure is future here.
        notInArray(bookings.status, ["cancelled", "no_show"]),
      ),
    )
    .limit(1);
  if (row) return false;

  const held = await heldSeatCounts(db, input.shopId, trip.id);
  if (seatRefusal("diver", { ...trip, capacity: await sellableCapacity(db, trip) }, held)) {
    return false;
  }

  if (trip.courseId) {
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.id, trip.courseId), eq(courses.shopId, input.shopId)))
      .limit(1);
    if (!course) return false;
    const { instructorCount, assistantCount } = await tripCourseCrewCounts(db, trip.id);
    if (instructorCount === 0) return false;
    const seatCap = courseSeatCapacity(course, instructorCount, assistantCount);
    if (seatCap !== null && held.aboard >= seatCap) return false;
    if (course.minimumCertificationLevel) {
      const cards = await db
        .select()
        .from(certifications)
        .where(
          and(
            eq(certifications.shopId, input.shopId),
            eq(certifications.personId, input.personId),
            isNull(certifications.deletedAt),
          ),
        );
      if (!hasVerifiedCertificationAtLeast(cards, course.minimumCertificationLevel)) return false;
    }
  }

  const admission = await tripAdmissionFor(
    db,
    input.shopId,
    trip.id,
    { id: input.personId },
    false,
    Boolean(trip.courseId),
  );
  return admission.admitted;
}

/**
 * **Email only, by decision** (Aaron, 2026-10-13, #2476): this is a commercial
 * message and no per-channel marketing consent exists, so a diver with a phone
 * and no email is not reached and the counter sees "not sent". SMS or WhatsApp
 * waits for that consent field; do not route this through `courtesy.ts`'s
 * transactional channel choice in the meantime.
 */
export async function offerDepartureToDiver(
  db: AppDb,
  input: {
    shopId: string;
    shopSlug: string;
    tripId: string;
    personId: string;
    createdByPersonId: string;
  },
  provider?: NotificationProvider,
): Promise<TripInvitationDelivery | "unavailable" | "already_sent"> {
  if (!(await departureOpenToDiver(db, input))) return "unavailable";
  await createDirectTripInvitation(db, input);
  const [standing] = await db
    .select({ id: tripInvitations.id, invitedAt: tripInvitations.invitedAt })
    .from(tripInvitations)
    .innerJoin(trips, eq(trips.id, tripInvitations.tripId))
    .where(
      and(
        eq(tripInvitations.shopId, input.shopId),
        eq(tripInvitations.tripId, input.tripId),
        eq(tripInvitations.personId, input.personId),
        eq(tripInvitations.source, "direct"),
        liveTrip(),
      ),
    )
    .limit(1);
  if (!standing) return "unavailable";
  const claimedAt = await claimOffer(db, input, standing.id);
  if (!claimedAt) return "already_sent";
  const delivery = await deliverTripInvitation(
    db,
    {
      shopId: input.shopId,
      shopSlug: input.shopSlug,
      tripId: input.tripId,
      invitationId: standing.id,
      invitedAt: claimedAt,
    },
    provider,
  );
  if (delivery !== "sent") await releaseOffer(db, input.shopId, standing.id, claimedAt);
  if (delivery === "sent") {
    const [diver] = await db
      .select({ fullName: people.fullName })
      .from(people)
      .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId), livePerson()))
      .limit(1);
    await recordTripActivity(db, {
      shopId: input.shopId,
      tripId: input.tripId,
      actorPersonId: input.createdByPersonId,
      subjectPersonId: input.personId,
      entry: { code: "departure_offered", diver: diver?.fullName ?? "" },
    });
  }
  return delivery;
}

/**
 * How long a fresh stamp with no "offered" line yet is an offer still
 * sending. A second tap inside it is the same tap; a send takes seconds.
 */
const OFFER_IN_FLIGHT_MS = 2 * 60_000;

/**
 * **Take the offer's send, or learn it is not this tap's** (#2480). The
 * invitation row is locked, read, and stamped in one transaction, so two taps
 * that land together cannot both pass: the second waits for the first's
 * stamp and finds it in flight. Refused when mail already went within the
 * hour, or another tap is sending now. Returns the stamp the send writes.
 */
async function claimOffer(
  db: AppDb,
  input: { shopId: string; tripId: string; personId: string },
  invitationId: string,
): Promise<Date | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ invitedAt: tripInvitations.invitedAt })
      .from(tripInvitations)
      .where(and(eq(tripInvitations.id, invitationId), eq(tripInvitations.shopId, input.shopId)))
      .limit(1)
      .for("update");
    if (!row) return null;
    const now = nowDate();
    if (row.invitedAt) {
      if (now.getTime() - row.invitedAt.getTime() < OFFER_IN_FLIGHT_MS) {
        // Inside the window: a send still going, or one that already went.
        return null;
      }
      if (await offerSentSince(tx, input, row.invitedAt)) return null;
    }
    await tx
      .update(tripInvitations)
      .set({ invitedAt: now })
      .where(and(eq(tripInvitations.id, invitationId), eq(tripInvitations.shopId, input.shopId)));
    return now;
  });
}

/**
 * Give the claim back after mail that did not go. The stamp stays, because
 * "Contacted" is still true (staff reach the diver by hand), but it moves to
 * just outside the in-flight window so the next tap may try again; only while
 * it is still this claim's.
 */
async function releaseOffer(db: AppDb, shopId: string, invitationId: string, claimedAt: Date) {
  await db
    .update(tripInvitations)
    .set({ invitedAt: new Date(claimedAt.getTime() - OFFER_IN_FLIGHT_MS) })
    .where(
      and(
        eq(tripInvitations.id, invitationId),
        eq(tripInvitations.shopId, shopId),
        eq(tripInvitations.invitedAt, claimedAt),
      ),
    );
}

/**
 * Whether this departure's offer reached this diver by email at or after the
 * standing invitation's last stamp, and under an hour ago. The stamp is
 * written before the send and the trail line only after a sent one, so a
 * last attempt that fell back has no line after its stamp.
 */
async function offerSentSince(
  db: DbExecutor,
  input: { shopId: string; tripId: string; personId: string },
  invitedAt: Date,
): Promise<boolean> {
  const hourAgo = new Date(nowDate().getTime() - HOUR_MS);
  if (invitedAt.getTime() < hourAgo.getTime()) return false;
  const [line] = await db
    .select({ id: activityEvents.id })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.shopId, input.shopId),
        eq(activityEvents.tripId, input.tripId),
        eq(activityEvents.subjectPersonId, input.personId),
        eq(activityEvents.code, "departure_offered"),
        gte(activityEvents.occurredAt, invitedAt),
        gte(activityEvents.occurredAt, hourAgo),
      ),
    )
    .limit(1);
  return Boolean(line);
}
