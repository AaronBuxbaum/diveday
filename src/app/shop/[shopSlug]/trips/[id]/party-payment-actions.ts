"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { markPartyPaid, previewPartyPayment } from "@/db/payment-marks";
import { recordShopActivity } from "@/db/shop-activity";
import { getShopCurrency } from "@/db/stripe-accounts";
import { revalidateAndRedirect } from "@/lib/navigation";
import { readManualPaymentMark } from "@/lib/payment-marks";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl } from "@/lib/staff-notices";
import { requireRosterBooking, tripPath } from "./roster-booking";

/**
 * What the party-payment form says, read once for the preview and the confirm
 * (issue #2605). The amount is read the way the Paid mark reads it, but a
 * blank one is refused: a party mark with no money would be the write-off
 * (`markNeedsWriteOffRight`), which this never does.
 */
async function readPartyPaymentForm(shopSlug: string, tripId: string, formData: FormData) {
  const back = tripPath(shopSlug, tripId);
  const bookingId = String(formData.get("bookingId") ?? "");
  const db = await getDb();
  const s = (await requireShopSurface(shopSlug)).session;
  await requireRosterBooking(db, s.user.shopId, tripId, bookingId, noticeUrl(back, "invalid"));
  const currency = await getShopCurrency(db, s.user.shopId);
  const mark = readManualPaymentMark(
    "paid",
    formData.get("amount") === null ? null : String(formData.get("amount")),
    formData.get("method") === null ? null : String(formData.get("method")),
    currency,
  );
  if (mark.kind === "invalid" || mark.kind === "no_money" || mark.kind === "not_money") {
    redirect(
      noticeUrl(
        back,
        mark.kind === "invalid" && mark.field === "method" ? "payment-method" : "payment-amount",
        {
          bid: bookingId,
        },
      ),
    );
  }
  return { back, bookingId, db, s, currency, mark };
}

/** Where a refused party payment goes back, with the reason in the notice. */
function partyRefusalUrl(
  back: string,
  bookingId: string,
  kind: "over" | "nothing_owed" | "refused" | "not_found",
) {
  const code =
    kind === "over"
      ? "party-over"
      : kind === "nothing_owed"
        ? "party-nothing-owed"
        : kind === "refused"
          ? "payment-online"
          : "invalid";
  return noticeUrl(back, code, { bid: bookingId });
}

/**
 * **Step one of "Mark the party paid"** (issue #2605): work out how the
 * payment would divide and send the staffer back to the roster to read it.
 * Nothing is written. The split shown is the server's own, and the confirm
 * below works it out again from the database rather than trusting this one.
 */
export async function previewPartyPaymentAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const { back, bookingId, db, s, mark } = await readPartyPaymentForm(shopSlug, tripId, formData);
  if (mark.kind !== "money") return;
  const preview = await previewPartyPayment(db, {
    shopId: s.user.shopId,
    tripId,
    leadBookingId: bookingId,
    amountCents: mark.amountCents,
  });
  if (preview.kind !== "split") redirect(partyRefusalUrl(back, bookingId, preview.kind));
  redirect(
    noticeUrl(back, "party-preview", {
      bid: bookingId,
      partyLead: bookingId,
      partyAmount: String(mark.amountCents),
      partyMethod: mark.method,
    }),
  );
}

/**
 * **Step two: take the payment** (issue #2605). One transaction pays the lead's
 * seat and each seat of the party in turn, each its balance owed first and
 * never more; no seat is written off, so recording money is all the right it
 * asks, the same as a single Paid mark. Each seat gets its own line in the
 * activity log, and the amount and method ride on its payment trail.
 */
export async function markPartyPaidAction(shopSlug: string, tripId: string, formData: FormData) {
  const { back, bookingId, db, s, currency, mark } = await readPartyPaymentForm(
    shopSlug,
    tripId,
    formData,
  );
  if (mark.kind !== "money") return;
  const result = await markPartyPaid(db, {
    shopId: s.user.shopId,
    tripId,
    leadBookingId: bookingId,
    amountCents: mark.amountCents,
    method: mark.method,
    currency,
    recordedByPersonId: s.user.personId,
  });
  if (result.kind !== "split") redirect(partyRefusalUrl(back, bookingId, result.kind));
  for (const share of result.shares) {
    await recordShopActivity(db, {
      shopId: s.user.shopId,
      actorPersonId: s.user.personId,
      write: { code: "party_marked_paid", bookingId: share.bookingId },
    });
  }
  revalidateAndRedirect(
    back,
    noticeUrl(back, result.unspentCents > 0 ? "party-paid-short" : "party-paid", {
      bid: bookingId,
    }),
  );
}
