import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { applyFacts, knownFactNames, resolveFacts } from "@/db/facts";
import { people } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { nowDate } from "@/lib/clock";
import { e2eTestRouteAuthorized, requireDemoTenant, testRouteRefused } from "@/lib/e2e-test-routes";
import { troubleVariantResponse } from "./variant-response";

/**
 * Puts the seeded demo shop into the states that only render when something has
 * gone wrong, so visual captures and specs can photograph them. **A thin
 * applier of a list of named facts** (`src/db/facts/index.ts`, issue #2759):
 *
 *     POST /api/test/seed-trouble-states?facts=troublePanels,gearOut,bench
 *
 * The answer is `{ ok: true, ...values }`, each fact's own answer keyed by its
 * name (a fact with nothing to say is left out). An unknown name is a 400 that
 * lists the names there are. An empty list writes nothing.
 *
 * ## Why this is a route and not seed data
 *
 * The panels — stuck payment operations and owed refunds on the Orders index,
 * stuck media deletions and owed processor erasures in Settings' "Data &
 * integrations" group, the rating-withheld banner on Reviews, a diver's no-card
 * declaration — are the class of surface **most** likely to render badly and
 * least likely to be looked at: warning-toned blocks of dense text with inline
 * links, seen by a shop on its worst day. `src/db/seed-front-desk.ts` seeds its
 * payment operation as `succeeded` on purpose: a demo permanently shouting that
 * four payments are broken is a worse demo, and that call stands.
 *
 * A test-only route keeps the demo pristine. Each Playwright worker has its own
 * server and in-memory PGlite database (`e2e/servers.ts`), reset before every
 * test (`e2e/fixtures.ts`), so these writes cannot reach another capture.
 *
 * Gated identically to /api/test/reset. A fact refuses non-demo shops;
 * operational variants (`variant-response.ts`) may name a private demo by slug.
 */
export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) return testRouteRefused();
  const db = await getDb();
  const variant = await troubleVariantResponse(request, db);
  if (variant) return variant;
  const tenant = await requireDemoTenant(request, () => getShopBySlug(db, DEMO_SHOP_SLUG));
  if (!tenant.ok) return tenant.response;
  const { shop } = tenant;

  const requested = (new URL(request.url).searchParams.get("facts") ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const resolved = resolveFacts(requested);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: "unknown_facts", unknown: resolved.unknown, known: knownFactNames() },
      { status: 400 },
    );
  }

  // One of the shop's own people, for the rows that name who acted. Which one
  // does not matter to any panel; that it belongs to this shop does.
  const [actor] = await db
    .select({ id: people.id })
    .from(people) // diveday:allow-deleted-people: an e2e seed finds the people it just seeded
    .where(eq(people.shopId, shop.id))
    .orderBy(people.createdAt)
    .limit(1);
  if (!actor) return NextResponse.json({ error: "not_seeded" }, { status: 409 });

  const values = await applyFacts(requested, {
    db,
    shop: { id: shop.id, timezone: shop.timezone },
    actorId: actor.id,
    now: nowDate(),
  });
  return NextResponse.json({ ok: true, ...values });
}
