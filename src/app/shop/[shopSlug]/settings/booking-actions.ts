"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { setShopPackingList } from "@/db/shops";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { settingsBlock } from "./action-helpers";

export async function savePackingAction(formData: FormData) {
  const session = await requireStaffSession();
  const settings = shopPath(session.user.shopSlug, "settings");
  await settingsBlock(session);
  const packingList = String(formData.get("packingList") ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  if (
    packingList.length < 1 ||
    packingList.length > 12 ||
    packingList.some((item) => item.length > 100)
  ) {
    redirect(noticeUrl(settings, "packing-invalid", { saved: "packing" }));
  }
  await setShopPackingList(await getDb(), session.user.shopId, packingList);
  revalidateAndRedirect(settings, noticeUrl(settings, "packing-saved", { saved: "packing" }));
}
