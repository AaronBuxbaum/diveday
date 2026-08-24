"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonManageShopSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import {
  createChecklistItem,
  deleteChecklistItem,
  listChecklistItems,
  reorderChecklistItems,
} from "@/db/pre-departure-check";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

function backTo(shopSlug: string): string {
  return shopPath(shopSlug, "settings", "safety-checklist");
}

const addSchema = z.object({ label: z.string().trim().min(1).max(200) });

export async function addChecklistItemAction(shopSlug: string, formData: FormData): Promise<void> {
  const staff = await requireStaffSession();
  const back = backTo(shopSlug);
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(noticeUrl(back, "checklist-item-invalid"));
  const outcome = await createChecklistItem(await getDb(), {
    shopId: staff.user.shopId,
    personId: staff.user.personId,
    label: parsed.data.label,
  });
  if (!outcome.ok) redirect(noticeUrl(back, `checklist-item-${outcome.reason.replace(/_/g, "-")}`));
  redirect(noticeUrl(back, "checklist-item-added"));
}

const itemSchema = z.object({ itemId: z.string().uuid() });

export async function deleteChecklistItemAction(
  shopSlug: string,
  formData: FormData,
): Promise<void> {
  const staff = await requireStaffSession();
  const back = backTo(shopSlug);
  const parsed = itemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(noticeUrl(back, "checklist-item-invalid"));
  await deleteChecklistItem(await getDb(), {
    shopId: staff.user.shopId,
    personId: staff.user.personId,
    itemId: parsed.data.itemId,
  });
  redirect(noticeUrl(back, "checklist-item-deleted"));
}

const moveSchema = z.object({
  itemId: z.string().uuid(),
  direction: z.enum(["up", "down"]),
});

/**
 * Swap one item with its neighbor and write the whole order back —
 * `reorderChecklistItems` takes the list whole, and a short shop list makes
 * that cheaper than a dedicated single-row move.
 */
export async function moveChecklistItemAction(shopSlug: string, formData: FormData): Promise<void> {
  const staff = await requireStaffSession();
  const back = backTo(shopSlug);
  const parsed = moveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(noticeUrl(back, "checklist-item-invalid"));
  const db = await getDb();
  if (!(await canPersonManageShopSettings(db, staff.user.shopId, staff.user.personId))) {
    redirect(noticeUrl(back, "checklist-item-not-authorized"));
  }
  const items = await listChecklistItems(db, staff.user.shopId);
  const index = items.findIndex((item) => item.id === parsed.data.itemId);
  const swapWith = parsed.data.direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapWith < 0 || swapWith >= items.length) {
    redirect(noticeUrl(back, "checklist-item-move-refused"));
  }
  const orderedIds = items.map((item) => item.id);
  [orderedIds[index], orderedIds[swapWith]] = [orderedIds[swapWith], orderedIds[index]];
  await reorderChecklistItems(db, {
    shopId: staff.user.shopId,
    personId: staff.user.personId,
    orderedIds,
  });
  redirect(back);
}
