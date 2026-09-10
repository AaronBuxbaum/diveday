import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { issueDisplayToken } from "@/db/display-tokens";
import { people, personRoles } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { boardPath } from "@/lib/display-tokens";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";
import { kioskCheckInPath } from "@/lib/kiosk-check-in";

/**
 * Mints a real display link for a demo shop and hands back the raw token — the
 * only way `e2e/visual.spec.ts` can photograph `/board/[token]` without first
 * driving the settings form, since the token is hashed at rest and shown once.
 * Issued as the shop's owner through the real writer (`issueDisplayToken`), so
 * the row is exactly what the settings page would have made. Refuses any shop
 * that is not `isDemo`: past the bearer guard, the slug is caller-supplied,
 * and a link over a real shop's day is not a fixture. Gated identically to
 * /api/test/reset, so it can never be reachable in a real deployment.
 */
const bodySchema = z.object({
  slug: z.string().trim().min(1).optional(),
  label: z.string().trim().min(1).optional(),
  /** Which surface the minted link opens — the board, or the check-in kiosk (N-24). */
  purpose: z.enum(["board", "check_in"]).optional(),
  showNames: z.boolean().optional(),
});

export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  // No body is a valid request: the fixture's own defaults are the whole ask.
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const db = await getDb();
  const shop = await getShopBySlug(db, parsed.data.slug ?? DEMO_SHOP_SLUG);
  if (!shop?.isDemo) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const [owner] = await db
    .select({ id: people.id })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!owner) return NextResponse.json({ error: "owner_not_found" }, { status: 404 });

  const purpose = parsed.data.purpose ?? "board";
  const outcome = await issueDisplayToken(db, {
    shopId: shop.id,
    personId: owner.id,
    label: parsed.data.label ?? "Lobby TV",
    purpose,
    showNames: parsed.data.showNames ?? false,
  });
  if (!outcome.ok) return NextResponse.json({ error: outcome.reason }, { status: 400 });
  return NextResponse.json({
    token: outcome.issued.token,
    path:
      purpose === "check_in"
        ? kioskCheckInPath(outcome.issued.token)
        : boardPath(outcome.issued.token),
  });
}
