import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { countPendingCrewNotices, previewCrewNotices } from "@/db/crew-notices";
import { people } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/**
 * **What a crew member would be told, without telling them** (ADR
 * 20261009-crew-hear-about-their-boats).
 *
 * The crew message goes out on an hourly pass, after the person's crew has been
 * still for a few minutes, and the e2e fleet's clock is frozen — so a spec can
 * neither wait for it nor read an inbox. This answers with the message the pass
 * would build from what is pending right now, and how many notices are
 * pending, claiming and sending nothing.
 *
 * Gated like every other `/api/test/*` route, and demo shops only.
 */
const bodySchema = z.object({
  shopSlug: z.string().trim().min(1),
  /** The crew member, by the name the shop knows them by. */
  personName: z.string().trim().min(1),
});

export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const db = await getDb();
  const shop = await getShopBySlug(db, parsed.data.shopSlug);
  if (!shop?.isDemo) return NextResponse.json({ error: "not_demo" }, { status: 404 });

  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        eq(people.shopId, shop.id),
        eq(people.fullName, parsed.data.personName),
        isNull(people.deletedAt),
      ),
    )
    .limit(1);
  if (!person) return NextResponse.json({ error: "person_not_found" }, { status: 404 });

  const [pending, notification] = await Promise.all([
    countPendingCrewNotices(db, shop.id, person.id),
    previewCrewNotices(db, {
      shopId: shop.id,
      personId: person.id,
      origin: new URL(request.url).origin,
    }),
  ]);
  return NextResponse.json({ pending, notification });
}
