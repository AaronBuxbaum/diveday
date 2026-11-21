"use server";

import { requireActiveStaffId } from "@/db/authz";
import { getDb } from "@/db/client";
import { requireStaffSession } from "@/features/accounts/session";
import { draftReplyToMessage } from "@/features/ai/inbox-assists";
import { uuidParam } from "@/lib/uuid";

/** Draft only: no booking, saved request or message is created. */
export async function draftInboxResponseAction(rawMessageId: string): Promise<string | null> {
  const messageId = uuidParam(rawMessageId);
  if (!messageId) return null;
  const session = await requireStaffSession();
  const db = await getDb();
  const { shopId, personId } = session.user;
  if (!(await requireActiveStaffId(db, shopId, personId))) return null;
  return draftReplyToMessage(db, { shopId, messageId });
}
