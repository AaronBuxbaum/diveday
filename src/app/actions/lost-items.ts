"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { RecordLostItemState } from "@/components/lost-found/LostItemForm";
import type { LostItemRowState } from "@/components/lost-found/LostItemRow";
import { type AppDb, getDb } from "@/db/client";
import { recordLostItem, setLostItemStatus, tellLostItemOwner } from "@/db/lost-items";
import { getShopById } from "@/db/shops";
import { requireStaffSession } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";

/**
 * **Lost and found** (batch 4, J2): recorded from a departure's Boat tab,
 * worked from there or from the shop's open list. The shop comes off the
 * session, never the form; the ids that do come off the form are re-scoped
 * by it in `src/db/lost-items.ts`.
 */

/** Under the session's own shop's slug, never one the page bound in. */
async function revalidateLostItems(db: AppDb, shopId: string, tripId: string) {
  const shop = await getShopById(db, shopId);
  if (!shop) return;
  revalidatePath(shopPath(shop.slug, "trips", tripId, "manifest"));
  revalidatePath(shopPath(shop.slug, "lost-found"));
}

export async function recordLostItemAction(
  tripId: string,
  _previous: RecordLostItemState | undefined,
  formData: FormData,
): Promise<RecordLostItemState> {
  const session = await requireStaffSession();
  if (!z.uuid().safeParse(tripId).success) return { status: "refused", reason: "invalid" };
  const seat = String(formData.get("bookingId") ?? "");
  if (seat && !z.uuid().safeParse(seat).success) return { status: "refused", reason: "invalid" };
  const db = await getDb();
  const result = await recordLostItem(db, {
    shopId: session.user.shopId,
    tripId,
    bookingId: seat || null,
    description: String(formData.get("description") ?? ""),
    actorPersonId: session.user.personId,
  });
  if (!result.ok) return { status: "refused", reason: result.reason };
  await revalidateLostItems(db, session.user.shopId, tripId);
  return { status: "recorded", id: result.item.id };
}

const rowSchema = z.object({
  itemId: z.uuid(),
  intent: z.enum(["tell", "returned", "discarded", "open"]),
});

/** One row's buttons: tell the owner, mark returned or discarded, or reopen. */
export async function lostItemRowAction(
  tripId: string,
  _previous: LostItemRowState | undefined,
  formData: FormData,
): Promise<LostItemRowState> {
  const session = await requireStaffSession();
  const parsed = rowSchema.safeParse({
    itemId: formData.get("itemId"),
    intent: formData.get("intent"),
  });
  if (!parsed.success || !z.uuid().safeParse(tripId).success) {
    return { status: "refused", reason: "invalid" };
  }
  const db = await getDb();
  const shopId = session.user.shopId;
  const { itemId, intent } = parsed.data;
  if (intent === "tell") {
    const told = await tellLostItemOwner(db, { shopId, itemId });
    await revalidateLostItems(db, shopId, tripId);
    return told.ok
      ? { status: "told", channel: told.channel }
      : { status: "refused", reason: told.reason };
  }
  const changed = await setLostItemStatus(db, {
    shopId,
    itemId,
    status: intent,
    actorPersonId: session.user.personId,
  });
  await revalidateLostItems(db, shopId, tripId);
  return changed ? { status: "resolved" } : { status: "refused", reason: "not_found" };
}
