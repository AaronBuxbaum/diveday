"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { checkInBooking, undoCheckInBooking } from "@/db/check-in";
import { getDb } from "@/db/client";
import { recordInPersonWaiver } from "@/db/waivers";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl } from "@/lib/staff-notices";
import { counterQueuePath } from "./focus";

/**
 * **Every refusal lands back on the boat the staffer was working.**
 *
 * The counter is one instrument pointed at one departure (ADR
 * 20260827-clearwater-surface-language, decision 9), and the focus lives in
 * the URL as `?trip=`. So the path these three actions redirect to has to
 * carry it: without it a `not-ready` refusal re-points the instrument at the
 * morning boat while the diver it is about is standing at the desk for the
 * afternoon one. `counterQueuePath` (./focus.ts) is the one place that path is
 * built — including its `shopPath` escaping, since `shopSlug` reaches an
 * action as an ordinary caller-supplied argument.
 */
export async function checkInAction(
  shopSlug: string,
  focusTripId: string | null,
  formData: FormData,
): Promise<{ ok: true }> {
  const session = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  const back = counterQueuePath(shopSlug, focusTripId);
  if (!bookingId) redirect(noticeUrl(back, "invalid"));

  const outcome = await checkInBooking(await getDb(), {
    shopId: session.user.shopId,
    bookingId,
    recordedByPersonId: session.user.personId,
  });
  if (outcome.ok) {
    // No success banner: the diver's row sinking into the settled group,
    // wearing its drawn check where the finger just was, is the confirmation
    // (docs/design/forms-and-controls.md; design principle 9). A duplicate tap
    // lands on the same settled row, which already says everything a banner
    // would. Refusals below keep their notices — they have no row state to
    // land on.
    //
    // Nothing is carried back about *which* row settled, because nothing on
    // the page needs it any more: the row used to wear a "tap again to undo"
    // sentence, and a settled control that a finger just put into that state
    // is its own affordance.
    //
    // Redirecting to the same path forces the server-rendered row to settle;
    // unlike a bare revalidation it also refreshes the current browser view.
    revalidatePath(back);
    return { ok: true };
  }
  revalidatePath(back);
  // `not_ready` carries the diver's booking/trip so the notice can link
  // straight to their guest row instead of just naming the problem.
  if (outcome.reason === "not_ready" && outcome.tripId) {
    redirect(noticeUrl(back, "not-ready", { bid: bookingId, tid: outcome.tripId }));
  }
  // `outcome.reason` is a domain code in the domain's own casing; `noticeUrl`
  // encodes it and normalises it to the one spelling the queue's notice map
  // holds. Interpolating it raw was how a value carrying `&` or `#` could
  // append query params of its own.
  redirect(noticeUrl(back, outcome.reason));
}

/**
 * The re-tap half of the queue's one-tap row: a settled "Checked in" row
 * tapped again reopens the arrival queue (design principle 7 — a
 * high-frequency toggle gets re-tap undo, never a blocking confirm). The
 * correction lands in the activity trail as its own event.
 */
export async function undoCheckInAction(
  shopSlug: string,
  focusTripId: string | null,
  formData: FormData,
): Promise<{ ok: true }> {
  const session = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  const back = counterQueuePath(shopSlug, focusTripId);
  if (!bookingId) redirect(noticeUrl(back, "invalid"));

  const outcome = await undoCheckInBooking(await getDb(), {
    shopId: session.user.shopId,
    bookingId,
    recordedByPersonId: session.user.personId,
  });
  if (outcome.ok) {
    // Same rule as checking in: the row reverting to its tappable "Check in ○"
    // state is the confirmation — no banner restating it from the top of the
    // page, and no navigation to deliver one.
    revalidatePath(back);
    return { ok: true };
  }
  revalidatePath(back);
  redirect(noticeUrl(back, outcome.reason === "not_checked_in" ? "not-bookable" : outcome.reason));
}

/**
 * The counter's version of the roster's "signed on paper" control — the diver
 * is standing right here holding the release, and until now the only way to
 * clear that blocker was to leave the queue for their trip's guest list.
 *
 * Same single write path as the roster (`recordInPersonWaiver`), so the record
 * is the same immutable, staff-attested one however it was reached; the
 * medical attestation is required there, not here, and a missing checkbox
 * comes back as its own notice rather than a generic failure.
 */
export async function markWaiverInPersonFromCheckIn(
  shopSlug: string,
  focusTripId: string | null,
  formData: FormData,
) {
  const session = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  const back = counterQueuePath(shopSlug, focusTripId);
  if (!bookingId) redirect(noticeUrl(back, "invalid"));

  const outcome = await recordInPersonWaiver(await getDb(), {
    shopId: session.user.shopId,
    subject: { bookingId },
    recordedByPersonId: session.user.personId,
    medicalAttested: formData.get("medicalAttested") === "on",
  });
  // Landing it in place, like the two above: the diver is standing at the
  // counter, and the answer they are waiting for is their own row losing its
  // "Waiver has not been sent" blocker and offering check-in. Redirecting for
  // a success banner threw away the search that found them, so the next act —
  // actually checking them in — began by typing their name again.
  if (outcome.ok) {
    revalidatePath(back);
    return;
  }
  revalidateAndRedirect(
    back,
    noticeUrl(
      back,
      outcome.reason === "medical_attestation_required"
        ? "waiver-medical-attestation"
        : "waiver-error",
    ),
  );
}
