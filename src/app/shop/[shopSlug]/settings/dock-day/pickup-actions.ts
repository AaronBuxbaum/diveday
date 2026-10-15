"use server";

import { z } from "zod";
import { getDb } from "@/db/client";
import { setShopOffersHotelPickup } from "@/db/shops";
import { checkbox, readForm } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { settingsBlock } from "../action-helpers";

const pickupForm = z.object({ offersHotelPickup: checkbox() });

/**
 * **"We offer hotel pickup"** (fourth UX review, item 8). Off by default; on,
 * `/ready` asks each diver "Want a pickup?" and where they are staying.
 */
export async function saveHotelPickupAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "settings", "dock-day");
  await settingsBlock(session);
  const { offersHotelPickup } = readForm(pickupForm, formData);
  await setShopOffersHotelPickup(await getDb(), session.user.shopId, offersHotelPickup);
  revalidateAndRedirect(page, noticeUrl(page, "pickup-saved"));
}
