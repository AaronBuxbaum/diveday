"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { checkInBooking, undoCheckInBooking } from "@/db/check-in";
import { getDb } from "@/db/client";
import { markBookingNoShow, undoBookingNoShow } from "@/db/no-show";
import { parseForm } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { counterQueuePath } from "./focus";

/** Every door here posts one field: the seat it acts on. */
const bookingForm = z.object({
  bookingId: z.string().refine((id) => uuidParam(id) !== undefined),
});

/** The posted seat, or the counter's `invalid` notice back on this departure. */
function bookingIdFrom(formData: FormData, back: string): string {
  const parsed = parseForm(bookingForm, formData);
  if (!parsed.ok) redirect(noticeUrl(back, "invalid"));
  return parsed.data.bookingId;
}

/**
 * **Every refusal lands back on the boat the staffer was working.**
 *
 * The counter is one departure's Divers tab once arrivals open (ADR
 * 20261001-logbook, as amended 2026-10-05), bound to that departure by the page. `counterQueuePath` (./focus.ts) is the one
 * place the path back is built — including its `shopPath` escaping, since
 * `shopSlug` and `tripId` reach an action as ordinary caller-supplied
 * arguments.
 *
 * **And the `bookingId` every one of them reads is shape-checked before it is
 * spent, not merely checked for empty** (`uuidParam`, src/lib/uuid.ts). These
 * ids land in `eq(bookings.id, …)` a few frames later, and Postgres does not
 * coerce a malformed literal there — it raises `invalid input syntax for type
 * uuid`. So a truncated id took the counter down with an error page at exactly
 * the moment the queue's own `invalid` notice was the honest answer. The same
 * guard the trip roster's actions already carry, pinned the same way on both
 * surfaces (`actions.ids.test.ts`).
 */
export async function checkInAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
): Promise<{ ok: true }> {
  const session = await requireStaffSession();
  const back = counterQueuePath(shopSlug, tripId);
  const bookingId = bookingIdFrom(formData, back);

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
  tripId: string,
  formData: FormData,
): Promise<{ ok: true }> {
  const session = await requireStaffSession();
  const back = counterQueuePath(shopSlug, tripId);
  const bookingId = bookingIdFrom(formData, back);

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
 * **"Not here" — the counter records that a diver never turned up** (issue
 * #1209), and the seat goes back to the shop as the consequence of that one
 * tap.
 *
 * The two halves below are shaped exactly like `checkInAction` and
 * `undoCheckInAction` above, for the reason those two are shaped that way: a
 * refusal has to land back on the boat the staffer was working, or a queue
 * holding three departures answers a question about the wrong one.
 *
 * This layer adds nothing to the gate. `noShowGate` decides on the page
 * whether the disclosure is drawn, and `markBookingNoShow` runs it again
 * against locked rows because that is the run that counts; a third opinion in
 * between is one nobody asked for.
 */
export async function markNoShowAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
): Promise<void> {
  const session = await requireStaffSession();
  const back = counterQueuePath(shopSlug, tripId);
  const bookingId = bookingIdFrom(formData, back);

  const outcome = await markBookingNoShow(await getDb(), {
    shopId: session.user.shopId,
    bookingId,
    recordedByPersonId: session.user.personId,
  });
  if (outcome.ok) {
    // No success banner, the same rule the two taps above follow: the row
    // moves into the "Not here" group wearing that word and its Undo, and the
    // panel under it says who the seat can go to. A sentence at the top of the
    // page would restate that a screen away (design principle 9).
    revalidatePath(back);
    return;
  }
  revalidateAndRedirect(back, noticeUrl(back, `no_show_${outcome.reason}`));
}

/**
 * The diver who walks up as the lines come off.
 *
 * Its refusals worth a sentence are the two races: by the time somebody taps
 * Undo the freed seat may be sold, and `undoBookingNoShow` re-counts it under
 * the trip's lock against both limits rather than overfilling the boat —
 * capacity (`trip_full`) and, on a ratio-gated course session, the crew's own
 * seat cap (`course_ratio_full`).
 */
export async function undoNoShowAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
): Promise<void> {
  const session = await requireStaffSession();
  const back = counterQueuePath(shopSlug, tripId);
  const bookingId = bookingIdFrom(formData, back);

  const outcome = await undoBookingNoShow(await getDb(), {
    shopId: session.user.shopId,
    bookingId,
    recordedByPersonId: session.user.personId,
  });
  if (outcome.ok) {
    revalidatePath(back);
    return;
  }
  revalidateAndRedirect(back, noticeUrl(back, `no_show_${outcome.reason}`));
}
