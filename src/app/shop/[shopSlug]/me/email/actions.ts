"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireShopSurface } from "@/features/accounts/session";
import { setHowItWentEmailChoice } from "@/features/day/how-it-went";
import { setAfterHoursPingChoice } from "@/features/messages/desk-pings";
import { setWeeklyDigestChoice } from "@/features/reports/weekly-digest";
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
  revalidatePath(shopPath(shop.slug, "me", "email"));
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
  revalidatePath(shopPath(shop.slug, "me", "email"));
}

/**
 * The owner's own answer to the How it went email. The same shape again; a
 * non-owner's answer is stored and never read, since only owners are sent it.
 */
export async function setHowItWentEmailAction(shopSlug: string, wanted: unknown): Promise<void> {
  const { db, shop, session } = await requireShopSurface(shopSlug);
  const parsed = z.boolean().safeParse(wanted);
  if (!parsed.success) return;
  await setHowItWentEmailChoice(db, {
    shopId: shop.id,
    personId: session.user.personId,
    wanted: parsed.data,
  });
  revalidatePath(shopPath(shop.slug, "me", "email"));
}
