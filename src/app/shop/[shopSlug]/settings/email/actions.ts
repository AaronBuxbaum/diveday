"use server";

import { revalidatePath } from "next/cache";
import { setWeeklyDigestChoice } from "@/db/weekly-digest";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";

/**
 * The staffer's own answer to the Monday email. Whose answer it is comes from
 * the session, never the form: the only field a request controls is on or off.
 */
export async function setWeeklyDigestAction(shopSlug: string, wanted: boolean): Promise<void> {
  const { db, shop, session } = await requireShopSurface(shopSlug);
  await setWeeklyDigestChoice(db, { shopId: shop.id, personId: session.user.personId, wanted });
  revalidatePath(shopPath(shop.slug, "settings", "email"));
}
