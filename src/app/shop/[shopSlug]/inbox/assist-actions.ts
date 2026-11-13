"use server";

import { requireActiveStaffId } from "@/db/authz";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { draftReplyToMessage } from "@/features/inbox-assists";
import { requireStaffSession } from "@/features/session";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { uuidParam } from "@/lib/uuid";

/** Draft only: no booking, saved request or message is created. */
export async function draftInboxResponseAction(rawMessageId: string): Promise<string | null> {
  const messageId = uuidParam(rawMessageId);
  if (!messageId) return null;
  const session = await requireStaffSession();
  const db = await getDb();
  const { shopId, personId } = session.user;
  if (!(await requireActiveStaffId(db, shopId, personId))) return null;
  const shop = await getShopById(db, shopId);
  const t = staffTranslator(await requestLocale(shop?.defaultLocale));
  return draftReplyToMessage(db, {
    shopId,
    messageId,
    fallback: t("assistsFront.inbox.responseFallback"),
  });
}
