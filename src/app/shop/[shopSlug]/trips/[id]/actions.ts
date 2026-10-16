"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { paperWaiverAttestation, paperWaiverRefused } from "@/app/actions/paper-waiver-fields";
import {
  canPersonOverrideCertBlock,
  canPersonRefund,
  canPersonRetireMedicalRefusal,
} from "@/db/authz";
import { sendBookingCancelledNotice } from "@/db/booking-cancelled-notice";
import {
  confirmBookingIdentity,
  restoreBooking,
  setBookingParticipantType,
  setBookingPickupDetails,
  splitBookingIdentity,
} from "@/db/bookings";
import { getDb } from "@/db/client";
import { paymentMarkFactsForTrip } from "@/db/payment-marks";
import { getBookingPayment, setBookingPayment } from "@/db/payments";
import { refundBookingOnCancellation } from "@/db/refunds";
import { applyPaidRentalKindsToFit } from "@/db/rental-fit";
import type { PaymentStatus } from "@/db/schema";
import { type MoveSeatRefusal, moveSeat } from "@/db/seat-diver";
import { recordShopActivity } from "@/db/shop-activity";
import { getShopCurrency } from "@/db/stripe-accounts";
import {
  createDirectTripInvitation,
  deliverTripInvitation,
  listTripInvitations,
  type TripInvitationDelivery,
} from "@/db/trip-invitations";
import { joinTripWaitlist, type WaitlistOutcome } from "@/db/waitlist";
import { carryWaitlist } from "@/db/waitlist-roll";
import {
  deliverWaiverBatch,
  type IdentityReleaseOutcome,
  sendReleasesOnceIdentityKnown,
} from "@/db/waiver-issue";
import {
  recordInPersonWaiver,
  retireMedicalRefusal,
  saveBookingEmergencyContact,
} from "@/db/waivers";
import { trackEvent } from "@/lib/analytics";
import { emergencyContactSchema } from "@/lib/contact";
import { parseForm } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { PAPER_WAIVER_IDLE, type PaperWaiverFormState } from "@/lib/paper-waiver-form";
import { PARTICIPANT_TYPES } from "@/lib/participant-types";
import { heldAfterMark, markNeedsWriteOffRight, readManualPaymentMark } from "@/lib/payment-marks";
import { isCapturedPaymentStatus } from "@/lib/payment-source";
import {
  blankableDiverEmailSchema,
  diverEmailSchema,
  diverNameSchema,
  diverPhoneSchema,
} from "@/lib/person-fields";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { signTripAdmissionGate } from "@/lib/trip-admission-gate";
import { uuidParam } from "@/lib/uuid";
import { refundNotice } from "./refund-notice";
import { isRosterBooking, removeSeat, requireRosterBooking, tripPath } from "./roster-booking";

const paymentStatusSchema = z.enum(["unpaid", "deposit_paid", "paid", "waived", "refunded"]);

/**
 * Whether a payment status *records* money or *decides about* it — a free seat
 * and a refund-without-a-refund are the write-off that `canRefund` gates
 * everywhere else (issue #714).
 *
 * An exhaustive `Record`, not a `Set`: a sixth status added to the column would
 * silently fall outside a set and be treated as ordinary counter work, which is
 * the one direction this classification must never fail. Here it is a compile
 * error instead.
 */
const PAYMENT_STATUS_CLASS: Record<PaymentStatus, "record" | "write_off"> = {
  unpaid: "record",
  deposit_paid: "record",
  paid: "record",
  waived: "write_off",
  // Money went back out, so changing away from it is a decision about money
  // even though some is still held. Note it is absent from
  // `paymentStatusSchema` above on purpose: `partly_refunded` is only ever
  // reached by an actual Stripe partial refund, never set by hand from the
  // roster select (issue #699).
  partly_refunded: "write_off",
  refunded: "write_off",
};

function paymentStatusClass(status: PaymentStatus): "record" | "write_off" {
  return PAYMENT_STATUS_CLASS[status];
}

/**
 * Wait-listing still parses its own submission here: it is a different
 * mutation (`joinTripWaitlist`) with its own outcomes, and it shares only the
 * form. Seating a diver — hand-entered or picked — goes through the shared
 * `seatNewDiverAction`/`seatExistingDiverAction` (src/app/actions/seat-diver.ts)
 * so every door owes the same consequences.
 */
const addDiverSchema = z.object({
  // Shared diver person-field bounds (src/lib/person-fields.ts).
  fullName: diverNameSchema,
  email: diverEmailSchema,
  phone: diverPhoneSchema.optional(),
});

const directInvitationSchema = z.object({ personId: z.uuid() });

function parseAddDiver(formData: FormData) {
  return addDiverSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phone: formData.get("phone") || undefined,
  });
}

/**
 * A wait-list refusal's `?notice=` code. `already_waitlisted` never reaches this
 * table — a repeat joiner is answered as success above, deliberately — but it is
 * spelled out because the union contains it, and a table that quietly omitted an
 * arm would be the ladder this replaced.
 */
const WAITLIST_NOTICE: Record<Extract<WaitlistOutcome, { ok: false }>["reason"], string> = {
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
  const parsed = parseAddDiver(formData);
  // The departure id is narrowed with the diver fields, not after them: a
  // malformed one reaches `eq(trips.id, …)` inside the join and Postgres
  // raises `invalid input syntax for type uuid`, so the staffer gets a 500
  // where the notice below is the honest answer.
  if (!uuidParam(tripId) || !parsed.success) redirect(noticeUrl(back, "diver-invalid"));
  const outcome = await joinTripWaitlist(await getDb(), {
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
 * Records a staff outreach attempt for an invitation and emails it when it
 * can (`deliverTripInvitation`). Anything but `sent` opens the same safe
 * composer fallback the wait-list invite uses — including a cold invitation
 * to a diver who turned off courtesy email, whom staff may still write to by
 * hand. This never turns a lead into a booking or consumes a seat.
 */
export async function recordTripInvitationAction(
  shopSlug: string,
  tripId: string,
  invitationId: string,
): Promise<"sent" | "fallback"> {
  const s = (await requireShopSurface(shopSlug)).session;
  if (!uuidParam(tripId) || !uuidParam(invitationId)) return "fallback";
  const db = await getDb();
  const result = await deliverTripInvitation(db, {
    shopId: s.user.shopId,
    shopSlug,
    tripId,
    invitationId,
  });
  revalidatePath(tripPath(shopSlug, tripId));
  return result === "sent" ? "sent" : "fallback";
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
  const guests = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const parsed = directInvitationSchema.safeParse({ personId: formData.get("personId") });
  if (!uuidParam(tripId) || !parsed.success) redirect(`${guests}#invite-person`);
  const db = await getDb();
  const created = await createDirectTripInvitation(db, {
    shopId: s.user.shopId,
    tripId,
    personId: parsed.data.personId,
    createdByPersonId: s.user.personId,
  });
  let delivery: TripInvitationDelivery | null = null;
  if (created) {
    const invitation = (await listTripInvitations(db, s.user.shopId, tripId)).find(
      ({ invitation }) =>
        invitation.source === "direct" && invitation.personId === parsed.data.personId,
    );
    if (invitation) {
      delivery = await deliverTripInvitation(db, {
        shopId: s.user.shopId,
        shopSlug,
        tripId,
        invitationId: invitation.invitation.id,
      });
    }
  }
  revalidatePath(guests);
  redirect(
    delivery === "opted_out"
      ? noticeUrl(`${guests}#invitations`, "invitation-opted-out")
      : `${guests}#invitations`,
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
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!uuidParam(bookingId)) redirect(back);
  const dbi = await getDb();
  await requireRosterBooking(dbi, s.user.shopId, tripId, bookingId, back);
  // Refused, with nothing sent, for a diver marked aboard at sea (H-126).
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
    revalidateAndRedirect(back, noticeUrl(back, MOVE_SEAT_NOTICE[moved.reason]));
  }
  revalidatePath(tripPath(shopSlug, toTripId));
  const notice =
    moved.owedCents > 0
      ? "seat-moved-owed"
      : moved.notice === "failed"
        ? "seat-moved-untold"
        : "seat-moved";
  revalidateAndRedirect(back, noticeUrl(back, notice));
}

/**
 * **"Carry the wait list"** from the demand banner (third UX review, item 12):
 * every lead still waiting on this full departure is copied to the one staff
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
  const carried = await carryWaitlist(await getDb(), {
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
  const bookingId = String(formData.get("bookingId") ?? "");
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
            : "booking-restored";
  revalidateAndRedirect(back, noticeUrl(back, restoreNotice));
}

/**
 * **"Send a new waiver" on a seat a physician refused** (Aaron, 2026-10-06).
 * Retires the refusal from this seat (`retireMedicalRefusal`), when the seat
 * holds it, and emails the diver a fresh release in the same tap. The refusal
 * keeps the seat blocked until that release is signed, so nothing here lets
 * anybody board. A clean new release boards them, with a warning on the row
 * that links back to the refusal (Aaron, 2026-10-07, issue #2158).
 *
 * Owner or manager, refused on the live roles before anything is written. A
 * diver with no email on file still gets the seat freed for a new release, and
 * the row's own waiver controls (copy the link, text it, or record paper) take
 * over.
 */
export async function sendNewWaiverAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!uuidParam(bookingId)) redirect(back);
  const dbi = await getDb();
  await requireRosterBooking(dbi, s.user.shopId, tripId, bookingId, back);
  if (!(await canPersonRetireMedicalRefusal(dbi, s.user.shopId, s.user.personId))) {
    redirect(noticeUrl(back, "not-authorized"));
  }
  // A fresh link is an email to someone outside the shop; bound how many one
  // staff member can fire in an hour before anything is retired or sent.
  const sendAllowed = await checkRateLimit(
    rateLimitKey("staff-send", "new-waiver", s.user.personId),
    RATE_LIMITS.staffSendByActor,
  );
  if (!sendAllowed.allowed) redirect(noticeUrl(back, "send-limit", { bid: bookingId }));
  const retired = await retireMedicalRefusal(dbi, {
    shopId: s.user.shopId,
    bookingId,
    actorPersonId: s.user.personId,
  });
  // A refusal recorded on another of the diver's seats has nothing to retire
  // here: this seat simply never had a release of its own, and the new one is
  // sent all the same. The refusal still outranks everything older than it.
  if (!retired.ok && retired.reason === "not_authorized") {
    redirect(noticeUrl(back, "not-authorized"));
  }
  const delivered = await deliverWaiverBatch(dbi, s.user.shopId, {
    bookingIds: [bookingId],
    channel: "email",
  });
  // No link at all (the seat was cancelled or the boat sailed) is said as a
  // failure: "ready" would promise a link that does not exist.
  const notice =
    delivered.sent.length > 0
      ? "new-waiver-sent"
      : delivered.links.length > 0
        ? "new-waiver-ready"
        : "new-waiver-failed";
  revalidateAndRedirect(back, noticeUrl(back, notice, { bid: bookingId }));
}

/**
 * Staff confirm a flagged booking is the person it was attached to (H-13),
 * clearing the `identity_unconfirmed` readiness blocker. Same shop-scoped
 * session gate as every roster action; a no-op on an already-clear booking
 * still settles cleanly so a double-tap is harmless.
 *
 * Open to every staff role, and what carries that is the trail
 * `confirmBookingIdentity` writes under this staffer's name — see its docblock
 * for what the tap hands over and why the role list stays where it is.
 */
export async function confirmDiverIdentityAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!uuidParam(bookingId)) redirect(back);
  const db = await getDb();
  await requireRosterBooking(db, s.user.shopId, tripId, bookingId, back);
  const confirmed = await confirmBookingIdentity(db, {
    shopId: s.user.shopId,
    bookingId,
    actorPersonId: s.user.personId,
  });
  if (!confirmed) revalidateAndRedirect(back, noticeUrl(back, "invalid", { bid: bookingId }));
  // The gear this seat paid for at checkout waited on the booking while it was
  // held (`paid_rental_kinds`); the staffer's tick carries it to the fit, which
  // is a standing record, so it is theirs to decline.
  if (formData.get("applyPaidGear") === "on") {
    await applyPaidRentalKindsToFit(db, { shopId: s.user.shopId, bookingId });
  }
  // A held seat was sent no release (issue #2125); now that the desk knows
  // who it is, it goes out the way a join's does, unless their signature
  // already covers it, and the notice says where it got to.
  const release = await sendReleasesOnceIdentityKnown(db, s.user.shopId, [bookingId]);
  revalidateAndRedirect(
    back,
    noticeUrl(back, IDENTITY_RELEASE_NOTICE.confirmed[release], { bid: bookingId }),
  );
}

/**
 * Staff answer "different person" to a held seat (H-13): the booking leaves
 * the matched diver's record and becomes a new diver of its own. The other
 * door onto the same question as {@link confirmDiverIdentityAction}; the write
 * and its trail are `splitBookingIdentity`'s.
 */
export async function splitDiverIdentityAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!uuidParam(bookingId)) redirect(back);
  const db = await getDb();
  await requireRosterBooking(db, s.user.shopId, tripId, bookingId, back);
  // Who the new diver is, beyond a name (issue #2081). The email is checked
  // for shape here; whether another record holds it is the writer's call.
  const email = blankableDiverEmailSchema.safeParse(String(formData.get("email") ?? "").trim());
  const phone = diverPhoneSchema.safeParse(String(formData.get("phone") ?? ""));
  if (!email.success || !phone.success) {
    revalidateAndRedirect(
      back,
      noticeUrl(back, email.success ? "invalid" : "identity-split-email-invalid", {
        bid: bookingId,
      }),
    );
  }
  const split = await splitBookingIdentity(db, {
    shopId: s.user.shopId,
    bookingId,
    actorPersonId: s.user.personId,
    fullName: String(formData.get("fullName") ?? ""),
    dateOfBirth: String(formData.get("dateOfBirth") ?? ""),
    adultAttested: formData.get("adultAttested") === "yes",
    email: email.data,
    phone: phone.data,
    // The bookings the ticked box named. Only ids; the writer moves only those
    // that are still the same guess and still movable.
    sameNameSeatIds: String(formData.get("sameNameSeatIds") ?? "")
      .split(",")
      .filter((id) => uuidParam(id)),
  });
  if (!split.ok) {
    revalidateAndRedirect(
      back,
      noticeUrl(back, SPLIT_REFUSAL_NOTICE[split.reason], { bid: bookingId }),
    );
  }
  // The new diver's fit is empty and the gear is what this seat paid for, so
  // it goes straight on: otherwise it would leave the rack the moment the
  // seat stopped being held.
  await applyPaidRentalKindsToFit(db, { shopId: s.user.shopId, bookingId });
  // Every seat that moved is its own diver's now, and was sent no release
  // while it was held (issue #2125): each goes out the way a join's does.
  const release = await sendReleasesOnceIdentityKnown(db, s.user.shopId, split.seatIds);
  revalidateAndRedirect(
    back,
    noticeUrl(back, IDENTITY_RELEASE_NOTICE.split[release], { bid: bookingId }),
  );
}

/**
 * Which notice confirm and split land on, by what sending the owed release
 * came to (`sendReleasesOnceIdentityKnown`). A release that reached nobody
 * reads as the row's to hand over, on this device or on paper.
 */
const IDENTITY_RELEASE_NOTICE = {
  confirmed: {
    not_needed: "identity-confirmed",
    sent: "identity-confirmed-waiver-sent",
    ready: "identity-confirmed-waiver-ready",
    failed: "new-waiver-failed",
  },
  split: {
    not_needed: "identity-split",
    sent: "identity-split-waiver-sent",
    ready: "identity-split-waiver-ready",
    failed: "new-waiver-failed",
  },
} as const satisfies Record<"confirmed" | "split", Record<IdentityReleaseOutcome, string>>;

/** Which notice each refused split lands on (`splitBookingIdentity`). */
const SPLIT_REFUSAL_NOTICE = {
  not_held: "invalid",
  name_required: "invalid",
  medical_hold: "identity-medical-hold",
  date_of_birth_required: "identity-split-dob-required",
  date_of_birth_invalid: "identity-split-dob-invalid",
  age_unstated: "identity-split-age-unstated",
  email_in_use: "identity-split-email-in-use",
} as const satisfies Record<
  Extract<Awaited<ReturnType<typeof splitBookingIdentity>>, { ok: false }>["reason"],
  string
>;

/**
 * Staff records that a diver signed a paper release in person or on shore, for a
 * diver the app never sees sign. Same shop-scoped session gate as every other
 * roster action; the accountable staff member is stamped on the record. Requires
 * an explicit medical-clear attestation — a flagged medical must go through the
 * diver-facing link, which captures the questionnaire and routes to review.
 *
 * Success does not navigate. The control lives inside a `<details>` on one
 * card of a roster that can run a boat long, and redirecting for a success
 * banner threw the page back to its top with every disclosure shut — for news
 * the card itself delivers better: the waiver control the finger was just on
 * becomes "Signed on paper · <date>", and the blocker above it clears. Same
 * rule the counter queue already states in its own `noticeCopy` table.
 *
 * **A refusal no longer navigates either** (issue #1674). It used to redirect
 * with a `?notice=`, which remounted the form's uncontrolled inputs empty and
 * left the staffer retyping the medical tick, the co-signer's name and the
 * relationship before they could correct the one thing the notice named. It
 * answers into the form's own `useActionState` instead, carrying those three
 * values back with the refusal — never through the URL, which is not where a
 * named minor's guardian's name goes.
 */
export async function markRosterWaiverInPersonAction(
  shopSlug: string,
  tripId: string,
  _state: PaperWaiverFormState,
  formData: FormData,
): Promise<PaperWaiverFormState> {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const bookingId = String(formData.get("bookingId") ?? "");
  // No seat on the request at all: the form always carries one here, so this is
  // not a submission the form made. Answered in the form anyway rather than
  // redirected, so there is exactly one shape of refusal to read.
  const dbi = await getDb();
  // A seat from another departure is answered the way a missing one is.
  if (!(await isRosterBooking(dbi, s.user.shopId, tripId, bookingId))) {
    return paperWaiverRefused("booking_not_found", formData);
  }
  const outcome = await recordInPersonWaiver(dbi, {
    shopId: s.user.shopId,
    subject: { bookingId },
    recordedByPersonId: s.user.personId,
    // The medical tick and, for a minor, the co-signer (ADR
    // 20260907-guardian-co-signature). Passed as typed; `recordInPersonWaiver`
    // decides from the date of birth on file whether a guardian is needed at
    // all, and refuses a section that is not a signature.
    ...paperWaiverAttestation(formData),
  });
  // Nothing was written, so nothing is revalidated: the roster the staffer is
  // looking at is still true, and the answer is the sentence under the button.
  if (!outcome.ok) return paperWaiverRefused(outcome.reason, formData);
  revalidatePath(back);
  return PAPER_WAIVER_IDLE;
}

/**
 * Staff record (or correct) a diver's emergency contact straight from the
 * roster — the fallback for a diver who never filled it in themselves, and
 * the field Today's "ask at the counter" nudge used to have nowhere to land
 * (UX persona Lens 17, task 144). Writes through the same
 * `saveBookingEmergencyContact` the diver-facing /ready and /waivers capture
 * uses, so there is exactly one write path regardless of who fills it in.
 * Prints on the manifest — safety-adjacent, hence the shop-scoped booking
 * lookup inside `saveBookingEmergencyContact` rather than trusting the
 * `bookingId` field alone, and a blank submission is reported distinctly from
 * a genuine failure rather than silently landing on the same "invalid" notice.
 */
export async function saveRosterEmergencyContactAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const bookingId = String(formData.get("bookingId") ?? "");
  const parsed = emergencyContactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(noticeUrl(back, "invalid"));
  const dbi = await getDb();
  await requireRosterBooking(dbi, s.user.shopId, tripId, bookingId, noticeUrl(back, "invalid"));
  const name = (parsed.data.emergencyContactName ?? "").trim();
  const phone = (parsed.data.emergencyContactPhone ?? "").trim();
  await saveBookingEmergencyContact(dbi, {
    shopId: s.user.shopId,
    bookingId,
    name,
    phone,
    actor: "staff",
  });
  // A contact is only usable with a reachable number, and the writer holds
  // that line for every surface (`readEmergencyContact`): a name without a
  // number wrote nothing at all, rather than landing the new name on the
  // contact's old phone. So this notice reports a refusal, not a half-save.
  const complete = Boolean(name && phone);
  revalidateAndRedirect(
    back,
    noticeUrl(back, complete ? "contact-saved" : "contact-incomplete", { bid: bookingId }),
  );
}

export async function markPaymentAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = tripPath(shopSlug, tripId);
  const bookingId = String(formData.get("bookingId") ?? "");
  const status = paymentStatusSchema.safeParse(formData.get("status"));
  // **Recording money is crew work; deciding about money is not.** Counter cash
  // at the dock is exactly front-desk work, so `paid` and `deposit_paid` stay
  // open to every staff member. `waived` is a free seat and `refunded` marks a
  // booking refunded *without moving any money* — taking it out of
  // `COLLECTED_PAYMENT_STATUSES` and silently reducing the shop's reported
  // revenue for the month. Both are the write-off that `canRefund` gates
  // everywhere else, and this action accepted the whole enum from the form
  // (issue #714).
  //
  // **The gate is on the transition, not the destination.** Asking only "is
  // this staffer entering a write-off" left the way *out* of one wide open:
  // `setBookingPayment` trusts its caller (only `setBookingPaymentIfNotFinal`
  // refuses to overwrite a final status), so a captain could take a booking the
  // owner had already refunded and mark it `paid` again. That is not a wording
  // problem — it raises reported revenue on money that was returned, wipes the
  // row's pointer at the real Stripe refund, and puts the seat back into
  // `listOwedShopCancellationRefunds`, whose own docstring calls a `paid` row on
  // a cancelled trip "the obvious way to get this wrong". Found by
  // `security-reviewer` after #714 shipped.
  const db = await getDb();
  const s = (await requireShopSurface(shopSlug)).session;
  await requireRosterBooking(db, s.user.shopId, tripId, bookingId, noticeUrl(back, "invalid"));
  const current = await getBookingPayment(db, s.user.shopId, bookingId);
  // Checked before the gate: the control keeps a booking's *current* status
  // selectable, so a captain looking at a waived seat can submit `waived`
  // unchanged. Nothing is decided by a tap that changes nothing, and refusing
  // it would be a confusing refusal rather than a protection.
  //
  // Compared against the **raw** submitted value rather than the parsed one.
  // `paymentStatusSchema` deliberately omits `partly_refunded` — no dropdown
  // may move money — but the control still renders the booking's current
  // status as an option, so on a part-refunded seat the unchanged submit
  // failed to parse, missed this branch, and dead-ended at `?notice=invalid`:
  // an unexplained refusal on a money row for a tap that changed nothing
  // (issue #699 security review).
  const submitted = String(formData.get("status") ?? "");
  // Counter cash is still money the shop took in its own currency — stamping
  // this row `usd` by default told a Mexican shop's diver their balance was in
  // dollars. The amount is read in the same currency's major unit.
  const currency = await getShopCurrency(db, s.user.shopId);
  // **The Paid mark says how much and how** (batch 6 item 1). A paid row with
  // no amount reached every revenue sum as $0, so cash taken at the dock never
  // showed on Reports. An amount that cannot be read is refused rather than
  // guessed, and a Paid mark with *no* money is the write-off below.
  const mark = readManualPaymentMark(
    submitted,
    formData.get("amount") === null ? null : String(formData.get("amount")),
    formData.get("method") === null ? null : String(formData.get("method")),
    currency,
  );
  if (mark.kind === "invalid") {
    redirect(
      noticeUrl(back, mark.field === "method" ? "payment-method" : "payment-amount", {
        bid: bookingId,
      }),
    );
  }
  // An unchanged status changes nothing unless it brings money the row does
  // not already hold: a staffer recording the cash on a seat already marked
  // paid is a real write, and a re-submit with the amount left blank is not
  // a request to wipe one.
  const held = heldAfterMark(current ?? null, submitted, mark);
  if (
    current?.status !== undefined &&
    current.status === submitted &&
    (mark.kind !== "money" ||
      (current.amountCents === held.amountCents && current.method === held.method))
  ) {
    revalidateAndRedirect(back, noticeUrl(back, "payment", { bid: bookingId }));
  }
  // **A hand mark never touches a seat paid online** (security review, batch
  // 6). `setBookingPayment` writes the whole row, so any hand mark here nulled
  // `provider`/`providerRef` and the automatic refund lost the payment it
  // would reverse. Money that came through Stripe goes back through Stripe:
  // the seat's own refund, never this control.
  if (current?.provider) {
    redirect(noticeUrl(back, "payment-online", { bid: bookingId }));
  }
  const decidesAboutMoney =
    (status.success && paymentStatusClass(status.data) === "write_off") ||
    (current?.status !== undefined && paymentStatusClass(current.status) === "write_off");
  // What the seat owes before this mark: Paid on less is the rest written off.
  const balanceOwedCents =
    (await paymentMarkFactsForTrip(db, s.user.shopId, tripId)).get(bookingId)?.balanceOwedCents ??
    null;
  const writesOff = markNeedsWriteOffRight(mark, submitted, balanceOwedCents);
  if (
    (decidesAboutMoney || writesOff) &&
    !(await canPersonRefund(db, s.user.shopId, s.user.personId))
  ) {
    // A Paid mark left blank by someone who may not write a seat off is far
    // more often a missed field than an attempted comp, so it is asked for
    // again rather than called a permission problem; a short one is told what
    // it is and what crew may do instead. Either way nothing lands.
    redirect(
      decidesAboutMoney
        ? noticeUrl(back, "not-authorized")
        : noticeUrl(back, mark.kind === "money" ? "payment-short" : "payment-amount", {
            bid: bookingId,
          }),
    );
  }
  const saved =
    bookingId && status.success
      ? await setBookingPayment(db, {
          shopId: s.user.shopId,
          bookingId,
          status: status.data,
          currency,
          // A blank Paid mark keeps a deposit taken by hand: writing off the
          // rest never erases cash the shop already holds.
          amountCents: held.amountCents,
          method: held.method,
          // Who marked it, on every hand mark: the trail row carries it too,
          // so a dispute about the cash box has a name to start from.
          recordedByPersonId: s.user.personId,
        })
      : null;
  // A write-off is a decision about money, and the payment trail records the
  // status it moved to but never who moved it: the activity log does (D5).
  if (saved && status.success && (status.data === "waived" || status.data === "refunded")) {
    await recordShopActivity(db, {
      shopId: s.user.shopId,
      actorPersonId: s.user.personId,
      write: {
        code: status.data === "waived" ? "payment_waived" : "payment_marked_refunded",
        bookingId,
      },
    });
  }
  // Paid on less than the seat owed: the money that came in is on the row, and
  // the rest written off is its own line, with who decided it.
  if (saved && status.success && status.data === "paid" && writesOff) {
    await recordShopActivity(db, {
      shopId: s.user.shopId,
      actorPersonId: s.user.personId,
      write: { code: "payment_balance_written_off", bookingId },
    });
  }
  // `bid` rides along so the roster can hold that diver's card open on the
  // way back: a settled card collapses, and the payment selector a staffer
  // just used must never be what collapses it out from under them.
  revalidateAndRedirect(
    back,
    saved ? noticeUrl(back, "payment", { bid: bookingId }) : noticeUrl(back, "invalid"),
  );
}

const updatePickupSchema = z.object({
  pickupTime: z.string().trim().max(20).optional(),
  hotelPickupLocation: z.string().trim().max(300).optional(),
});

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
