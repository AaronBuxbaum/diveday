"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/queries";
import { resetDemoSchedule } from "@/db/seed";
import { signIn } from "@/lib/auth";
import { DEMO_OWNER_LOGIN, DEMO_SHOP_SLUG, isDemoMode } from "@/lib/demo";
import { requireStaffSession } from "@/lib/session";

/**
 * One-click into the demo: sign in as the example shop's owner and land on the
 * staff dashboard. Gated by isDemoMode() so it is inert in a real production
 * instance (docs ADR 20260718-demo-mode).
 */
export async function enterDemoAction() {
  if (!isDemoMode()) redirect("/");
  try {
    await signIn("credentials", {
      email: DEMO_OWNER_LOGIN.email,
      password: DEMO_OWNER_LOGIN.password,
      redirectTo: "/shop",
    });
  } catch (error) {
    if (error instanceof AuthError) redirect("/sign-in?error=1");
    throw error; // NEXT_REDIRECT (the success path) and unexpected errors propagate
  }
}

/**
 * Wipe the demo playground back to its seeded state. Staff-gated and demo-gated:
 * only a signed-in staffer, and only while demo mode is on, can trigger it.
 */
export async function resetDemoAction() {
  if (!isDemoMode()) redirect("/");
  await requireStaffSession();
  const db = await getDb();
  const shop = await getShopBySlug(db, DEMO_SHOP_SLUG);
  if (shop) await resetDemoSchedule(db, shop.id);
  redirect("/shop?reset=1");
}
