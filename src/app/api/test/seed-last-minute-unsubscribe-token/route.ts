import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { issueLastMinuteListUnsubscribeToken } from "@/db/last-minute-list";
import { lastMinuteListEntries, people } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";

/**
 * Mints a real, valid `last_minute_list_unsubscribe_tokens` row for an
 * existing last-minute-list entry and hands back the raw token — the only
 * way an e2e spec can drive `/unsubscribe/[token]`'s actual happy path
 * through its real page and server action, mirroring
 * `/api/test/seed-account-token`'s reasoning: the token is otherwise only
 * ever readable from inside a real email and is hashed at rest. Exists only
 * for e2e coverage; gated identically to `/api/test/reset`, so it can never
 * be reachable in a real deployment.
 */
const bodySchema = z.object({
  shopSlug: z.string().trim().min(1),
  email: z.string().trim().email(),
});

export async function POST(request: Request) {
  const hasRealDatabase = Boolean(process.env.DATABASE_URL);
  const productionRuntime = process.env.NODE_ENV === "production";
  const e2eHarness = process.env.DIVEDAY_E2E === "1";
  if (hasRealDatabase || (productionRuntime && !e2eHarness)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const db = await getDb();
  const shop = await getShopBySlug(db, parsed.data.shopSlug);
  if (!shop) return NextResponse.json({ error: "shop_not_found" }, { status: 404 });

  const [entry] = await db
    .select({ id: lastMinuteListEntries.id })
    .from(lastMinuteListEntries)
    .innerJoin(people, eq(people.id, lastMinuteListEntries.personId))
    .where(
      and(
        eq(lastMinuteListEntries.shopId, shop.id),
        eq(people.email, parsed.data.email.toLowerCase()),
        isNull(people.deletedAt),
      ),
    )
    .limit(1);
  if (!entry) return NextResponse.json({ error: "entry_not_found" }, { status: 404 });

  const token = await issueLastMinuteListUnsubscribeToken(db, {
    shopId: shop.id,
    entryId: entry.id,
  });
  return NextResponse.json({ token });
}
