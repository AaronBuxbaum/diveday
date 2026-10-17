"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { paperWaiverAttestation, paperWaiverRefused } from "@/app/actions/paper-waiver-fields";
import { canPersonRetireMedicalRefusal } from "@/db/authz";
import { getDb } from "@/db/client";
import { deliverWaiverBatch } from "@/db/waiver-issue";
import { recordInPersonWaiver, retireMedicalRefusal } from "@/db/waivers";
import { readForm, text } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { PAPER_WAIVER_IDLE, type PaperWaiverFormState } from "@/lib/paper-waiver-form";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { isRosterBooking, requireRosterBooking, tripPath } from "./roster-booking";

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
const rosterBookingForm = z.object({ bookingId: text() });

export async function sendNewWaiverAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const { bookingId } = readForm(rosterBookingForm, formData);
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
  const { bookingId } = readForm(rosterBookingForm, formData);
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
