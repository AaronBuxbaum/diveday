import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { issueDisplayToken } from "@/db/display-tokens";
import { people, personRoles } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { nowDate } from "@/lib/clock";
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
  /**
   * Seconds to add to the frozen clock before stamping `created_at`, so a
   * fixture that mints two links can decide which one the settings panel lists
   * first. The panel orders newest-first and breaks a tie on `id`, which is a
   * fresh uuid on every run — under `TEST_FROZEN_CLOCK` two links minted in the
   * same test share `created_at` exactly, and the row order became a coin flip
   * that moved pixels on unrelated pull requests. Capped below a minute because
   * that is what keeps the shift invisible: every rendered stamp on that page is
   * minute-resolution, so the picture is identical and only the order is fixed.
   */
  createdAtOffsetSeconds: z.number().int().min(0).max(59).optional(),
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
  const offsetSeconds = parsed.data.createdAtOffsetSeconds ?? 0;
  const outcome = await issueDisplayToken(db, {
    shopId: shop.id,
    personId: owner.id,
    label: parsed.data.label ?? "Lobby TV",
    purpose,
    showNames: parsed.data.showNames ?? false,
    ...(offsetSeconds > 0 ? { now: new Date(nowDate().getTime() + offsetSeconds * 1000) } : {}),
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
