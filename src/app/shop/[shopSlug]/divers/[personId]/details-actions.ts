"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { isDiverRemoved, updateDiver } from "@/db/divers";
import { sendStaffReply, sendWhatsAppReopen } from "@/db/staff-reply";
import { isPlausibleDateOfBirth } from "@/lib/age";
import { isValidCalendarDate } from "@/lib/calendar-date";
import { readForm, text } from "@/lib/form-parse";
import { WHATSAPP_REOPEN_MESSAGES } from "@/lib/inbox";
import { revalidateAndRedirect } from "@/lib/navigation";
import { blankableDiverEmailSchema, diverNameSchema, diverPhoneSchema } from "@/lib/person-fields";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { uuidParam } from "@/lib/uuid";
import { backTo, requireDiverActionContext } from "./action-helpers";

const personSchema = z.object({
  // Shared diver person-field bounds (src/lib/person-fields.ts); blank-able
  // email is this form's own call — clearing a wrong address to "" is valid.
  fullName: diverNameSchema,
  email: blankableDiverEmailSchema,
  phone: diverPhoneSchema,
  diveInsurance: z.string().trim().max(120),
  // Same bounds as `emergencyContactSchema` (src/lib/contact.ts), the shared
  // shape the diver-facing /ready and /waivers capture already validates
  // against — kept in sync by hand since this form also allows clearing a
  // wrong entry to "", which that schema's `.optional()` fields don't need to.
  emergencyContactName: z.string().trim().max(120),
  emergencyContactPhone: z.string().trim().max(40),
  // Optional on the form and blank-able: H-20260724-certification-levels-agency-rules's minimum-age gate fails open, so
  // a shop that never fills this in keeps booking exactly as it does today. The
  // plausibility bound is the one place it fails *closed*: a future or
  // pre-1900 date is a typo, and a future one would silently refuse every
  // age-gated course.
  dateOfBirth: z.union([
    z.literal(""),
    z
      .string()
      .refine(isValidCalendarDate, "not a real calendar date")
      // Arrow, not a bare reference: zod passes a second argument to the
      // predicate, which would land in the injectable `now` parameter.
      .refine((value) => isPlausibleDateOfBirth(value), "not a plausible date of birth"),
  ]),
  // The "They're 18 or older" box beside a stored date: unticked posts nothing.
  adultAttested: z.literal("yes").optional(),
});
export async function savePersonAction(shopSlug: string, personId: string, formData: FormData) {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-details",
    "details",
  );
  personId = context.personId;
  const { base, db, staff } = context;
  const parsed = personSchema.safeParse(Object.fromEntries(formData));
  // `&form=` is how a code half a dozen actions emit finds its way back to the
  // form that emitted it, instead of into a banner at the top of a 6,400px page
  // (`resolveDiverNotice`).
  if (!parsed.success) redirect(backTo(base, "invalid", "details"));
  const { adultAttested, ...fields } = parsed.data;
  const saved = await updateDiver(db, {
    shopId: staff.user.shopId,
    personId,
    ...fields,
    // "They're 18 or older" is this staffer's word, filed with them; it is
    // what lets a stored date of birth be emptied (issue #2167).
    adultAttestedByPersonId: adultAttested ? staff.user.personId : undefined,
  });
  // A record this staffer reached but cannot write is either removed since
  // (read-only) or merged away; neither is an email conflict, so it is not
  // worded as one. The extra read is paid only on that path.
  const notice = saved.ok
    ? saved.adultAnswerUnused
      ? "person-saved-adult-answer-unused"
      : "person-saved"
    : saved.reason === "email_in_use"
      ? "duplicate"
      : saved.reason === "age_unstated"
        ? "date-of-birth-age-unstated"
        : saved.reason === "date_of_birth_required"
          ? "date-of-birth-course-minimum-age"
          : (await isDiverRemoved(db, staff.user.shopId, personId))
            ? "removed-read-only"
            : "invalid";
  revalidateAndRedirect(base, backTo(base, notice, "details"));
}

const replyForm = z.object({ messageId: text(), body: text() });

/**
 * **Answer the diver, in the channel they wrote on** (ADR
 * 20260907-two-way-inbox).
 *
 * **Every live staff role may send as the shop.** Decided by the product owner
 * on 2026-09-10 as an amendment to H-20260724-staff-role-reach (issues #1505/#1518); the argument is
 * decision 9 of that ADR, and the owner's call is H-20260724-staff-role-reach in
 * `docs/product/human-decisions/README.md`. What it means here is that the argument
 * which opened the inbox to reading extends to writing — there is no narrower
 * gate on sending than there is on looking.
 *
 * So there is one gate left, and `requireDiverActionContext` makes it: the
 * `isLiveStaff` check every action on this page runs before its own. A
 * demoted, disabled or deleted account loses the composer on its next request
 * rather than at its next sign-in, which is what the deleted owner/manager
 * gate was really buying.
 *
 * Everything after that belongs to `sendStaffReply`, which owns the whole
 * consequence: the message decides the channel, the diver's own locale decides
 * the language, and the outcome is recorded whether it went out or not. This
 * only turns its code into a notice beside the composer.
 */
export async function replyToDiverAction(shopSlug: string, personId: string, formData: FormData) {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-reply",
    "reply",
  );
  personId = context.personId;
  const { base, db, staff } = context;
  // A posted id is caller-controlled: narrowed before it reaches a `uuid`
  // comparison, and answered with the same "no such message" a wrong-record or
  // wrong-tenant id gets.
  const form = readForm(replyForm, formData);
  const messageId = uuidParam(form.messageId);
  if (!messageId) {
    revalidateAndRedirect(base, backTo(base, "reply-message-not-found", "reply"));
  }
  const sendAllowed = await checkRateLimit(
    rateLimitKey("staff-send", "reply", staff.user.personId),
    RATE_LIMITS.staffSendByActor,
  );
  if (!sendAllowed.allowed) {
    revalidateAndRedirect(base, backTo(base, "reply-send-limit", "reply"));
  }
  const result = await sendStaffReply(db, {
    shopId: staff.user.shopId,
    personId,
    messageId,
    body: form.body,
    sentByPersonId: staff.user.personId,
  });
  // `noticeUrl` kebabs the code, so a domain reason spelt snake_case needs no
  // translation here.
  const notice = result.status === "sent" ? "reply-sent" : `reply-${result.reason}`;
  revalidateAndRedirect(base, backTo(base, notice, "reply"));
}

const reopenForm = z.object({ messageId: text(), message: z.enum(WHATSAPP_REOPEN_MESSAGES) });

/**
 * **Ask the diver to write back on WhatsApp**, once a typed reply can no
 * longer go (`sendWhatsAppReopen`). The same gate and the same per-staff send
 * bound as a typed reply: it is the shop speaking either way.
 */
export async function reopenWhatsAppAction(shopSlug: string, personId: string, formData: FormData) {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-reply",
    "reply",
  );
  personId = context.personId;
  const { base, db, staff } = context;
  const parsed = reopenForm.safeParse(Object.fromEntries(formData));
  const messageId = parsed.success ? uuidParam(parsed.data.messageId) : null;
  if (!parsed.success || !messageId) {
    revalidateAndRedirect(base, backTo(base, "reopen-message-not-found", "reply"));
  }
  const sendAllowed = await checkRateLimit(
    rateLimitKey("staff-send", "reply", staff.user.personId),
    RATE_LIMITS.staffSendByActor,
  );
  if (!sendAllowed.allowed) {
    revalidateAndRedirect(base, backTo(base, "reopen-send-limit", "reply"));
  }
  const result = await sendWhatsAppReopen(db, {
    shopId: staff.user.shopId,
    personId,
    messageId,
    message: parsed.data.message,
    sentByPersonId: staff.user.personId,
  });
  const notice =
    result.status === "sent"
      ? "reopen-sent"
      : result.status === "failed"
        ? "reopen-send-failed"
        : `reopen-${result.reason}`;
  revalidateAndRedirect(base, backTo(base, notice, "reply"));
}
