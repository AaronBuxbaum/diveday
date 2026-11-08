import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { people } from "@/db/schema";
import { createDemoShop, deleteDemoShopCascade } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import {
  e2eTestRouteAuthorized,
  holdNonDemoFixture,
  requireDemoTenant,
  takeNonDemoFixture,
  testRouteRefused,
} from "@/features/e2e-test-routes";
import { nowDate } from "@/lib/clock";
import { DEMO_BYPASS_PASSWORD } from "@/lib/demo-bypass";
import { armClaudeFixtures, claudeFixturesArmed } from "../../../../features/assists/e2e-fixtures";
import {
  applyFacts,
  FactRefused,
  knownFactNames,
  resolveFacts,
} from "../../../../test/shop-facts/index";

/**
 * **The one test door: a shop's state is a list of named facts** (issue #2759).
 *
 *     POST /api/test/shop
 *     { "slug": "a-minted-shop", "facts": ["troublePanels", "gearOut",
 *       { "name": "evening", "heads": "closed" }] }
 *
 * answers `{ ok: true, slug, values }`, each fact's own answer keyed by its
 * name in `values` (a fact with nothing to say is left out). The facts are the
 * registry's (`src/test/shop-facts/index.ts`) and are written in its order, never the
 * caller's. An unknown name or a refused argument is a 400 that says which, and
 * lists the names there are; a fact that cannot be written is its own refusal
 * (`FactRefused`), named with the fact. An empty list writes nothing.
 *
 * **Which shop.** No `slug` is the canonical `blue-mantis` fixture; `slug`
 * names a shop the fleet minted. Either way the shop goes through
 * `requireDemoTenant`, so a real tenant and a missing one get the one refusal
 * and nothing is written. A private fact (shop-wide settings, the demo flag) is
 * refused on `blue-mantis`, which every spec shares.
 *
 * **`mint`** makes the shop first: a whole seeded shop of the test's own
 * (`createDemoShop`, ADR 20260815-per-test-private-shops), the same `isDemo`
 * tenant "Try the live demo" mints for a visitor, without the visitor demo's
 * back-filled history. `mint: { slug }` pins its identity for a capture (the
 * name and the slug-derived owner email render in the staff chrome); `brand`
 * dresses it in the brand fixture; `demo: false` mints a real-shaped shop
 * (issue #2783) that this server remembers so its teardown may drop it. The
 * answer adds the owner's email and the published password its staff sign in
 * with, and the facts in the same request are written to the new shop.
 *
 * **`DELETE ?slug=`** drops a shop this door minted: a demo, or a shop this
 * server itself made real-shaped (`holdNonDemoFixture`), never the canonical
 * fixture and never a real tenant. An armed assist shop is disarmed first. A
 * slug that names nothing is a no-op: teardown must not fail a passing test
 * because the reset already reaped the shop.
 *
 * Gated like every `/api/test/*` route (`e2eTestRouteAuthorized`), before the
 * body or the database: the facts include a password-reset token for any
 * account and a shop whose staff sign in with a published password. Each
 * Playwright worker owns its server and database, reset before every test
 * (`e2e/servers.ts`), so these writes reach no other spec.
 */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const factRequest = z.union([
  z.string().min(1),
  z.object({ name: z.string().min(1) }).catchall(z.unknown()),
]);

const bodySchema = z
  .object({
    slug: z.string().regex(SLUG).max(80).optional(),
    mint: z
      .union([
        z.literal(true),
        z
          .object({
            slug: z.string().regex(SLUG).max(80).optional(),
            brand: z.boolean().optional(),
            demo: z.boolean().optional(),
          })
          .strict(),
      ])
      .optional(),
    facts: z.array(factRequest).default([]),
  })
  .strict()
  // A minted shop names its own slug (`mint.slug`); the two never meet.
  .refine(({ slug, mint }) => !(slug && mint));

export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) return testRouteRefused();
  const text = await request.text().catch(() => "");
  let raw: unknown = {};
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { slug, mint, facts } = parsed.data;

  const resolved = resolveFacts(facts);
  if (!resolved.ok) {
    return NextResponse.json(
      {
        error: "unknown_facts",
        unknown: resolved.unknown,
        invalid: resolved.invalid,
        known: knownFactNames(),
      },
      { status: 400 },
    );
  }

  const db = await getDb();
  // The shop the facts land on. A shop this request minted is written to as
  // it is (a real-shaped mint is not a demo); any other goes through the gate.
  let shop: { id: string; slug: string; timezone: string };
  let minted: { ownerEmail: string } | null = null;
  if (mint) {
    const options = mint === true ? {} : mint;
    const demo = options.demo !== false;
    // One transaction, like `enterDemoAction`: the cap eviction and the mint
    // commit together, and a half-seeded shop never becomes a test's fixture.
    const made = await db.transaction(async (tx) =>
      createDemoShop(tx, { shape: "lean", slug: options.slug, brand: options.brand, demo }),
    );
    const row = await getShopBySlug(db, made.slug);
    if (!row) throw new Error(`minted shop ${made.slug} is missing`);
    if (!demo) holdNonDemoFixture(row.id);
    shop = row;
    minted = { ownerEmail: made.ownerEmail };
  } else {
    const tenant = await requireDemoTenant(request, () =>
      getShopBySlug(db, slug ?? DEMO_SHOP_SLUG),
    );
    if (!tenant.ok) return tenant.response;
    shop = tenant.shop;
  }
  if (shop.slug === DEMO_SHOP_SLUG && resolved.facts.some((fact) => fact.privateOnly)) {
    return testRouteRefused();
  }

  let values: Record<string, unknown> = {};
  if (resolved.facts.length > 0) {
    // One of the shop's own people, for the rows that name who acted. Which one
    // does not matter to any fact; that it belongs to this shop does.
    const [actor] = await db
      .select({ id: people.id })
      .from(people) // diveday:allow-deleted-people: an e2e seed finds the people it just seeded
      .where(eq(people.shopId, shop.id))
      .orderBy(people.createdAt)
      .limit(1);
    if (!actor) return NextResponse.json({ error: "not_seeded" }, { status: 409 });
    try {
      values = await applyFacts(facts, {
        db,
        shop: { id: shop.id, slug: shop.slug, timezone: shop.timezone },
        actorId: actor.id,
        now: nowDate(),
        request: { headers: request.headers, origin: new URL(request.url).origin },
      });
    } catch (error) {
      if (!(error instanceof FactRefused)) throw error;
      if (error.code === "not_available") return testRouteRefused();
      return NextResponse.json({ error: error.code, ...error.detail }, { status: error.status });
    }
  }

  return NextResponse.json({
    ok: true,
    slug: shop.slug,
    ...(minted ? { ownerEmail: minted.ownerEmail, password: DEMO_BYPASS_PASSWORD } : {}),
    values,
  });
}

/**
 * Drop a shop this door minted, named by `?slug=`. Refuses the canonical
 * fixture by slug and leaves a real shop alone, the same two exclusions
 * `purgeMintedDemoShops` and the TTL reaper apply; `/api/test/reset` would
 * clear a minted shop anyway, but dropping it here charges the cascade to the
 * test that asked for the shop rather than to the next test's budget.
 */
export async function DELETE(request: Request) {
  if (!e2eTestRouteAuthorized(request)) return testRouteRefused();
  const slug = new URL(request.url).searchParams.get("slug");
  if (!slug || slug === DEMO_SHOP_SLUG) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const db = await getDb();
  const shop = await getShopBySlug(db, slug);
  if (!shop) return NextResponse.json({ ok: true, dropped: false });
  const armed = claudeFixturesArmed(shop.id);
  if (armed) armClaudeFixtures(shop.id, false);
  const ours = takeNonDemoFixture(shop.id);
  if (!shop.isDemo && !armed && !ours) return NextResponse.json({ ok: true, dropped: false });
  await db.transaction(async (tx) => deleteDemoShopCascade(tx, shop.id));
  return NextResponse.json({ ok: true, dropped: true });
}
