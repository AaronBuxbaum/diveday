"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { RecordLostItemState } from "@/components/lost-found/LostItemForm";
import type { LostItemRowState } from "@/components/lost-found/LostItemRow";
import { getDb } from "@/db/client";
import { recordLostItem, setLostItemStatus, tellLostItemOwner } from "@/db/lost-items";
import { requireStaffSession } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";

/**
 * **Lost and found** (batch 4, J2): recorded from a departure's Boat tab,
 * worked from there or from the shop's open list. The shop comes off the
 * session, never the form; the ids that do come off the form are re-scoped
 * by it in `src/db/lost-items.ts`.
 */

function revalidateLostItems(shopSlug: string, tripId?: string) {
  if (tripId) revalidatePath(shopPath(shopSlug, "trips", tripId, "manifest"));
  revalidatePath(shopPath(shopSlug, "lost-found"));
}

export async function recordLostItemAction(
  ctx: { shopSlug: string; tripId: string },
  _previous: RecordLostItemState | undefined,
  formData: FormData,
): Promise<RecordLostItemState> {
  const session = await requireStaffSession();
  if (!z.uuid().safeParse(ctx.tripId).success) return { status: "refused", reason: "invalid" };
  const seat = String(formData.get("bookingId") ?? "");
  if (seat && !z.uuid().safeParse(seat).success) return { status: "refused", reason: "invalid" };
  const result = await recordLostItem(await getDb(), {
    shopId: session.user.shopId,
    tripId: ctx.tripId,
    bookingId: seat || null,
    description: String(formData.get("description") ?? ""),
    actorPersonId: session.user.personId,
  });
  if (!result.ok) return { status: "refused", reason: result.reason };
  revalidateLostItems(ctx.shopSlug, ctx.tripId);
  return { status: "recorded", id: result.item.id };
}

const rowSchema = z.object({
  itemId: z.uuid(),
  intent: z.enum(["tell", "returned", "discarded", "open"]),
});

/** One row's buttons: tell the owner, mark returned or discarded, or reopen. */
export async function lostItemRowAction(
  ctx: { shopSlug: string; tripId: string },
  _previous: LostItemRowState | undefined,
  formData: FormData,
): Promise<LostItemRowState> {
  const session = await requireStaffSession();
  const parsed = rowSchema.safeParse({
    itemId: formData.get("itemId"),
    intent: formData.get("intent"),
  });
  if (!parsed.success) return { status: "refused", reason: "invalid" };
  const db = await getDb();
  const shopId = session.user.shopId;
  const { itemId, intent } = parsed.data;
  if (intent === "tell") {
    const told = await tellLostItemOwner(db, { shopId, itemId });
    revalidateLostItems(ctx.shopSlug, ctx.tripId);
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
  revalidateLostItems(ctx.shopSlug, ctx.tripId);
  return changed ? { status: "resolved" } : { status: "refused", reason: "not_found" };
}
