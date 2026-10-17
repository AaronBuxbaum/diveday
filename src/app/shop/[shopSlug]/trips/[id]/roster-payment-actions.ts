"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonRefund } from "@/db/authz";
import { getDb } from "@/db/client";
import { paymentMarkFactsForTrip } from "@/db/payment-marks";
import { getBookingPayment, setBookingPayment } from "@/db/payments";
import type { PaymentStatus } from "@/db/schema";
import { recordShopActivity } from "@/db/shop-activity";
import { getShopCurrency } from "@/db/stripe-accounts";
import { formValue, readForm, text } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { heldAfterMark, markNeedsWriteOffRight, readPaymentMarkForm } from "@/lib/payment-marks";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl } from "@/lib/staff-notices";
import { requireRosterBooking, tripPath } from "./roster-booking";

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

const markPaymentForm = z.object({ bookingId: text(), status: formValue() });

export async function markPaymentAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = tripPath(shopSlug, tripId);
  const form = readForm(markPaymentForm, formData);
  const { bookingId } = form;
  const status = paymentStatusSchema.safeParse(form.status);
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
  const submitted = String(form.status ?? "");
  // Counter cash is still money the shop took in its own currency — stamping
  // this row `usd` by default told a Mexican shop's diver their balance was in
  // dollars. The amount is read in the same currency's major unit.
  const currency = await getShopCurrency(db, s.user.shopId);
  // **The Paid mark says how much and how** (batch 6 item 1). A paid row with
  // no amount reached every revenue sum as $0, so cash taken at the dock never
  // showed on Reports. An amount that cannot be read is refused rather than
  // guessed, and a Paid mark with *no* money is the write-off below.
  // What a refusal below carries back, so the sheet reopens holding what the
  // staffer typed (issue #2607).
  const { mark, retry } = readPaymentMarkForm(formData, submitted, currency);
  if (mark.kind === "invalid") {
    redirect(
      noticeUrl(back, mark.field === "method" ? "payment-method" : "payment-amount", {
        bid: bookingId,
        ...retry,
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
            ...retry,
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
