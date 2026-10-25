import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { askAnytime } from "@/db/interests";
import { getShopBySlug } from "@/db/shops";
import { diveDeclarationSchema, toDiveDeclaration } from "@/lib/dive-declaration";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/**
 * Puts one joiner on a shop's last-minute list through the same `askAnytime`
 * write the public form's action makes, declaration included, so a spec about
 * the deal panel or the diver record starts from the list rather than spending
 * its budget typing a sign-up. `e2e/last-minute-fill.spec.ts` keeps one test
 * that signs up through the real form. Exists only for e2e coverage; gated
 * identically to `/api/test/reset`, so it can never be reachable in a real
 * deployment.
 */
const bodySchema = z.object({
  shopSlug: z.string().trim().min(1),
  fullName: z.string().trim().min(1),
  email: z.string().trim().email(),
  certificationLevel: z.string().optional(),
  availableFrom: z.string().optional(),
});

export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const declaration = diveDeclarationSchema.safeParse({
    certificationLevel: parsed.data.certificationLevel,
  });
  if (!declaration.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const db = await getDb();
  const shop = await getShopBySlug(db, parsed.data.shopSlug);
  if (!shop) return NextResponse.json({ error: "shop_not_found" }, { status: 404 });

  await askAnytime(db, {
    shopId: shop.id,
    fullName: parsed.data.fullName,
    email: parsed.data.email,
    availableFrom: parsed.data.availableFrom,
    declaration: toDiveDeclaration(declaration.data),
  });
  return NextResponse.json({ ok: true });
}
