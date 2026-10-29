"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonOverrideCertBlock, canPersonRefund } from "@/db/authz";
import { sendBookingCancelledNotice } from "@/db/booking-cancelled-notice";
import {
  restoreBooking,
  setBookingDietaryNote,
  setBookingParticipantType,
  setBookingPickupDetails,
} from "@/db/bookings";
import { getDb } from "@/db/client";
import { deliverSeatOffer, type SeatOfferDelivery } from "@/db/interest-offers";
import { carryInterests } from "@/db/interest-roll";
import {
  askForDeparture,
  askForDepartureAsKnownDiver,
  type DepartureAskOutcome,
  ensureDepartureInterest,
} from "@/db/interests";
import { createInvitationUnderCooldown } from "@/db/invite-suggestions";
import { getBookingPayment } from "@/db/payments";
import { refundBookingOnCancellation } from "@/db/refunds";
import { type MoveSeatRefusal, moveSeat } from "@/db/seat-diver";
import { recordShopActivity } from "@/db/shop-activity";
import { shopHasFeatureOn } from "@/db/shops";
import { trackEvent } from "@/lib/analytics";
import { nowDate } from "@/lib/clock";
import { blankAsAbsent, parseForm, readForm, single, text } from "@/lib/form-parse";
import { DIETARY_NOTE_MAX } from "@/lib/lunch-aboard";
import { revalidateAndRedirect } from "@/lib/navigation";
import { PARTICIPANT_TYPES } from "@/lib/participant-types";
import { isCapturedPaymentStatus } from "@/lib/payment-source";
import { diverEmailSchema, diverNameSchema, diverPhoneSchema } from "@/lib/person-fields";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { signTripAdmissionGate } from "@/lib/trip-admission-gate";
import { uuidParam } from "@/lib/uuid";
import { refundNotice } from "./refund-notice";
import { removeSeat, requireRosterBooking, tripPath } from "./roster-booking";

/**
 * Wait-listing still parses its own submission here: it is a different
 * mutation (`askForDeparture`) with its own outcomes, and it shares only the
 * form. Seating a diver — hand-entered or picked — goes through the shared
 * `seatNewDiverAction`/`seatExistingDiverAction` (src/app/actions/seat-diver.ts)
 * so every door owes the same consequences.
 */
const addDiverSchema = z.object({
  // Shared diver person-field bounds (src/lib/person-fields.ts).
  fullName: single(diverNameSchema),
  email: single(diverEmailSchema),
  phone: blankAsAbsent(diverPhoneSchema),
});

const offerToDiverSchema = z.object({ personId: single(z.uuid()) });

const rosterBookingForm = z.object({ bookingId: text() });

/**
 * A wait-list refusal's `?notice=` code. `already_waitlisted` never reaches this
 * table — a repeat joiner is answered as success above, deliberately — but it is
 * spelled out because the union contains it, and a table that quietly omitted an
 * arm would be the ladder this replaced.
 */
const WAITLIST_NOTICE: Record<Extract<DepartureAskOutcome, { ok: false }>["reason"], string> = {
  trip_available: "diver-waitlist-available",
  already_booked: "diver-already",
  already_waitlisted: "diver-waitlisted",
  trip_unavailable: "diver-unavailable",
};

/**
 * An in-person waiver refusal no longer has a `?notice=` code at all: it is
 * answered in the form that produced it, which is also what carries the typed
 * values back (issue #1674). The nine reasons fold onto the three a staffer can
 * act on in `paperWaiverRefused`, and the words are in `paperWaiverCopy`.
 */

/** Staff-entered wait-list entry — only valid once the trip is actually full. */
export async function addToWaitlistAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const parsed = parseForm(addDiverSchema, formData);
  // The departure id is narrowed with the diver fields, not after them: a
  // malformed one reaches `eq(trips.id, …)` inside the join and Postgres
  // raises `invalid input syntax for type uuid`, so the staffer gets a 500
  // where the notice below is the honest answer.
  if (!uuidParam(tripId) || !parsed.ok) redirect(noticeUrl(back, "diver-invalid"));
  const outcome = await askForDeparture(await getDb(), {
    shopId: s.user.shopId,
    tripId,
    fullName: parsed.data.fullName,
    email: parsed.data.email,
    phone: parsed.data.phone,
  });
  if (outcome.ok || outcome.reason === "already_waitlisted") {
    await trackEvent({ name: "waitlist_joined", source: "staff" });
    revalidateAndRedirect(back, noticeUrl(back, "diver-waitlisted"));
  }
  redirect(noticeUrl(back, WAITLIST_NOTICE[outcome.reason]));
}

/**
 * **A diver already on file joins the full boat's wait list** (Aaron,
 * 2026-10-23): picked from the search, so the list reuses their record. The
 * same outcomes as a typed entry, plus a record that is not this shop's diver.
 */
export async function addKnownDiverToWaitlistAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const parsed = parseForm(offerToDiverSchema, formData);
  if (!uuidParam(tripId) || !parsed.ok) redirect(noticeUrl(back, "diver-invalid"));
  const outcome = await askForDepartureAsKnownDiver(await getDb(), {
    shopId: s.user.shopId,
    tripId,
    personId: parsed.data.personId,
  });
  if (outcome.ok || outcome.reason === "already_waitlisted") {
    await trackEvent({ name: "waitlist_joined", source: "staff" });
    revalidateAndRedirect(back, noticeUrl(back, "diver-waitlisted"));
  }
  if (outcome.reason === "not_found") redirect(noticeUrl(back, "diver-invalid"));
  redirect(noticeUrl(back, WAITLIST_NOTICE[outcome.reason]));
}

/**
 * Invites an existing diver without seating them on the departure. A cold
 * invitation is commercial mail (issue #1953), so a diver who turned off
 * courtesy email is not emailed — and the staffer is told so, rather than
 * landing on an "Invited" row that looks like a sent message.
 */
export async function createDirectTripInvitationAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  await inviteOneDiver(shopSlug, tripId, formData, { cooldown: false });
}

/**
 * **Invites one past diver the departure suggested** (fifth-loop ideas, items
 * 43 and 44; H-130): the same one-to-one invite as above, staff-chosen and for
 * this named departure, and refused for a person already contacted with an
 * invite inside `INVITE_COOLDOWN_DAYS`. The list leaves such people out; this
 * holds the line for a page left open across the window.
 */
export async function invitePastDiverAction(shopSlug: string, tripId: string, formData: FormData) {
  await inviteOneDiver(shopSlug, tripId, formData, { cooldown: true });
}

async function inviteOneDiver(
  shopSlug: string,
  tripId: string,
  formData: FormData,
  rule: { cooldown: boolean },
): Promise<never> {
  const guests = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const parsed = parseForm(offerToDiverSchema, formData);
  if (!uuidParam(tripId) || !parsed.ok) redirect(`${guests}#invite-person`);
  const db = await getDb();
  const input = {
    shopId: s.user.shopId,
    tripId,
    personId: parsed.data.personId,
    createdByPersonId: s.user.personId,
  };
  let interestId: string | null;
  // A suggestion's invite is past-diver invites' send; any other is a
  // staffer's own reach-out, which no switch refuses (ADR 20261005-optional-shop-features).
  const initiatedBy = rule.cooldown ? ("suggestion" as const) : ("shop" as const);
  if (rule.cooldown) {
    // A suggestion is past-diver invites' (the Features page): off, the list
    // is not drawn and a post from a page left open invites nobody.
    if (!(await shopHasFeatureOn(db, s.user.shopId, "pastDiverInvites"))) {
      redirect(noticeUrl(`${guests}#who-wants-in`, "invite-unavailable"));
    }
    // A suggestion: the cooldown and the departure's own gate, re-checked
    // under one lock for a page left open (H-130; review F1, N2).
    const outcome = await createInvitationUnderCooldown(db, { ...input, now: nowDate() });
    if (outcome.status === "cooldown") {
      redirect(noticeUrl(`${guests}#who-wants-in`, "invite-cooldown"));
    }
    if (outcome.status === "unavailable") {
      redirect(noticeUrl(`${guests}#who-wants-in`, "invite-unavailable"));
    }
    interestId = outcome.status === "created" ? outcome.interestId : null;
  } else {
    interestId = (await ensureDepartureInterest(db, input))?.interestId ?? null;
  }
  let delivery: SeatOfferDelivery | null = null;
  if (interestId) {
    delivery = await deliverSeatOffer(db, {
      shopId: s.user.shopId,
      shopSlug,
      tripId,
      interestId,
      initiatedBy,
    });
  }
  revalidatePath(guests);
  redirect(
    delivery === "opted_out"
      ? noticeUrl(`${guests}#who-wants-in`, "invitation-opted-out")
      : `${guests}#who-wants-in`,
  );
}

/**
 * Whether a just-cancelled booking held a captured payment, so a staff member
 * who lacks refund permission (H-14) can be told a refund may be owed rather
 * than a bare "spot is open". Deliberately coarse — it doesn't apply the
 * cancellation window; the owner/manager who picks it up runs the real
 * `refundBookingOnCancellation` path and its window/forfeit logic.
 */
async function bookingRefundMayBeOwed(
  db: Awaited<ReturnType<typeof getDb>>,
  shopId: string,
  bookingId: string,
): Promise<boolean> {
  const payment = await getBookingPayment(db, shopId, bookingId);
  return isCapturedPaymentStatus(payment?.status);
}

export async function removeBookingAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const { bookingId } = readForm(rosterBookingForm, formData);
  if (!uuidParam(bookingId)) redirect(back);
  const dbi = await getDb();
  await requireRosterBooking(dbi, s.user.shopId, tripId, bookingId, back);
  // Refused, with nothing sent, for a diver marked aboard at sea (H-133).
  const from = await removeSeat(dbi, s.user.shopId, bookingId, back, s.user.personId);
  await trackEvent({ name: "booking_cancelled", source: "staff" });
  // Freeing the seat is roster work any staff member does, but moving money is
  // owner/manager work (H-14, ADR 20260724-role-authorization). A crew member
  // can cancel the booking; the auto-refund below only fires when the actor may
  // refund. When they can't, the seat is still freed and a paid booking hands
  // the refund up to an owner/manager instead of quietly refunding under a role
  // that isn't allowed to.
  if (!(await canPersonRefund(dbi, s.user.shopId, s.user.personId))) {
    const owed = await bookingRefundMayBeOwed(dbi, s.user.shopId, bookingId);
    await sendBookingCancelledNotice(dbi, {
      shopId: s.user.shopId,
      bookingId,
      cancelledBy: "shop",
      from,
      refund: { status: "not_attempted" },
    });
    const notice = owed ? "booking-removed-refund-owner" : "booking-removed";
    revalidateAndRedirect(back, noticeUrl(back, notice, { bid: bookingId }));
  }
  // A cancel inside the shop's stated window auto-refunds a Stripe payment;
  // everything else (no window, counter payment, Stripe off) degrades to the
  // staff-run refund the notice calls out. The seat is already freed above, so
  // a refund failure never blocks the cancellation (docs H-07).
  const refund = await refundBookingOnCancellation(dbi, {
    shopId: s.user.shopId,
    bookingId,
  });
  if (refund.status !== "no_policy" && refund.status !== "unpaid") {
    await trackEvent({ name: "refund_issued", auto: true, status: refund.status });
  }
  // The refund rode on this staffer's removal; the activity log names them,
  // since the payment trail records only what moved (D5).
  if (refund.status === "refunded") {
    await recordShopActivity(dbi, {
      shopId: s.user.shopId,
      actorPersonId: s.user.personId,
      write: { code: "seat_refunded", bookingId },
    });
  }
  await sendBookingCancelledNotice(dbi, {
    shopId: s.user.shopId,
    bookingId,
    cancelledBy: "shop",
    from,
    refund,
  });
  revalidateAndRedirect(back, noticeUrl(back, refundNotice(refund), { bid: bookingId }));
}

const PARTICIPANT_TYPE_NOTICE = {
  divers_full: "participant-type-divers-full",
  participant_type_unavailable: "participant-type-unavailable",
  on_buddy_team: "participant-type-on-team",
  trip_unavailable: "participant-type-closed",
  boarded_not_ready: "participant-type-boarded",
} as const;

/**
 * "Coming as" on a roster row (ADR 20261007-participant-types): the diver
 * whose ears will not clear and who snorkels instead. Roster work any staffer
 * does, like seating; the rules (divers-only limit, buddy teams, courses, the
 * card check on joining the dive, the boarding re-check, the trail and the
 * catch-up line) are the database's, in one transaction under the trip lock.
 *
 * "Change anyway" past a missing card is the one part that is not open: it is
 * a certification call, owner, manager or instructor (`canOverrideCertBlock`),
 * refused on the live roles before anything is written.
 */
/** The Coming-as form: the seat, what it becomes, and whether "Change anyway" was pressed. */
const participantTypeForm = z.object({
  bookingId: z.string().refine((id) => uuidParam(id) !== undefined),
  participantType: z.enum(PARTICIPANT_TYPES),
  confirmCertBlock: z.literal("1").optional(),
});

export async function setParticipantTypeAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const parsed = parseForm(participantTypeForm, formData);
  if (!uuidParam(tripId) || !parsed.ok) redirect(back);
  const { bookingId, participantType: to } = parsed.data;
  const confirmCertBlock = parsed.data.confirmCertBlock === "1";
  const dbi = await getDb();
  await requireRosterBooking(dbi, s.user.shopId, tripId, bookingId, back);
  if (
    confirmCertBlock &&
    !(await canPersonOverrideCertBlock(dbi, s.user.shopId, s.user.personId))
  ) {
    redirect(noticeUrl(back, "not-authorized"));
  }
  const outcome = await setBookingParticipantType(dbi, {
    shopId: s.user.shopId,
    tripId,
    bookingId,
    to,
    actorPersonId: s.user.personId,
    confirmCertBlock,
  });
  if (!outcome.ok) {
    // A seat not on this departure: nothing to say about a seat the staffer
    // cannot act on.
    if (outcome.reason === "not_found") redirect(back);
    if (outcome.reason === "cert_blocked") {
      // Named, and signed to this departure (src/lib/trip-admission-gate.ts),
      // so the row can ask "Change anyway" knowing which card is missing.
      revalidateAndRedirect(
        back,
        noticeUrl(back, "participant-type-cert", {
          bid: bookingId,
          gate: signTripAdmissionGate(outcome.refusal, { kind: "trip", id: tripId }),
        }),
      );
    }
    revalidateAndRedirect(
      back,
      noticeUrl(back, PARTICIPANT_TYPE_NOTICE[outcome.reason], { bid: bookingId }),
    );
  }
  // A paid seat that now costs more: saved, and the difference is said out
  // loud rather than left for someone to notice at close-out.
  const saved = outcome.owedCents > 0 ? "participant-type-owed" : "participant-type-set";
  revalidateAndRedirect(back, noticeUrl(back, saved, { bid: bookingId }));
}

/**
 * **"Move to another departure"** on a roster row (ADR
 * 20261013-staff-move-a-seat). Roster work any staff member does, like Remove
 * and "Coming as": nothing is charged or refunded, so no money role is asked
 * for. The seat must be on this departure (`requireRosterBooking`), and
 * `moveSeat` is the one path that moves it and tells the diver.
 */
const moveSeatForm = z.object({
  bookingId: z.string().refine((id) => uuidParam(id) !== undefined),
  toTripId: z.string().refine((id) => uuidParam(id) !== undefined),
});

const MOVE_SEAT_NOTICE: Record<Exclude<MoveSeatRefusal, "not_found">, string> = {
  not_movable: "seat-move-not-movable",
  departed: "seat-move-departed",
  target_unavailable: "seat-move-unavailable",
  course_mismatch: "seat-move-course",
  already_booked: "seat-move-already",
  earlier_seat: "seat-move-earlier",
  leads_party: "seat-move-party",
  on_buddy_team: "seat-move-buddy",
  roll_call_started: "seat-move-roll-call",
  trip_full: "seat-move-full",
  divers_full: "seat-move-full",
  course_ratio_full: "seat-move-full",
  course_unstaffed: "seat-move-unstaffed",
  course_prerequisite: "seat-move-prerequisite",
  course_min_age: "seat-move-min-age",
  trip_prerequisite: "seat-move-prerequisite",
  date_request_departure_conflict: "seat-move-date-request-conflict",
  date_request_offer_unavailable: "seat-move-date-request-unavailable",
  date_request_party_full: "seat-move-date-request-full",
};

export async function moveSeatAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const parsed = parseForm(moveSeatForm, formData);
  if (!uuidParam(tripId) || !parsed.ok) redirect(back);
  const { bookingId, toTripId } = parsed.data;
  const dbi = await getDb();
  await requireRosterBooking(dbi, s.user.shopId, tripId, bookingId, back);
  const moved = await moveSeat(dbi, {
    shopId: s.user.shopId,
    fromTripId: tripId,
    toTripId,
    bookingId,
    actorPersonId: s.user.personId,
  });
  if (!moved.ok) {
    if (moved.reason === "not_found") redirect(back);
    revalidateAndRedirect(
      back,
      noticeUrl(`${back}#move-booking-${bookingId}`, MOVE_SEAT_NOTICE[moved.reason], {
        bid: bookingId,
      }),
    );
  }
  revalidatePath(tripPath(shopSlug, toTripId));
  const flySafeUnreached = moved.flySafe === "failed" || moved.flySafe.unreached.length > 0;
  const notice = flySafeUnreached
    ? moved.owedCents > 0
      ? "seat-moved-owed-fly-safe-unreached"
      : "seat-moved-fly-safe-unreached"
    : moved.owedCents > 0
      ? "seat-moved-owed"
      : moved.notice === "failed"
        ? "seat-moved-untold"
        : "seat-moved";
  revalidateAndRedirect(back, noticeUrl(back, notice));
}

/**
 * **"Carry the wait list"** from the demand banner (third UX review, item 12):
 * every interest still waiting on this full departure is copied to the one staff
 * chose, and the staffer lands on it, where the wait list's one-tap invite
 * reaches them. Nobody is messaged here.
 */
const carryWaitlistForm = z.object({
  toTripId: z.string().refine((id) => uuidParam(id) !== undefined),
});

export async function carryWaitlistAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const parsed = parseForm(carryWaitlistForm, formData);
  if (!uuidParam(tripId) || !parsed.ok) redirect(back);
  const { toTripId } = parsed.data;
  const carried = await carryInterests(await getDb(), {
    shopId: s.user.shopId,
    fromTripId: tripId,
    toTripId,
  });
  if (!carried.ok) {
    if (carried.reason === "not_found") redirect(back);
    revalidateAndRedirect(back, noticeUrl(back, "waitlist-carry-unavailable"));
  }
  const landing = tripPath(shopSlug, toTripId);
  revalidatePath(back);
  revalidateAndRedirect(
    landing,
    noticeUrl(landing, "waitlist-carried", { count: carried.carried }),
  );
}

export async function undoRemoveBookingAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const { bookingId } = readForm(rosterBookingForm, formData);
  if (!uuidParam(bookingId)) redirect(back);
  const dbi = await getDb();
  await requireRosterBooking(dbi, s.user.shopId, tripId, bookingId, back);
  // Only a real restore writes its trail line, inside the restore: a refused
  // undo changed nothing, and a line for it would read like the diver went
  // back on the boat.
  const outcome = await restoreBooking(dbi, s.user.shopId, bookingId, {
    actorPersonId: s.user.personId,
  });
  if (outcome === "not_found") redirect(back);
  // The undo can be refused three ways, and they need different things done
  // about them: the boat's capacity, a course session's instructor-to-student
  // ratio (a walk-up may have taken the freed seat in between), or the trip
  // having been cancelled out from under the roster. Nothing about a wait
  // list helps with that last one — the fix is reinstating the trip — so it
  // gets its own words.
  const restoreNotice =
    outcome === "trip_full"
      ? "booking-restore-full"
      : outcome === "divers_full"
        ? "booking-restore-divers-full"
        : outcome === "course_ratio_full"
          ? "booking-restore-ratio"
          : outcome === "trip_cancelled"
            ? "booking-restore-cancelled"
            : outcome === "date_request_departure_conflict"
              ? "booking-restore-date-request-conflict"
              : outcome === "date_request_offer_unavailable"
                ? "booking-restore-date-request-unavailable"
                : outcome === "date_request_party_full"
                  ? "booking-restore-date-request-full"
                  : "booking-restored";
  revalidateAndRedirect(back, noticeUrl(back, restoreNotice));
}

const updatePickupSchema = z.object({
  pickupTime: z.string().trim().max(20).optional(),
  hotelPickupLocation: z.string().trim().max(300).optional(),
});

const dietaryNoteSchema = z.object({
  dietaryNote: z.string().trim().max(DIETARY_NOTE_MAX).optional(),
});

/**
 * **The desk writes a seat's lunch note** (fifth-loop ideas, item 56;
 * dive-domain review F8): for a walk-up, a phone booking, or one person who
 * filled in a whole group's forms. The same note the diver's Day-of form
 * writes, held to the same {@link DIETARY_NOTE_MAX}; a meal preference for the
 * galley, never an allergy record. Any staffer, like the pickup beside it.
 */
export async function updateBookingDietaryNoteAction(
  shopSlug: string,
  tripId: string,
  bookingId: string,
  formData: FormData,
) {
  const s = (await requireShopSurface(shopSlug)).session;
  const back = tripPath(shopSlug, tripId);
  const parsed = dietaryNoteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(noticeUrl(back, "dietary-invalid", { bid: bookingId }));
  const db = await getDb();
  await requireRosterBooking(db, s.user.shopId, tripId, bookingId, back);
  // The writer refuses a departure that does not serve lunch aboard (N-a):
  // the roster shows no lunch control there, so nothing was asked of anyone.
  const saved = await setBookingDietaryNote(db, {
    shopId: s.user.shopId,
    bookingId,
    note: parsed.data.dietaryNote ?? null,
  });
  if (!saved) redirect(back);
  revalidatePath(shopPath(shopSlug, "trips", tripId, "prep"));
  revalidatePath(shopPath(shopSlug, "trips", tripId, "manifest"));
  revalidateAndRedirect(back, noticeUrl(back, "dietary-saved", { bid: bookingId }));
}

export async function updateBookingPickupAction(
  shopSlug: string,
  tripId: string,
  bookingId: string,
  formData: FormData,
) {
  const s = (await requireShopSurface(shopSlug)).session;
  const back = tripPath(shopSlug, tripId);
  const parsed = updatePickupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    redirect(noticeUrl(back, "pickup-invalid", { bid: bookingId }));
  }
  const db = await getDb();
  // Hotel pickups switched off (the Features page): the roster draws no form,
  // so a hand-built post sets nothing. A pickup already set stays.
  if (!(await shopHasFeatureOn(db, s.user.shopId, "hotelPickup"))) redirect(back);
  await requireRosterBooking(db, s.user.shopId, tripId, bookingId, back);
  const pickupTime = parsed.data.pickupTime ? parsed.data.pickupTime.trim() || null : null;
  const hotelPickupLocation = parsed.data.hotelPickupLocation
    ? parsed.data.hotelPickupLocation.trim() || null
    : null;

  await setBookingPickupDetails(db, {
    shopId: s.user.shopId,
    bookingId,
    pickupTime,
    hotelPickupLocation,
  });

  revalidatePath(shopPath(shopSlug));
  revalidatePath(shopPath(shopSlug, "trips", tripId));
  revalidatePath(shopPath(shopSlug, "trips", tripId, "prep"));
  revalidatePath(shopPath(shopSlug, "trips", tripId, "manifest"));
  revalidateAndRedirect(back, noticeUrl(back, "pickup-saved", { bid: bookingId }));
}
