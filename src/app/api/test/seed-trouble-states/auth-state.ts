import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { AppDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { accountSignInChallenges } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { nowMs } from "@/lib/clock";
import { APP_ORIGIN, publicAppUrl } from "@/lib/notifications/app-url";
import {
  hashPendingHandle,
  pendingCookie,
  readPendingHandle,
  signInOrigins,
} from "@/lib/pending-sign-in";

/** Called only behind the parent route's existing harness/secret/database gate. */
export async function authStateResponse(request: Request, db: AppDb) {
  const query = new URL(request.url).searchParams;
  if (!query.has("authChallengeState")) return null;
  if (query.get("authChallengeState") !== "expired")
    return NextResponse.json({ error: "invalid_state" }, { status: 400 });
  const shop = await getShopBySlug(db, query.get("shop") ?? "");
  if (!shop?.isDemo || shop.slug === DEMO_SHOP_SLUG)
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  const cookie = pendingCookie(
    signInOrigins(publicAppUrl() ?? APP_ORIGIN, process.env)[0],
    process.env.DIVEDAY_E2E === "1",
  );
  const handle = readPendingHandle(request.headers, cookie.name);
  if (!handle) return NextResponse.json({ error: "not_available" }, { status: 404 });
  const [row] = await db
    .update(accountSignInChallenges)
    .set({ createdAt: new Date(nowMs() - 301_000), expiresAt: new Date(nowMs() - 1_000) })
    .where(
      and(
        eq(accountSignInChallenges.shopId, shop.id),
        eq(accountSignInChallenges.tokenHash, hashPendingHandle(handle)),
      ),
    )
    .returning({ id: accountSignInChallenges.id });
  return row
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "not_available" }, { status: 404 });
}
