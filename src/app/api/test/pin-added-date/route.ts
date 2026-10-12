import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { people } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { nowDate } from "@/lib/clock";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/**
 * Stamps the demo shop's live records of one name as added at the app's
 * clock, so a capture that prints a record's "Added" date stops changing every
 * day (issue #2297).
 *
 * `people.created_at` is a `defaultNow()` column, stamped by Postgres from the
 * wall clock, which `DIVEDAY_CLOCK` does not reach (`dbNow`'s docblock in
 * `src/test/db.ts`). The merge preview prints both records' added dates, one
 * seeded and one made at the counter a moment before the shot, so both read
 * the real calendar. Pinned here rather than in the writers or the seed: those
 * stamps also order lists of people, and moving every seeded diver onto the
 * frozen clock, ahead of the staff still on the wall clock, would reorder them
 * for every spec to fix one picture.
 *
 * Resolves the demo shop itself and refuses one that is not `isDemo`, like
 * `seed-trouble-states`. Safe to mutate because each Playwright worker owns
 * its own database, reset before every test (`e2e/servers.ts`).
 */
const bodySchema = z.object({ fullName: z.string().trim().min(1) });

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
