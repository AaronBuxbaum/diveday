"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { confirmBookingIdentity, splitBookingIdentity } from "@/db/bookings";
import { checkInBooking, undoCheckInBooking } from "@/db/check-in";
import { getDb } from "@/db/client";
import { markBookingNoShow, undoBookingNoShow } from "@/db/no-show";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { counterQueuePath } from "./focus";

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
  const bookingId = String(formData.get("bookingId") ?? "");
  const back = counterQueuePath(shopSlug, tripId);
  if (!uuidParam(bookingId)) redirect(noticeUrl(back, "invalid"));

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
  const bookingId = String(formData.get("bookingId") ?? "");
  const back = counterQueuePath(shopSlug, tripId);
  if (!uuidParam(bookingId)) redirect(noticeUrl(back, "invalid"));

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
  const bookingId = String(formData.get("bookingId") ?? "");
  const back = counterQueuePath(shopSlug, tripId);
  if (!uuidParam(bookingId)) redirect(noticeUrl(back, "invalid"));

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
  const bookingId = String(formData.get("bookingId") ?? "");
  const back = counterQueuePath(shopSlug, tripId);
  if (!uuidParam(bookingId)) redirect(noticeUrl(back, "invalid"));

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

/**
 * **The counter confirms a held seat is who the record says** (H-13, issue
 * #1696) — the second door onto the roster's attestation, never a second
 * attestation.
 *
 * A seat the counter's own name-match prompt created is attached to an existing
 * diver on a guess, and `identity_unconfirmed` refuses it at the rail until a
 * staffer vouches for the person in front of them. Until now the only control
 * that cleared it was on the trip roster, so the counter met the flag as a
 * `not_ready` refusal from `checkInBooking` and had to leave the queue, open
 * the trip, expand a confirm and walk back — with a diver at the desk and a
 * queue behind them.
 *
 * `confirmBookingIdentity` is called, not copied: one write, one trail line,
 * one set of package settlements, whichever door reached it — the same rule
 * seating follows (`src/db/seat-diver.ts`).
 *
 * **Success answers in place, like every other tap on this surface.** The row
 * loses its confirm control and its identity blocker under the finger that did
 * it.
 *
 * The refusal does navigate, because it has no row state to land on: the seat
 * was not held when the tap arrived — a double tap, or a row another staffer
 * cleared while this one was reading it — so on the next render the row has no
 * identity blocker and no confirm control, and a `useActionState` answer would
 * have nowhere to land. (For a booking this shop does not hold, the row is not
 * on the page at all.)
 */
export async function confirmIdentityFromCheckIn(
  shopSlug: string,
  tripId: string,
  formData: FormData,
): Promise<void> {
  const session = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  const back = counterQueuePath(shopSlug, tripId);
  if (!uuidParam(bookingId)) redirect(noticeUrl(back, "invalid"));

  const confirmed = await confirmBookingIdentity(await getDb(), {
    shopId: session.user.shopId,
    bookingId,
    actorPersonId: session.user.personId,
    // The trail says which door this came through, because the evidence here is
    // different in kind: the person is at the desk (`IdentityConfirmDoor`).
    door: "counter",
  });
  if (confirmed) {
    revalidatePath(back);
    return;
  }
  revalidateAndRedirect(back, noticeUrl(back, "identity-not-held"));
}

/**
 * **The counter answers "different person"** (H-13; Aaron, 2026-10-05): the
 * held seat becomes a new diver of its own, named by the staffer, and leaves
 * the record it was guessed onto. The same write the roster's door makes
 * (`splitBookingIdentity`), answering in place like the confirm beside it; a
 * seat that was no longer held navigates with the same notice.
 */
export async function splitIdentityFromCheckIn(
  shopSlug: string,
  tripId: string,
  formData: FormData,
): Promise<void> {
  const session = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  const back = counterQueuePath(shopSlug, tripId);
  if (!uuidParam(bookingId)) redirect(noticeUrl(back, "invalid"));

  const split = await splitBookingIdentity(await getDb(), {
    shopId: session.user.shopId,
    bookingId,
    actorPersonId: session.user.personId,
    fullName: String(formData.get("fullName") ?? ""),
  });
  if (split.ok) {
    revalidatePath(back);
    return;
  }
  revalidateAndRedirect(back, noticeUrl(back, "identity-not-held"));
}
