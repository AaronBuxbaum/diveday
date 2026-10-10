"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { isDiverRemoved, updateDiver } from "@/db/divers";
import { sendStaffReply } from "@/db/staff-reply";
import { isPlausibleDateOfBirth } from "@/lib/age";
import { isValidCalendarDate } from "@/lib/calendar-date";
import { revalidateAndRedirect } from "@/lib/navigation";
import { blankableDiverEmailSchema, diverNameSchema, diverPhoneSchema } from "@/lib/person-fields";
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
  // Optional on the form and blank-able: H-08's minimum-age gate fails open, so
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
  const saved = await updateDiver(db, {
    shopId: staff.user.shopId,
    personId,
    ...parsed.data,
  });
  // Two very different things come back as null, and only one of them is an
  // email conflict. `updateDiver` will not touch a removed record at all, and
  // this record is reachable now — so telling a staffer to go fix a duplicate
  // email would send them after a conflict that does not exist. The extra read
  // is paid only on the failure path.
  const notice = saved
    ? "person-saved"
    : (await isDiverRemoved(db, staff.user.shopId, personId))
      ? "removed-read-only"
      : "duplicate";
  revalidateAndRedirect(base, backTo(base, notice, "details"));
}

/**
 * **Answer the diver, in the channel they wrote on** (ADR
 * 20260907-two-way-inbox).
 *
 * **Every live staff role may send as the shop.** Decided by the product owner
 * on 2026-09-10 as an amendment to H-14 (issues #1505/#1518); the argument is
 * decision 9 of that ADR, and the owner's call is H-14 in
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
  const messageId = uuidParam(String(formData.get("messageId") ?? ""));
  if (!messageId) {
    revalidateAndRedirect(base, backTo(base, "reply-message-not-found", "reply"));
  }
  const result = await sendStaffReply(db, {
    shopId: staff.user.shopId,
    personId,
    messageId,
    body: String(formData.get("body") ?? ""),
    sentByPersonId: staff.user.personId,
  });
  // `noticeUrl` kebabs the code, so a domain reason spelt snake_case needs no
  // translation here.
  const notice = result.status === "sent" ? "reply-sent" : `reply-${result.reason}`;
  revalidateAndRedirect(base, backTo(base, notice, "reply"));
}
