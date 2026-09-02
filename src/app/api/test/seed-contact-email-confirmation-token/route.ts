import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { issueShopContactEmailConfirmation } from "@/db/shop-contact-email";
import { getShopBySlug } from "@/db/shops";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/**
 * Mints a real `shop_contact_email_confirmation_tokens` row for a shop's
 * current front-desk address and hands back the raw token — the only way an
 * e2e spec can drive `/confirm-contact/[token]` through its real page and
 * server action (issue #1288), mirroring
 * `/api/test/seed-courtesy-email-unsubscribe-token`: the token is otherwise
 * only ever readable from inside the confirmation email and hashed at rest.
 * Exists only for e2e coverage; gated identically to `/api/test/reset`, so it
 * can never be reachable in a real deployment.
 */
const bodySchema = z.object({ shopSlug: z.string().trim().min(1) });

export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const db = await getDb();
  const shop = await getShopBySlug(db, parsed.data.shopSlug);
  if (!shop) return NextResponse.json({ error: "shop_not_found" }, { status: 404 });
  if (!shop.contactEmail) return NextResponse.json({ error: "no_contact_email" }, { status: 409 });

  const issued = await issueShopContactEmailConfirmation(db, {
    shopId: shop.id,
    email: shop.contactEmail,
  });
  return NextResponse.json({ token: issued.token });
}
