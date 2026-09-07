"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteInboundMessage, markInboundAnswered } from "@/db/inbound-messages";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

/**
 * The two acts the inbox itself offers, as opposed to answering — which
 * happens on the diver's record, where the conversation is (ADR
 * 20260907-two-way-inbox).
 *
 * Neither answers with a notice when it works: marking a message answered
 * moves its row into the group below, and deleting takes the row off the
 * page, so a confirmation line would be a caption on a photograph of itself.
 * Only a message that is no longer there has anything to say.
 */

async function inboxSurface(shopSlug: string) {
  const { db, shop } = await requireShopSurface(shopSlug);
  return { db, shopId: shop.id, path: shopPath(shop.slug, "inbox") };
}

/** "Handled by phone" — the other way a message stops waiting on the shop. */
export async function markAnsweredAction(shopSlug: string, formData: FormData): Promise<void> {
  const { db, shopId, path } = await inboxSurface(shopSlug);
  const messageId = String(formData.get("messageId") ?? "");
  // An id that is not a uuid names no row, and comparing junk against a `uuid`
  // column raises in Postgres — so it is refused here rather than 500ing.
  const stamped = uuidParam(messageId) && (await markInboundAnswered(db, shopId, messageId));
  if (!stamped) redirect(noticeUrl(path, "message-not-found"));
  revalidatePath(path);
}

/** Soft delete (ADR 20260820-every-delete-is-soft): the row stays, the page does not show it. */
export async function deleteMessageAction(shopSlug: string, formData: FormData): Promise<void> {
  const { db, shopId, path } = await inboxSurface(shopSlug);
  const messageId = String(formData.get("messageId") ?? "");
  const removed = uuidParam(messageId) && (await deleteInboundMessage(db, shopId, messageId));
  if (!removed) redirect(noticeUrl(path, "message-not-found"));
  revalidatePath(path);
}
