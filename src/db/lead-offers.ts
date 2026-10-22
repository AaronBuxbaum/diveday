import { and, eq, gt, isNotNull, isNull, ne, notExists, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { courseSeatCapacity } from "@/lib/course-ratios";
import { offerMailClass } from "@/lib/leads";
import {
  type NotificationDelivery,
  type NotificationProvider,
  publicAppUrl,
  recipientLocale,
} from "@/lib/notifications";
import { diverSeatLimit, seatRefusal } from "@/lib/participant-types";
import { publicTripPath } from "@/lib/public-routes";
import { hasVerifiedCertificationAtLeast } from "@/lib/readiness";
import { courseStudentSeatCap, tripAdmissionFor, tripCourseCrewCounts } from "./bookings";
import type { AppDb, DbExecutor } from "./client";
import { issuePersonCourtesyEmailUnsubscribeToken } from "./courtesy-email";
import { ensureDepartureLead } from "./leads";
import { sendNotification } from "./notifications";
import { recordTripActivity } from "./operations";
import { bookings, certifications, courses, leads, people, shops, trips } from "./schema";
import { livePerson, liveTrip } from "./trips-live";
import { heldSeatCounts, sellableCapacity } from "./trips-queries";

/**
 * **Offer a seat** (ADR 20261017-one-lead-with-a-scope): the one staff act on a
 * departure lead. It reserves nothing and never touches a manifest; the diver
 * books like anyone else from the link, so the booking door's own gates
 * (`readiness.ts`, `trip-admission.ts`) are untouched and an offer can never put
 * an uncleared diver aboard.
 */

/**
 * How one offer reached (or did not reach) the diver. Anything but `sent` hands
 * staff the composer fallback (a prewritten mailto or copy message) rather than
 * pretending mail went out. `opted_out` is a commercial offer to a diver who has
 * turned off courtesy email: no automated send, though staff may still reach
 * them by hand. `already_sent` is a commercial offer the 24-hour window refused.
 */
export type SeatOfferDelivery = "sent" | "fallback" | "opted_out" | "already_sent";

/** How long after its last email a commercial offer may not be emailed again (#2133). */
const OFFER_RESEND_WINDOW_MS = 24 * HOUR_MS;

const parentLead = alias(leads, "parent_lead");

/** The shop-scoped lead, diver, departure and shop facts one offer needs. */
async function getOfferContext(db: AppDb, shopId: string, tripId: string, leadId: string) {
  const [row] = await db
    .select({
      lead: leads,
      parentScope: parentLead.scope,
      person: people,
      trip: trips,
      shop: shops,
    })
    .from(leads)
    .innerJoin(trips, and(eq(trips.id, leads.tripId), eq(trips.shopId, shopId), liveTrip()))
    .innerJoin(shops, eq(shops.id, shopId))
    .leftJoin(parentLead, and(eq(parentLead.id, leads.parentLeadId), eq(parentLead.shopId, shopId)))
    .leftJoin(people, and(eq(people.id, leads.personId), eq(people.shopId, shopId)))
    .where(
      and(
        eq(leads.id, leadId),
        eq(leads.scope, "departure"),
        eq(leads.shopId, shopId),
        eq(leads.tripId, tripId),
      ),
    )
    .limit(1);
  return row ?? null;
}

type OfferContext = NonNullable<Awaited<ReturnType<typeof getOfferContext>>>;

/**
 * Stamp one lead as offered and email the diver — as service mail or as
 * commercial mail, by `offerMailClass` (Aaron, 2026-10-06, issue #1953):
 *
 * - **A reply to a diver's own date request** is `seat_offer`: the diver asked,
 *   so it reaches them whatever their courtesy-email setting, with no
 *   unsubscribe, and is not throttled.
 * - **Every other offer** is `seat_offer_commercial`: it carries a fresh
 *   courtesy unsubscribe link (and with it the shop's postal footer) and is not
 *   sent to a person whose `people.courtesyEmailOptOutAt` is set. The unsubscribe
 *   token is keyed to a person, so a commercial offer to a row with no person
 *   is composer-only.
 *
 * The `offeredAt` stamp is written first in every case: "Offered" is the record
 * that staff reached out, by email or by hand.
 *
 * **A commercial offer is not emailed twice in a day** (Aaron, 2026-10-13, issue
 * #2133). Every send stamps a fresh `offeredAt`, and with it a new unsubscribe
 * token and idempotency key, so the window is held by its own mark, `emailedAt`:
 * a repeat inside `OFFER_RESEND_WINDOW_MS` of the last email is refused before
 * anything is written or sent (`already_sent`, and the composer fallback so
 * staff can still write by hand), and the window does not slide forward on a
 * refusal. The mark is read and taken under one row lock (`claimOfferSend`), so
 * two submits that land together send once, and it is given back when the mail
 * does not go (`releaseOfferSend`), so a failed send or a missing address never
 * locks the diver out.
 */
export async function deliverSeatOffer(
  db: AppDb,
  input: {
    shopId: string;
    shopSlug: string;
    tripId: string;
    leadId: string;
    /**
     * The run's date this lead waited for, when the nightly roll moved them
     * here: the offer says it filled and this date has room (fourth review,
     * item 31).
     */
    sailedStartsAt?: Date;
    now?: Date;
  },
  provider?: NotificationProvider,
): Promise<SeatOfferDelivery> {
  const context = await getOfferContext(db, input.shopId, input.tripId, input.leadId);
  if (!context) return "fallback";
  const mailClass = offerMailClass({
    scope: context.lead.scope,
    askedBy: context.lead.askedBy,
    parentScope: context.parentScope,
    carriesDeal: context.lead.promoId !== null,
  });
  if (mailClass === "commercial") {
    const claim = await claimOfferSend(db, input.shopId, input.leadId, input.now);
    if (!claim) return "already_sent";
    return sendClaimedOffer(db, input, context, claim, provider);
  }
  const offeredAt = input.now ?? nowDate();
  const [stamped] = await db
    .update(leads)
    .set({ offeredAt })
    .where(and(eq(leads.id, input.leadId), eq(leads.shopId, input.shopId)))
    .returning({ id: leads.id });
  if (!stamped) return "fallback";
  return (await sendOffer(db, input, context, offeredAt, provider)).delivery;
}

export type SeatOffersOutcome = {
  results: { leadId: string; delivery: SeatOfferDelivery }[];
};

/**
 * **The held send's body**: offer a seat to each lead staff ticked, one email
 * apiece. One lead never fails the rest: each answers for itself, and anything
 * but `sent` is the composer fallback on that row. Every lead is read inside
 * this shop and this departure, so an id from another shop or another trip is
 * `fallback` and nothing is written.
 */
export async function offerSeats(
  db: AppDb,
  input: { shopId: string; shopSlug: string; tripId: string; leadIds: string[] },
  provider?: NotificationProvider,
): Promise<SeatOffersOutcome> {
  const results: SeatOffersOutcome["results"] = [];
  for (const leadId of new Set(input.leadIds)) {
    results.push({
      leadId,
      delivery: await deliverSeatOffer(db, { ...input, leadId }, provider),
    });
  }
  return { results };
}

/**
 * A commercial offer's send under its claim, given back when the mail does not
 * go. A retryable failure keeps it: that mail is on the retry queue and will
 * still go, so a second submit inside the window would send a second (#2133).
 */
async function sendClaimedOffer(
  db: AppDb,
  input: { shopId: string; shopSlug: string; leadId: string; sailedStartsAt?: Date },
  context: OfferContext,
  claim: OfferSendClaim,
  provider: NotificationProvider | undefined,
): Promise<SeatOfferDelivery> {
  let send: OfferSend = { delivery: "fallback", queued: false };
  try {
    send = await sendOffer(db, input, context, claim.at, provider);
  } finally {
    if (send.delivery !== "sent" && !send.queued) {
      await releaseOfferSend(db, input.shopId, input.leadId, claim);
    }
  }
  return send.delivery;
}

/** The send's answer, and whether its mail is queued to go later. */
type OfferSend = { delivery: SeatOfferDelivery; queued: boolean };

/** The send itself, once the stamp (and for a commercial offer, the claim) is written. */
async function sendOffer(
  db: AppDb,
  input: { shopId: string; shopSlug: string; sailedStartsAt?: Date },
  context: OfferContext,
  offeredAt: Date,
  provider: NotificationProvider | undefined,
): Promise<OfferSend> {
  const origin = publicAppUrl();
  const { lead, person, trip, shop } = context;
  const to = person?.email ?? lead.email;
  // A record deleted since the lead was made is not somebody to sell a seat to
  // (`findCourtesyEmailRecipientByAddress` is blind to them too).
  if (!to || !origin || person?.deletedAt) return { delivery: "fallback", queued: false };
  const shared = {
    leadId: lead.id,
    shopId: input.shopId,
    to,
    locale: recipientLocale(person?.locale, shop.defaultLocale),
    diverName: person?.fullName ?? lead.name ?? "Diver",
    shopName: shop.name,
    tripTitle: trip.title,
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    timezone: shop.timezone,
    bookingUrl: new URL(publicTripPath(input.shopSlug, trip.id), `${origin}/`).toString(),
    offeredAt,
  };
  const mailClass = offerMailClass({
    scope: lead.scope,
    askedBy: lead.askedBy,
    parentScope: context.parentScope,
    carriesDeal: lead.promoId !== null,
  });
  if (mailClass === "service") {
    return sendOf(await sendNotification(db, { ...shared, kind: "seat_offer" }, provider));
  }
  if (!person) return { delivery: "fallback", queued: false };
  // Before anything about the send itself: a diver who opted out is
  // `opted_out` whether or not this deployment could have emailed them.
  if (person.courtesyEmailOptOutAt) return { delivery: "opted_out", queued: false };
  const unsubscribeToken = await issuePersonCourtesyEmailUnsubscribeToken(db, {
    shopId: input.shopId,
    personId: person.id,
  });
  // A course session's offer carries the course's prerequisite note, so it never
  // implies the diver already qualifies (dive-domain review N3).
  const [course] = trip.courseId
    ? await db
        .select({ prerequisiteNote: courses.prerequisiteNote })
        .from(courses)
        .where(and(eq(courses.id, trip.courseId), eq(courses.shopId, input.shopId)))
        .limit(1)
    : [];
  const prerequisiteNote = course?.prerequisiteNote?.trim().slice(0, 2_000) || undefined;
  const delivery = await sendNotification(
    db,
    {
      ...shared,
      kind: "seat_offer_commercial",
      askedBy: lead.askedBy,
      unsubscribeUrl: new URL(`/unsubscribe/${unsubscribeToken}`, `${origin}/`).toString(),
      partySize: lead.partySize ?? undefined,
      ...(input.sailedStartsAt ? { sailedStartsAt: input.sailedStartsAt } : {}),
      prerequisiteNote,
    },
    provider,
  ).catch(() => ({ status: "failed" as const, retryable: false }));
  return sendOf(delivery);
}

/** A delivery read as a send: a retryable failure is on the retry queue (`sendNotification`). */
function sendOf(delivery: NotificationDelivery): OfferSend {
  if (delivery.status === "sent") return { delivery: "sent", queued: false };
  return {
    delivery: "fallback",
    queued: delivery.status === "failed" && delivery.retryable === true,
  };
}

/** A commercial offer's taken send: the mark it wrote, and the one it replaced. */
type OfferSendClaim = { at: Date; previous: Date | null };

/**
 * **Take a commercial offer's send, or learn it is not this call's** (#2133).
 * The row is locked, read and marked in one transaction, so two submits that
 * land together cannot both pass the window: the second waits for the first's
 * mark and is refused. The claim writes both `emailedAt` (the window) and
 * `offeredAt` ("Offered").
 */
async function claimOfferSend(
  db: AppDb,
  shopId: string,
  leadId: string,
  at?: Date,
): Promise<OfferSendClaim | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ emailedAt: leads.emailedAt })
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.shopId, shopId), eq(leads.scope, "departure")))
      .limit(1)
      .for("update");
    if (!row) return null;
    const now = at ?? nowDate();
    if (row.emailedAt && now.getTime() - row.emailedAt.getTime() < OFFER_RESEND_WINDOW_MS) {
      return null;
    }
    await tx
      .update(leads)
      .set({ emailedAt: now, offeredAt: now })
      .where(and(eq(leads.id, leadId), eq(leads.shopId, shopId)));
    return { at: now, previous: row.emailedAt };
  });
}

/**
 * Give the claim back after mail that did not go: the window goes back to the
 * last email that did, only while the mark is still this claim's. `offeredAt`
 * stays, because "Offered" is still true (staff reach the diver by hand).
 */
async function releaseOfferSend(db: AppDb, shopId: string, leadId: string, claim: OfferSendClaim) {
  await db
    .update(leads)
    .set({ emailedAt: claim.previous })
    .where(and(eq(leads.id, leadId), eq(leads.shopId, shopId), eq(leads.emailedAt, claim.at)));
}

/**
 * **How many offers this departure can honor right now.** Measured as a seat is
 * measured when it is sold (`createBookingRecord`, `moveBooking`): the boat's
 * sellable seats, the divers-only limit, and for a course session the instructor
 * it needs and the ratio its crew allows. A lead asks for a diver's seat, so the
 * divers-only limit binds. Every offer already out to someone who has not taken a
 * seat holds as many of those seats as their party asked for, so they are taken
 * off. **An offer that carries a deal does not count** (ADR
 * 20261017-one-lead-with-a-scope, R2): one blast to forty people must not push a
 * three-seat departure to "0 invitable" and stop the roll inviting real
 * wait-listers. Advice for whom to offer, never a gate: the seat is still
 * measured under the trip's lock when the diver books. Exported for its test
 * (agency review G5 of #2226).
 */
export async function invitableSeats(db: AppDb, trip: typeof trips.$inferSelect): Promise<number> {
  const held = await heldSeatCounts(db, trip.shopId, trip.id);
  let room = (await sellableCapacity(db, trip)) - held.aboard;
  const diverLimit = diverSeatLimit(trip);
  if (diverLimit !== null) room = Math.min(room, diverLimit - held.divers);
  // The students, its divers: a priced rider is a passenger (G5 of #2226).
  const ratioCap = await courseStudentSeatCap(db, trip);
  if (ratioCap !== null) room = Math.min(room, ratioCap - held.divers);
  const [outstanding] = await db
    .select({ offered: sql<number>`coalesce(sum(${leads.partySize}), 0)::int` })
    .from(leads)
    .where(
      and(
        eq(leads.scope, "departure"),
        eq(leads.shopId, trip.shopId),
        eq(leads.tripId, trip.id),
        isNotNull(leads.offeredAt),
        isNull(leads.promoId),
        notExists(
          db
            .select({ id: bookings.id })
            .from(bookings)
            .where(
              and(
                eq(bookings.tripId, trip.id),
                eq(bookings.personId, leads.personId),
                ne(bookings.status, "cancelled"),
              ),
            ),
        ),
      ),
    );
  return Math.max(0, room - (outstanding?.offered ?? 0));
}

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
    // The students, its divers: a priced rider is a passenger (G5 of #2226).
    if (seatCap !== null && held.divers >= seatCap) return false;
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
 *
 * **"Email them this date"** on the counter's no-show panel (UX review
 * 2026-10-11, item 14). The desk already knows the fix for the diver who missed
 * the boat, another departure with room, and this sends it in one tap: a shop
 * lead for that departure, delivered the way every offer is (`deliverSeatOffer`),
 * so the diver books the seat themselves from the link. It stays immediate
 * (ADR 20260906-before-you-ask named only four held sends): one diver at a
 * counter. Nothing is seated and nothing is charged.
 *
 * A lead already standing for this diver and departure is offered again rather
 * than refused, so a second tap after "no email" was fixed works. An offer is
 * commercial, so it takes the same claim: mail to this diver for this departure
 * that went out in the last 24 hours answers `already_sent` and sends nothing
 * (#2133, and #2480's double tap at a busy counter is one email, not two). A
 * send that did not go gives its claim back, so a fallback never blocks the
 * retry. The `departure_offered` line goes on the departure's trail only on a
 * sent delivery. `unavailable` covers every reason there is nothing to offer:
 * the departure is gone or full, the diver could not book it
 * (`departureOpenToDiver`), or the person is not this shop's diver. Nothing is
 * written or sent then.
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
): Promise<SeatOfferDelivery | "unavailable"> {
  if (!(await departureOpenToDiver(db, input))) return "unavailable";
  const lead = await ensureDepartureLead(db, input);
  if (!lead) return "unavailable";
  const delivery = await deliverSeatOffer(
    db,
    {
      shopId: input.shopId,
      shopSlug: input.shopSlug,
      tripId: input.tripId,
      leadId: lead.leadId,
    },
    provider,
  );
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
