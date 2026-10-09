"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { setAfterHoursPingChoice } from "@/db/desk-pings";
import { setWeeklyDigestChoice } from "@/db/weekly-digest";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";

/**
 * The staffer's own answer to the Monday email. Whose answer it is comes from
 * the session, never the form: the only field a request controls is on or off.
 */
export async function setWeeklyDigestAction(shopSlug: string, wanted: unknown): Promise<void> {
  const { db, shop, session } = await requireShopSurface(shopSlug);
  // A Server Action's arguments arrive off the wire whatever the signature
  // says: anything but a real boolean is refused before it reaches the row.
  const parsed = z.boolean().safeParse(wanted);
  if (!parsed.success) return;
  await setWeeklyDigestChoice(db, {
    shopId: shop.id,
    personId: session.user.personId,
    wanted: parsed.data,
  });
  revalidatePath(shopPath(shop.slug, "settings", "email"));
}

/**
 * The staffer's own answer to the after-hours desk ping. The same shape as the
 * Monday email's: the session names whose answer it is, the form only on or off.
 */
export async function setAfterHoursPingAction(shopSlug: string, wanted: unknown): Promise<void> {
  const { db, shop, session } = await requireShopSurface(shopSlug);
  const parsed = z.boolean().safeParse(wanted);
  if (!parsed.success) return;
  await setAfterHoursPingChoice(db, {
    shopId: shop.id,
    personId: session.user.personId,
    wanted: parsed.data,
  });
  revalidatePath(shopPath(shop.slug, "settings", "email"));
}
