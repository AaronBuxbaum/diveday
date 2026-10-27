"use server";

import { revalidatePath } from "next/cache";
import { acknowledgeTodayCatchUp, initializeTodayCatchUp } from "@/db/today-catch-up";
import { nowDate } from "@/lib/clock";
import { requireShopSurface } from "@/lib/session";
import { verifyTodayCatchUp } from "@/lib/today-catch-up-token";
import { shopDayBounds } from "@/lib/zoned";

export async function markTodayCatchUp(
  shopSlug: string,
  mode: "initialize" | "ack",
  token: string,
): Promise<void> {
  const { db, shop, session } = await requireShopSurface(shopSlug);
  const now = nowDate();
  const input = { shopId: shop.id, personId: session.user.personId, timeZone: shop.timezone, now };
  const eventIds = verifyTodayCatchUp(token, {
    shopId: shop.id,
    personId: input.personId,
    dayStart: shopDayBounds(now, shop.timezone).from.toISOString(),
    mode,
  });
  if (!eventIds) return;
  if (mode === "initialize") await initializeTodayCatchUp(db, { ...input, eventIds });
  else {
    await acknowledgeTodayCatchUp(db, { ...input, eventIds });
    revalidatePath(`/shop/${shop.slug}`);
  }
}
