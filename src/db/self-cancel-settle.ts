import { trackEvent } from "@/lib/analytics";
import { log } from "@/lib/log";
import type { NotificationProvider } from "@/lib/notifications";
import {
  type CancellationRefundSeen,
  sendBookingCancelledNotice,
} from "./booking-cancelled-notice";
import type { PartyCancelOutcome } from "./bookings";
import type { AppDb } from "./client";
import { recordDiverSelfCancel } from "./operations";
import { refundBookingOnCancellation } from "./refunds";

type NoticeOptions = { provider?: NotificationProvider; now?: Date };

/**
 * **The refund, the trail line and the cancellation email for one seat a
 * diver's own cancel released** (`/ready` and the reply keyword alike).
 *
 * Caught, not left to throw: the cancellation already committed and the
 * diver's link is already revoked, so a refund failure (a transient DB error,
 * say) must never turn an already-successful cancellation into an error
 * response — the diver would see a generic failure with no way to tell the
 * destructive action actually went through. Staff can still see and fix a
 * missed refund from the booking's payment record; the diver just needs the
 * confirmation either way.
 */
export async function settleSelfCancelledSeat(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    notify: boolean;
    party?: { leadBookingId: string; seatName: string };
  },
  options: NoticeOptions = {},
): Promise<CancellationRefundSeen> {
  const { shopId, bookingId } = input;
  let refund: CancellationRefundSeen = { status: "not_attempted" };
  try {
    refund = await refundBookingOnCancellation(db, { shopId, bookingId });
    if (refund.status !== "no_policy" && refund.status !== "unpaid") {
      await trackEvent({ name: "refund_issued", auto: true, status: refund.status });
    }
  } catch (error) {
    log("booking.self_cancel_refund_failed", "error", {
      bookingId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
  }
  // The departure's trail names the diver, so the owner's "who refunded what"
  // has an answer that is not a staffer. Caught for the same reason as the
  // refund: the cancellation has already happened.
  try {
    const recorded = await recordDiverSelfCancel(db, {
      shopId,
      bookingId,
      refunded: refund.status === "refunded",
      party: input.party,
    });
    // Null when the departure was deleted under the diver: no trail to write
    // on, so the act is at least in the log for a disputed refund (#2471).
    if (!recorded) log("booking.self_cancel_activity_skipped", "warn", { bookingId });
  } catch (error) {
    log("booking.self_cancel_activity_failed", "error", {
      bookingId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
  }
  // The written record of what just happened, with the money in it: the page
  // says it once, and this is what the diver still has tomorrow.
  if (!input.notify) return refund;
  await sendBookingCancelledNotice(
    db,
    {
      shopId,
      bookingId,
      cancelledBy: "diver",
      // `selfCancelBooking` only ever cancels a booked seat.
      from: "booked",
      refund,
    },
    options,
  );
  return refund;
}

/**
 * **Each party seat that went with its lead's cancel** (batch 6 item 10),
 * refunded under the same policy and named on the trail as the lead's act.
 * A seat with an address of its own is that diver's to hear about, so it gets
 * its own cancellation notice (glossary "Cancellation notice"); a seat on the
 * lead's address, or with none, stays quiet, since the lead already knows.
 */
export async function settleReleasedPartySeats(
  db: AppDb,
  input: { shopId: string; leadBookingId: string; party: PartyCancelOutcome | undefined },
  options: NoticeOptions = {},
): Promise<void> {
  for (const seat of input.party?.cancelled ?? []) {
    await settleSelfCancelledSeat(
      db,
      {
        shopId: input.shopId,
        bookingId: seat.bookingId,
        notify: seat.ownAddress,
        party: { leadBookingId: input.leadBookingId, seatName: seat.seatName },
      },
      options,
    );
  }
}
