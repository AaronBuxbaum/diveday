"use server";

import { draftReplyFor, translateReplyFor } from "@/db/inbox-assists";
import { REPLY_BODY_MAX_LENGTH } from "@/lib/inbox";
import { requireShopSurface } from "@/lib/session";
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
  return { db, shopId: session.user.shopId, personId };
}

/** A reply to the diver's latest message, grounded in the shop's own schedule and prices. */
export async function draftReplyAction(shopSlug: string, personId: string): Promise<string | null> {
  const context = await composerContext(shopSlug, personId);
  if (!context) return null;
  return draftReplyFor(context.db, { shopId: context.shopId, personId: context.personId });
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
