"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { paperGuardianFrom, paperWaiverRefused } from "@/app/actions/paper-waiver-fields";
import { confirmBookingIdentity } from "@/db/bookings";
import { checkInBooking, undoCheckInBooking } from "@/db/check-in";
import { getDb } from "@/db/client";
import { markBookingNoShow, undoBookingNoShow } from "@/db/no-show";
import { recordInPersonWaiver } from "@/db/waivers";
import { revalidateAndRedirect } from "@/lib/navigation";
import { PAPER_WAIVER_IDLE, type PaperWaiverFormState } from "@/lib/paper-waiver-form";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
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
  focusTripId: string | null,
  formData: FormData,
): Promise<{ ok: true }> {
  const session = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  const back = counterQueuePath(shopSlug, focusTripId);
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
  focusTripId: string | null,
  formData: FormData,
): Promise<{ ok: true }> {
  const session = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  const back = counterQueuePath(shopSlug, focusTripId);
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
  focusTripId: string | null,
  formData: FormData,
): Promise<void> {
  const session = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  const back = counterQueuePath(shopSlug, focusTripId);
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
  focusTripId: string | null,
  formData: FormData,
): Promise<void> {
  const session = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  const back = counterQueuePath(shopSlug, focusTripId);
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
 * The counter's version of the roster's "signed on paper" control — the diver
 * is standing right here holding the release, and until now the only way to
 * clear that blocker was to leave the queue for their trip's guest list.
 *
 * Same single write path as the roster (`recordInPersonWaiver`), so the record
 * is the same immutable, staff-attested one however it was reached; the
 * medical attestation is required there, not here, and a missing checkbox
 * comes back as its own sentence rather than a generic failure.
 *
 * **Neither answer navigates now.** Success never did — see below. A refusal
 * used to, and the redirect was what emptied the form: the staffer retyped the
 * medical tick, the co-signer's name and the relationship before they could fix
 * the one thing the notice named, at a wet counter with a family waiting (issue
 * #1674). It answers into the form's own `useActionState` instead, which is
 * also what carries those three values back — and it does so without the
 * guardian's name ever entering a URL, the address bar or an access log. The
 * refusal lands beside the button on the row it belongs to for free, which is
 * what the `bid` parameter was doing by hand (issue 1574).
 */
export async function markWaiverInPersonFromCheckIn(
  shopSlug: string,
  focusTripId: string | null,
  _state: PaperWaiverFormState,
  formData: FormData,
): Promise<PaperWaiverFormState> {
  const session = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  const back = counterQueuePath(shopSlug, focusTripId);
  // Not a seat this queue could be showing, so not a submission its form made.
  if (!uuidParam(bookingId)) return paperWaiverRefused("booking_not_found", formData);

  const outcome = await recordInPersonWaiver(await getDb(), {
    shopId: session.user.shopId,
    subject: { bookingId },
    recordedByPersonId: session.user.personId,
    medicalAttested: formData.get("medicalAttested") === "on",
    // A minor's paper release names its co-signer (ADR
    // 20260907-guardian-co-signature). Passed as typed; `recordInPersonWaiver`
    // decides from the date of birth on file whether it is needed at all, and
    // refuses a section that is not a signature.
    guardian: paperGuardianFrom(formData),
  });
  // Landing it in place, like the two above: the diver is standing at the
  // counter, and the answer they are waiting for is their own row losing its
  // "Waiver has not been sent" blocker and offering check-in. Redirecting for
  // a success banner threw away the search that found them, so the next act —
  // actually checking them in — began by typing their name again.
  if (outcome.ok) {
    revalidatePath(back);
    return PAPER_WAIVER_IDLE;
  }
  // The counter is where a family who share a legal name ends up after the
  // online path refused them, so it is the surface that most needs to say why
  // rather than "try again" (issue 1539) — and the one that then offers the
  // namesake confirmation on the same form, with what they typed still in it.
  // Nothing was written, so nothing is revalidated.
  return paperWaiverRefused(outcome.reason, formData);
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
 * it, and a redirect would throw away the search that found the diver — the
 * exact regression issue #1674 removed from the paper-waiver door two controls
 * over, on this same row. `counterQueuePath` carries the focused departure and
 * nothing else, so there is no landing that keeps a `?q=`.
 *
 * The refusal does navigate, because it has no row state to land on: the seat
 * was not held when the tap arrived — a double tap, or a row another staffer
 * cleared while this one was reading it — so on the next render the row has no
 * identity blocker and no confirm control, and a `useActionState` answer would
 * have nowhere to land. (For a booking this shop does not hold, the row is not
 * on the page at all.)
 *
 * **So the refusal carries the search with it** (`dive-domain-expert` review of
 * issue #1696). `counterQueuePath` holds the focused departure and nothing
 * else, and the branch that navigates is precisely the one with the diver still
 * at the desk — landing it on the bare queue threw away the `?q=` that found
 * them, which is the regression issue #1674 removed from the paper-waiver door
 * two controls along this row. Passed as a `noticeUrl` parameter, so it is
 * percent-encoded at the one door that builds these URLs rather than
 * concatenated here.
 */
export async function confirmIdentityFromCheckIn(
  shopSlug: string,
  focusTripId: string | null,
  /** The queue's live search, bound by the page — see the refusal below. */
  query: string | null,
  formData: FormData,
): Promise<void> {
  const session = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  const back = counterQueuePath(shopSlug, focusTripId);
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
  revalidateAndRedirect(
    back,
    noticeUrl(back, "identity-not-held", { q: query?.trim() || undefined }),
  );
}
