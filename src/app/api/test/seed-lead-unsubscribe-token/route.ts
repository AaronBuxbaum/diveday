import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { issueLeadUnsubscribeToken } from "@/db/leads";
import { leads, people } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/**
 * Mints a real, valid `lead_unsubscribe_tokens` row for an existing anytime
 * lead (the last-minute list) and hands back the raw token — the only way an
 * e2e spec can drive `/unsubscribe/[token]`'s actual happy path through its real
 * page and server action, mirroring `/api/test/seed-account-token`'s reasoning:
 * the token is otherwise only ever readable from inside a real email and is
 * hashed at rest. Exists only for e2e coverage; gated identically to
 * `/api/test/reset`, so it can never be reachable in a real deployment.
 */
const bodySchema = z.object({
  shopSlug: z.string().trim().min(1),
  email: z.string().trim().email(),
});

export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const db = await getDb();
  const shop = await getShopBySlug(db, parsed.data.shopSlug);
  if (!shop) return NextResponse.json({ error: "shop_not_found" }, { status: 404 });

  const [lead] = await db
    .select({ id: leads.id })
    .from(leads)
    .innerJoin(people, eq(people.id, leads.personId))
    .where(
      and(
        eq(leads.shopId, shop.id),
        eq(leads.scope, "anytime"),
        eq(people.email, parsed.data.email.toLowerCase()),
        isNull(people.deletedAt),
      ),
    )
    .limit(1);
  if (!lead) return NextResponse.json({ error: "lead_not_found" }, { status: 404 });

  const token = await issueLeadUnsubscribeToken(db, { shopId: shop.id, leadId: lead.id });
  return NextResponse.json({ token });
}
