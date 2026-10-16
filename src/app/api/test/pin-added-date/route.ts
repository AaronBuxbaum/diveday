import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { people } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { nowDate } from "@/lib/clock";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/**
 * Stamps the demo shop's live records of one name as added at the app's
 * clock, so a capture that prints a record's "Added" date stops changing every
 * day (issue #2297).
 *
 * A Drizzle insert now stamps `created_at` from the app clock (`appNowTimestamp`,
 * issue #2538), so a row made during a capture already carries it. The demo
 * seed's own rows were stamped when the e2e database was built, and the merge
 * preview prints two records' "Added" dates, one seeded and one made at the
 * counter, so this still moves the named records onto the clock for that picture.
 *
 * Resolves the demo shop itself and refuses one that is not `isDemo`, like
 * `seed-trouble-states`. Safe to mutate because each Playwright worker owns
 * its own database, reset before every test (`e2e/servers.ts`).
 */
const bodySchema = z.object({ fullName: z.string().trim().min(1).max(200) });

export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const db = await getDb();
  const shop = await getShopBySlug(db, DEMO_SHOP_SLUG);
  if (!shop?.isDemo) return NextResponse.json({ error: "not_available" }, { status: 404 });

  const pinned = await db
    .update(people)
    .set({ createdAt: nowDate() })
    .where(
      and(
        eq(people.shopId, shop.id),
        eq(people.fullName, parsed.data.fullName),
        isNull(people.deletedAt),
      ),
    )
    .returning({ id: people.id });
  return NextResponse.json({ pinned: pinned.length });
}
