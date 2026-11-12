"use server";

import { personThread } from "@/db/inbound-messages";
import { bookingAskFromMessage } from "@/features/booking-ask-assists";
import { recordFormDraftIfVacant } from "@/features/form-drafts";
import { draftReplyOutcome, translateReplyFor } from "@/features/inbox-assists";
import { requireShopSurface } from "@/features/session";
import { REPLY_BODY_MAX_LENGTH } from "@/lib/inbox";
import { callPanelHref } from "@/lib/took-a-call";
import { uuidParam } from "@/lib/uuid";
import { isLiveStaff } from "./action-helpers";

/**
 * **The composer's two assists** (ADR 20261018-claude-assists; `inbox-draft`
 * and `translate`). Each answers text for the reply box, or null, and writes
 * nothing: the staffer reads it, edits it and sends it with the composer's own
 * Send. The record is the session's shop's, whatever the form carried; a
 * person id that names nobody in it answers null like a dark assist.
 */
async function composerContext(shopSlug: string, rawPersonId: string) {
  const personId = uuidParam(rawPersonId);
  if (!personId) return null;
  const { session, db } = await requireShopSurface(shopSlug);
  if (!(await isLiveStaff(db, session.user.shopId, session.user.personId))) return null;
  return { db, shopId: session.user.shopId, personId, staffId: session.user.personId };
}

/** What the one Draft button did with the diver's latest message. */
export type ConversationAssistResult =
  | { kind: "reply"; text: string }
  | { kind: "request"; href: string }
  | {
      kind: "none";
      reason: "unavailable" | "declined" | "nothing-to-answer" | "draft-exists";
    };

/**
 * **The conversation's one assist.** Reads the diver's latest message: when it
 * asks for a booking, the Took-a-call form is filled from it and the staffer
 * is sent there to check it; otherwise a reply is drafted into the reply box.
 * Neither records anything. A request that cannot be kept (an unfinished call
 * form is already open) falls back to a reply, and says nothing is lost.
 */
export async function assistConversationAction(
  shopSlug: string,
  personId: string,
): Promise<ConversationAssistResult> {
  const context = await composerContext(shopSlug, personId);
  if (!context) return { kind: "none", reason: "unavailable" };
  const { db, shopId } = context;
  const latest = (await personThread(db, shopId, context.personId))
    .filter((entry) => entry.direction === "inbound" && entry.message.channel !== "page")
    .at(-1);
  let draftExists = false;
  if (latest?.direction === "inbound") {
    const ask = await bookingAskFromMessage(db, { shopId, messageId: latest.message.id });
    const fields = ask ? Object.entries(ask.fields).filter(([, value]) => value) : [];
    // An outcome alone is not a request: at least two fields must have filled.
    if (ask && fields.length >= 2) {
      const saved = await recordFormDraftIfVacant(db, {
        shopId,
        personId: context.staffId,
        form: "took_a_call",
        fields,
      });
      if (saved === "saved") {
        return {
          kind: "request",
          href: callPanelHref(shopSlug, { outcome: "date-request" }, "call"),
        };
      }
      draftExists = saved === "exists";
    }
  }
  const reply = await draftReplyOutcome(db, { shopId, personId: context.personId });
  if ("reason" in reply === false) return { kind: "reply", text: reply.text };
  return { kind: "none", reason: draftExists ? "draft-exists" : reply.reason };
}

/** The staffer's reply in the language the diver last wrote in. */
export async function translateReplyAction(
  shopSlug: string,
  personId: string,
  text: string,
): Promise<string | null> {
  if (typeof text !== "string" || text.length > REPLY_BODY_MAX_LENGTH) return null;
  const context = await composerContext(shopSlug, personId);
  if (!context) return null;
  return translateReplyFor(context.db, {
    shopId: context.shopId,
    personId: context.personId,
    text,
  });
}
