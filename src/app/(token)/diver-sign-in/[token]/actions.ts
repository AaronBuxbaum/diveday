"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyCapability } from "@/db/capabilities";
import { getDb } from "@/db/client";
import { startDiverSession } from "@/db/diver-sign-in";
import { getShopById } from "@/db/shops";
import { diverSessionCookie } from "@/features/accounts/diver-sign-in";
import { FIND_YOUR_BOOKING_PATH, publicProfilePath, publicSignInPath } from "@/lib/public-routes";

/**
 * Spends a diver's sign-in link and leaves the session in a cookie for that
 * shop's pages (ADR 20261125-diver-sign-in). A spent, expired or unknown link
 * lands on the shop's sign-in page with one line asking for a fresh one.
 */
export async function redeemDiverSignIn(formData: FormData) {
  const token = formData.get("token");
  const raw = typeof token === "string" ? token : "";
  const db = await getDb();
  const session = /^[A-Za-z0-9_-]{43}$/.test(raw)
    ? await startDiverSession(db, { token: raw })
    : null;
  const shopId =
    session?.shopId ??
    (raw ? (await verifyCapability(db, { purpose: "diver_sign_in", token: raw }))?.shopId : null);
  const shop = shopId ? await getShopById(db, shopId) : null;
  if (!shop) redirect(FIND_YOUR_BOOKING_PATH);
  if (!session) redirect(`${publicSignInPath(shop.slug)}?error=link`);
  (await cookies()).set(diverSessionCookie(shop.slug, session.token));
  redirect(publicProfilePath(shop.slug));
}
