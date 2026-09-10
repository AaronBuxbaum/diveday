import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { issueShelfToken } from "@/db/person-shelf-tokens";
import { people } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";
import { shelfLinkPath } from "@/lib/shelf-links";

/**
 * Hands a spec a live shelf link for a named diver at a named shop.
 *
 * In the product a shelf token is minted from the diver's own thread or by a
 * staffer tapping "Send the link" on the record — the first needs a departure
 * that has come home, the second needs a mailbox. A spec that wants the shelf
 * itself, or the storefront's greeting, takes the link from here instead of
 * walking either.
 *
 * Writes one `person_shelf_tokens` row and nothing else, resolved inside the
 * named shop for the named email — the same row the two shipped doors write.
 * Mutating is safe because of the fleet's topology (`e2e/servers.ts`): each
 * Playwright worker owns its own server and database, reset before every test.
 * Gated identically to `/api/test/reset`, so it can never answer in a real
 * deployment.
 */
const bodySchema = z.object({
  shopSlug: z.string().trim().min(1),
  email: z.email(),
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

  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        eq(people.shopId, shop.id),
        eq(people.email, parsed.data.email.toLowerCase()),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        isNull(people.mergedIntoPersonId),
      ),
    )
    .limit(1);
  if (!person) return NextResponse.json({ error: "diver_not_found" }, { status: 404 });

  const issued = await issueShelfToken(db, { shopId: shop.id, personId: person.id });
  if (!issued) return NextResponse.json({ error: "shelf_refused" }, { status: 409 });
  return NextResponse.json({ href: shelfLinkPath(issued.token), token: issued.token });
}
