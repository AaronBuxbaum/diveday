"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { getDb } from "@/db/client";
import { DEV_STAFF_LOGINS } from "@/db/dev-credentials";
import { getShopById } from "@/db/queries";
import { shops } from "@/db/schema";
import { resetDemoSchedule } from "@/db/seed";
import { signIn } from "@/lib/auth";
import { requireStaffSession } from "@/lib/session";

/**
 * One-click into the demo: sign in as the example shop's owner and land on the
 * staff dashboard. Gated by presence of a demo shop in the database.
 */
export async function enterDemoAction() {
  const db = await getDb();
  const demoShop = await db
    .select({ slug: shops.slug })
    .from(shops)
    .where(eq(shops.isDemo, true))
    .limit(1);
  if (demoShop.length === 0) redirect("/");
  const demoSlug = demoShop[0].slug;

  try {
    await signIn("credentials", {
      email: DEV_STAFF_LOGINS.owner.email,
      password: DEV_STAFF_LOGINS.owner.password,
      redirectTo: `/shop/${demoSlug}`,
    });
  } catch (error) {
    if (error instanceof AuthError) redirect("/sign-in?error=1");
    throw error; // NEXT_REDIRECT (the success path) and unexpected errors propagate
  }
}

export async function resetDemoAction() {
  const session = await requireStaffSession();
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (shop?.isDemo) {
    await resetDemoSchedule(db, shop.id);
  }
  redirect(`/shop/${session.user.shopSlug}?reset=1`);
}
