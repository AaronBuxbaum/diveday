"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { seatNewDiverAction } from "@/app/actions/seat-diver";
import { addToWaitlistAction } from "@/app/shop/[shopSlug]/trips/[id]/actions";
import { recordCourseInquiry } from "@/db/course-inquiries";
import { discardFormDraft } from "@/db/form-drafts";
import { isValidCalendarDate } from "@/lib/calendar-date";
import { revalidateAndRedirect } from "@/lib/navigation";
import { blankableDiverEmailSchema, diverNameSchema, diverPhoneSchema } from "@/lib/person-fields";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { type CallOutcome, type CallRefusal, callRefusal, isCallOutcome } from "@/lib/took-a-call";

/**
 * **"Took a call"** (N-22): one submission from the desk phone, routed to
 * whichever of three existing writers the call turned out to be about.
 *
 * The routing is the whole feature. Nothing new is written here: a date request
 * is `recordCourseInquiry`, a wait-list entry is the trip page's own
 * `addToWaitlistAction`, and a booking is the shared `seatNewDiverAction` on the
 * `new-booking` surface — the same door the global "Add a booking" form
 * submits to, so a phone booking owes the identical consequences (the waiver
 * send, the activity trail, the duplicate-name confirmation, the analytics
 * event). A fourth path to a booking is exactly what `src/db/seat-diver.ts`
 * exists to prevent.
 *
 * Delegating rather than re-implementing also decides where a *refused* call
 * lands, correctly and for free: a booking refused for a full boat comes back
 * on `bookings/new/<tripId>` with the boat still chosen and the refusal in that
 * page's own words, and a wait-list join on a departure that turns out to have
 * a seat comes back on the trip page saying so. Only the refusals this form can
 * see before any of them runs — a caller with no name, no way to ring back, or
 * no answer to what they wanted — land back here.
 */

/** A `<input type="date">` value, refused unless it is a date that exists. */
const calendarDate = z.string().refine(isValidCalendarDate);

/**
 * Everything the form can submit. Every field past the caller's own three is
 * optional *here* and required by outcome in `callRefusal`
 * (src/lib/took-a-call.ts) — one rule, read by the fields component and this
 * action alike, rather than a `required` attribute and a schema that can drift
 * apart.
 */
const callSchema = z.object({
  fullName: diverNameSchema,
  email: blankableDiverEmailSchema.optional(),
  phone: diverPhoneSchema.optional(),
  tripId: z.uuid().optional(),
  interest: z.string().trim().max(200).optional(),
  preferredDate: calendarDate.optional(),
  divers: z.coerce.number().int().min(1).max(12).optional(),
  message: z.string().trim().max(1500).optional(),
});

const REFUSAL_NOTICE: Record<CallRefusal, string> = {
  name: "call-name",
  reply: "call-reply",
  email: "call-email",
  departure: "call-departure",
  interest: "call-interest",
};

/**
 * Back to the phone, saying which answer is still missing.
 *
 * A bare `redirect`, not `revalidateAndRedirect`: nothing has been written and
 * nothing the form read has gone stale, so there is no cached segment to
 * invalidate. The refusals that *do* mean "the seats you were shown are gone"
 * belong to the doors this action delegates to, and they revalidate for
 * themselves.
 */
function refuse(shopSlug: string, notice: string, outcome: CallOutcome | null): never {
  const back = shopPath(shopSlug, "calls");
  // The chosen branch rides back so the form reopens on it: a refusal that
  // collapsed the caller's answer to "nothing chosen" would make the staffer
  // re-read three options with somebody on the line.
  redirect(noticeUrl(back, notice, { outcome: outcome ?? undefined }));
}

export async function tookACallAction(shopSlug: string, formData: FormData): Promise<void> {
  const { db, shop, session } = await requireShopSurface(shopSlug);
  const rawOutcome = formData.get("outcome");
  const outcome = isCallOutcome(rawOutcome) ? rawOutcome : null;
  if (!outcome) refuse(shopSlug, "call-invalid", null);

  const parsed = callSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    tripId: formData.get("tripId") || undefined,
    interest: formData.get("interest") || undefined,
    preferredDate: formData.get("preferredDate") || undefined,
    divers: formData.get("divers") || undefined,
    message: formData.get("message") || undefined,
  });
  if (!parsed.success) refuse(shopSlug, "call-invalid", outcome);

  const refusal = callRefusal(outcome, parsed.data);
  if (refusal) refuse(shopSlug, REFUSAL_NOTICE[refusal], outcome);

  // The call was taken: whatever half-typed copy of it was being kept is
  // finished with. Discarded *before* the write, because each branch below
  // ends in a redirect that throws.
  await discardFormDraft(db, shop.id, session.user.personId, "took_a_call");

  const { fullName, email, phone, tripId, interest, preferredDate, divers, message } = parsed.data;

  if (outcome === "date-request") {
    await recordCourseInquiry(db, {
      shopId: shop.id,
      // Always an interest, never a course: the desk is writing down what
      // somebody said on the phone, and picking a course row for them would be
      // the staffer's guess recorded as the caller's words. A request that
      // turns out to be about a course is matched on the Requests page, where
      // the whole day's leads are read together.
      interest,
      name: fullName,
      email,
      phone,
      preferredDate,
      divers,
      message,
    });
    const requests = shopPath(shopSlug, "requests");
    revalidateAndRedirect(requests, noticeUrl(requests, "call-logged"));
  }

  // The two outcomes that name a departure hand off to the doors that already
  // own them; both redirect, so neither returns.
  const handoff = new FormData();
  handoff.set("fullName", fullName);
  if (email) handoff.set("email", email);
  if (phone) handoff.set("phone", phone);

  if (outcome === "waitlist") {
    // `tripId` is proved present by `callRefusal` above for this outcome.
    await addToWaitlistAction(shopSlug, tripId as string, handoff);
    return;
  }

  handoff.set("tripId", tripId as string);
  await seatNewDiverAction("new-booking", shopSlug, handoff);
}
