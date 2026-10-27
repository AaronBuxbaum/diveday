"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { loadActiveStaffRoles } from "@/db/authz";
import { bookingAskFromMessage } from "@/db/booking-ask-assists";
import { getDb } from "@/db/client";
import { saveFormDraftIfVacant } from "@/db/form-drafts";
import { readForm } from "@/lib/form-parse";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

const requestForm = z.object({
  messageId: z.string().default(""),
  returnPersonId: z.string().default(""),
});

/**
 * **A booking email, read into a request** (ADR 20261018-claude-assists; the
 * `request` assist).
 *
 * Claude reads the message into the Took-a-call form's own fields, which are
 * kept as this staffer's draft of that form, and the staffer lands on it with
 * every field in view. Nothing is recorded here: the request is written by the
 * form's own action once a person has read it and pressed Log, and the
 * request planner and admission decide everything after that, as for any
 * request. The message is read inside the session's shop only, so a posted id
 * from another shop reads nothing.
 *
 * The gate is the inbox's: a live staff session bound to its shop (see
 * `deleteInboxMessageAction`).
 */
export async function requestFromMessageAction(formData: FormData): Promise<void> {
  const session = await requireStaffSession();
  const db = await getDb();
  const { shopId, shopSlug, personId } = session.user;
  if (!(await loadActiveStaffRoles(db, shopId, personId))) redirect(shopPath(shopSlug, "inbox"));
  const input = readForm(requestForm, formData);
  const messageId = uuidParam(input.messageId);
  const returnPersonId = uuidParam(input.returnPersonId);
  const inbox = shopPath(shopSlug, "inbox");
  const returnPath = returnPersonId
    ? `${shopPath(shopSlug, "divers", returnPersonId)}#conversation`
    : inbox;
  const ask = messageId ? await bookingAskFromMessage(db, { shopId, messageId }) : null;
  const fields = ask ? Object.entries(ask.fields).filter(([, value]) => value) : [];
  // An outcome alone is not a request: nothing in the message filled a field.
  if (!ask || fields.length < 2) {
    redirect(noticeUrl(returnPath, "request-nothing"));
  }
  const saved = await saveFormDraftIfVacant(db, { shopId, personId, form: "took_a_call", fields });
  if (saved === "empty") redirect(noticeUrl(returnPath, "request-nothing"));
  if (saved === "exists") redirect(noticeUrl(returnPath, "request-draft-exists"));
  redirect(`${shopPath(shopSlug, "bookings", "new")}?outcome=date-request#call`);
}
